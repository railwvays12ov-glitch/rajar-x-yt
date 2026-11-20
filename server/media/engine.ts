import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ErrorCode } from '../../shared/errors.js';
import type { ComponentHealth, ProcessOptions } from '../../shared/types.js';
import { AppError } from '../http/appError.js';
import { analyzeArgs, downloadArgs, expectedStreams, outputExtension, PROGRESS_MARK } from './args.js';
import { mapFfmpegResult, mapYtdlpResult } from './errorMap.js';
import { evaluatePolicy, type YtdlpInfo } from './metadata.js';
import { runProcess } from './runProcess.js';

export interface EngineConfig {
  ytdlpBin: string;
  ffmpegBin: string;
  tempDir: string;
  analyzeTimeoutMs: number;
  jobTimeoutMs: number;
}

export interface DownloadRequest {
  jobId: string;
  url: string;
  options: ProcessOptions;
  maxFileSizeBytes: number;
  allowedSubtitleLangs: string[];
  signal: AbortSignal;
  onProgress: (fraction: number, stage: string) => void;
  onLog: (line: string) => void;
}

export interface DownloadResult {
  /** Path relative to tempDir, e.g. "job_abc/media.mp4". Never exposed to clients. */
  outputRef: string;
  sizeBytes: number;
  ext: string;
}

const HEALTH_TTL_MS = 60_000;

/**
 * Server-side wrapper around yt-dlp and FFmpeg. Only this module spawns them.
 */
export class MediaEngine {
  private healthCache: { at: number; ytdlp: ComponentHealth; ffmpeg: ComponentHealth } | null = null;

  constructor(private readonly cfg: EngineConfig) {}

  get tempDir() {
    return this.cfg.tempDir;
  }

  async health(force = false): Promise<{ ytdlp: ComponentHealth; ffmpeg: ComponentHealth }> {
    if (!force && this.healthCache && Date.now() - this.healthCache.at < HEALTH_TTL_MS) return this.healthCache;
    const [y, f] = await Promise.all([
      runProcess(this.cfg.ytdlpBin, ['--version'], { timeoutMs: 10_000, maxStdoutBytes: 4096 }),
      runProcess(this.cfg.ffmpegBin, ['-hide_banner', '-version'], { timeoutMs: 10_000, maxStdoutBytes: 65536 }),
    ]);
    const ytdlp: ComponentHealth =
      y.code === 0
        ? { status: 'up', version: y.stdout.trim().split('\n')[0]?.slice(0, 40) }
        : { status: 'down', detail: 'yt-dlp binary not found or not executable (set YTDLP_BIN).' };
    const ffmpeg: ComponentHealth =
      f.code === 0
        ? { status: 'up', version: /ffmpeg version (\S+)/.exec(f.stdout)?.[1]?.slice(0, 40) }
        : { status: 'down', detail: 'FFmpeg binary not found or not executable (set FFMPEG_BIN).' };
    this.healthCache = { at: Date.now(), ytdlp, ffmpeg };
    return { ytdlp, ffmpeg };
  }

  /** Extracts metadata only (never downloads). Throws AppError on any restriction. */
  async analyze(url: string, maxDurationSeconds: number, signal?: AbortSignal): Promise<YtdlpInfo> {
    const r = await runProcess(this.cfg.ytdlpBin, analyzeArgs(url), {
      timeoutMs: this.cfg.analyzeTimeoutMs,
      maxStdoutBytes: 24 * 1024 * 1024,
      signal,
      cwd: await this.ensureDir('analyze'),
    });
    const code = mapYtdlpResult(r);
    if (code) throw new AppError(code === 'PROCESSING_TIMEOUT' ? 'NETWORK_FAILURE' : code);

    let info: YtdlpInfo;
    try {
      info = JSON.parse(r.stdout) as YtdlpInfo;
    } catch {
      throw new AppError('PROCESSING_FAILED');
    }
    if (!info || typeof info !== 'object') throw new AppError('PROCESSING_FAILED');
    const blocked = evaluatePolicy(info, maxDurationSeconds);
    if (blocked) throw new AppError(blocked);
    return info;
  }

