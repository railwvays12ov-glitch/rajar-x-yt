import { spawn } from 'node:child_process';

export interface RunOptions {
  timeoutMs: number;
  /** Hard cap on captured stdout; the process is killed when exceeded. */
  maxStdoutBytes?: number;
  /** Only the tail of stderr is retained. */
  maxStderrBytes?: number;
  signal?: AbortSignal;
  cwd?: string;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  aborted: boolean;
  truncated: boolean;
  spawnError: NodeJS.ErrnoException | null;
}

/**
 * Child processes get a minimal environment so server secrets (DATABASE_URL,
 * SESSION_SECRET, API_KEY_PEPPER, …) are never visible to yt-dlp or FFmpeg.
 */
export function childEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: home,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    PYTHONIOENCODING: 'utf-8',
    PYTHONDONTWRITEBYTECODE: '1',
    ...(process.env.HTTPS_PROXY ? { HTTPS_PROXY: process.env.HTTPS_PROXY } : {}),
    ...(process.env.HTTP_PROXY ? { HTTP_PROXY: process.env.HTTP_PROXY } : {}),
  };
}

/**
 * Runs a binary with an argument array — never through a shell — with timeout,
 * output caps, and process-group termination so FFmpeg children die with yt-dlp.
 */
export function runProcess(bin: string, args: string[], opts: RunOptions): Promise<RunResult> {
  const maxOut = opts.maxStdoutBytes ?? 16 * 1024 * 1024;
  const maxErr = opts.maxStderrBytes ?? 64 * 1024;

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let outBytes = 0;
    let timedOut = false;
    let aborted = false;
    let truncated = false;
    let settled = false;
    let outBuf = '';
    let errBuf = '';

    const child = spawn(bin, args, {
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: childEnv(opts.cwd ?? '/tmp'),
      windowsHide: true,
    });

    const kill = () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
        else child.kill('SIGTERM');
      } catch {
        /* already gone */
      }
      setTimeout(() => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, 5000).unref();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);

    const onAbort = () => {
      aborted = true;
      kill();
    };
    if (opts.signal?.aborted) onAbort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const splitLines = (buf: string, chunk: string, cb?: (l: string) => void) => {
      const combined = buf + chunk;
      const parts = combined.split(/\r?\n|\r/);
      const rest = parts.pop() ?? '';
      if (cb) for (const p of parts) if (p) cb(p);
      return rest.length > 8192 ? rest.slice(-8192) : rest;
    };

    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');

    child.stdout!.on('data', (chunk: string) => {
      outBytes += Buffer.byteLength(chunk);
      if (outBytes > maxOut) {
        truncated = true;
        kill();
        return;
      }
      stdout += chunk;
      outBuf = splitLines(outBuf, chunk, opts.onStdoutLine);
    });

    child.stderr!.on('data', (chunk: string) => {
      stderr += chunk;
      if (stderr.length > maxErr) stderr = stderr.slice(-maxErr);
      errBuf = splitLines(errBuf, chunk, opts.onStderrLine);
    });

    const finish = (code: number | null, spawnError: NodeJS.ErrnoException | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      if (outBuf && opts.onStdoutLine) opts.onStdoutLine(outBuf);
      if (errBuf && opts.onStderrLine) opts.onStderrLine(errBuf);
      resolve({ code, stdout, stderr, timedOut, aborted, truncated, spawnError });
    };

    child.on('error', (err: NodeJS.ErrnoException) => finish(null, err));
    child.on('close', (code) => finish(code, null));
  });
}