  async download(req: DownloadRequest): Promise<DownloadResult> {
    const jobDir = await this.ensureDir(req.jobId);
    const streams = expectedStreams(req.options);
    let streamIndex = 0;
    let lastFraction = 0;

    const args = downloadArgs({
      url: req.url,
      outputTemplate: path.join(jobDir, 'media.%(ext)s'),
      options: req.options,
      maxFileSizeBytes: req.maxFileSizeBytes,
      ffmpegBin: this.cfg.ffmpegBin,
      allowedSubtitleLangs: req.allowedSubtitleLangs,
    });

    const r = await runProcess(this.cfg.ytdlpBin, args, {
      timeoutMs: this.cfg.jobTimeoutMs,
      maxStdoutBytes: 4 * 1024 * 1024,
      signal: req.signal,
      cwd: jobDir,
      onStdoutLine: (line) => {
        if (line.startsWith(PROGRESS_MARK)) {
          const [done, total, estimate] = line.slice(PROGRESS_MARK.length).split('|').map(Number);
          const t = total || estimate;
          if (!t || !Number.isFinite(done)) return;
          const f = Math.min(1, (done ?? 0) / t);
          if (f + 0.05 < lastFraction) streamIndex = Math.min(streams - 1, streamIndex + 1);
          lastFraction = f;
          req.onProgress(Math.min(0.92, ((streamIndex + f) / streams) * 0.92), 'downloading');
          return;
        }
        const stage =
          /^\[(Merger|ExtractAudio|EmbedThumbnail|Metadata|EmbedSubtitle|ThumbnailsConvertor|VideoConvertor|FixupM3u8)\]/.exec(
            line,
          );
        if (stage) {
          req.onProgress(0.94, 'post-processing');
          req.onLog(`[${stage[1]}] post-processing`);
        } else if (/^\[(download|info)\]/.test(line) && !line.includes('Destination')) {
          req.onLog(line.slice(0, 160));
        }
      },
    });

    const code = mapYtdlpResult(r);
    if (code) {
      await this.removeJobDir(req.jobId);
      throw new AppError(code);
    }

    let file = await this.findOutput(jobDir, req.options);
    if (!file) {
      await this.removeJobDir(req.jobId);
      // yt-dlp exits 0 but writes nothing when --max-filesize aborts a download.
      throw new AppError(/max-filesize|larger than/i.test(r.stdout + r.stderr) ? 'FILE_TOO_LARGE' : 'PROCESSING_FAILED');
    }

    if (req.options.mediaType === 'audio' && req.options.audioMode === 'normalized') {
      req.onProgress(0.96, 'normalizing');
      req.onLog('[FFmpeg] loudness normalization (EBU R128)');
      file = await this.normalizeAudio(jobDir, file, req.options, req.signal);
    }

    const s = await stat(path.join(jobDir, file));
    if (s.size > req.maxFileSizeBytes) {
      await this.removeJobDir(req.jobId);
      throw new AppError('FILE_TOO_LARGE');
    }
    req.onProgress(1, 'ready');
    return { outputRef: path.posix.join(req.jobId, file), sizeBytes: s.size, ext: path.extname(file).slice(1) };
  }

  private async normalizeAudio(jobDir: string, file: string, o: ProcessOptions, signal: AbortSignal) {
    const ext = path.extname(file).slice(1);
    const out = `normalized.${ext}`;
    const codec: Record<string, string[]> = {
      mp3: ['-c:a', 'libmp3lame', '-b:a', o.audioBitrate === 'auto' ? '256k' : `${o.audioBitrate}k`],
      m4a: ['-c:a', 'aac', '-b:a', o.audioBitrate === 'auto' ? '256k' : `${o.audioBitrate}k`],
      wav: ['-c:a', 'pcm_s16le'],
    };
    const r = await runProcess(
      this.cfg.ffmpegBin,
      [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        path.join(jobDir, file),
        '-map_metadata',
        '0',
        '-vn',
        '-af',
        'loudnorm=I=-16:TP=-1.5:LRA=11',
        ...(codec[ext] ?? ['-c:a', 'aac']),
        path.join(jobDir, out),
      ],
      { timeoutMs: this.cfg.jobTimeoutMs, signal, cwd: jobDir },
    );
    const code: ErrorCode | null = mapFfmpegResult(r);
    if (code) {
      await this.removeJobDir(path.basename(jobDir));
      throw new AppError(code);
    }
    await rm(path.join(jobDir, file), { force: true });
    await rename(path.join(jobDir, out), path.join(jobDir, `media.${ext}`));
    return `media.${ext}`;
  }

  private async findOutput(jobDir: string, o: ProcessOptions): Promise<string | null> {
    const want = outputExtension(o);
    const entries = await readdir(jobDir).catch(() => [] as string[]);
    const candidates = entries.filter(
      (f) => f.startsWith('media.') && !/\.(part|ytdl|json|temp|tmp|vtt|srt)$/i.test(f) && !/\.f\d+\./.test(f),
    );
    return candidates.find((f) => f.endsWith(`.${want}`)) ?? candidates[0] ?? null;
  }

  /** Resolves a stored outputRef to an absolute path, refusing anything outside tempDir. */
  resolveOutput(outputRef: string): string {
    const root = path.resolve(this.cfg.tempDir);
    const full = path.resolve(root, outputRef);
    if (!full.startsWith(root + path.sep)) throw new AppError('NOT_FOUND');
    return full;
  }

  async removeJobDir(jobId: string) {
    if (!/^job_[A-Za-z0-9_-]+$/.test(jobId)) return;
    await rm(path.join(this.cfg.tempDir, jobId), { recursive: true, force: true });
  }

  private async ensureDir(name: string): Promise<string> {
    const dir = path.join(this.cfg.tempDir, name);
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
    } catch {
      throw new AppError('STORAGE_UNAVAILABLE');
    }
    return dir;
  }
}
