/**
 * Structured JSON logger with mandatory secret redaction.
 * Every log line passes through `redact` — API keys, bearer tokens, cookies,
 * passwords and signed URLs never reach stdout, the admin log viewer, or disk.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

const SENSITIVE_KEYS =
  /^(authorization|cookie|set-cookie|password|pass|secret|token|apikey|api_key|rawkey|key|session|csrf|x-api-key|signature|pepper)$/i;

const PATTERNS: [RegExp, string][] = [
  [/rjar_(live|test)_[A-Za-z0-9]{8,}/g, 'rjar_$1_[REDACTED]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]'],
  [/(rx_session|rx_csrf|rx_anon)=[^;\s]+/gi, '$1=[REDACTED]'],
  [/([?&](?:sig|signature|token|key|api_key|auth|expire|policy)=)[^&\s"]+/gi, '$1[REDACTED]'],
  [/(--cookies(?:-from-browser)?\s+)\S+/gi, '$1[REDACTED]'],
];

export function redactString(input: string): string {
  let out = input;
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: redactString(value.message) };
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface LogEntry {
  ts: string;
  level: Level;
  msg: string;
  [k: string]: unknown;
}

const RING_SIZE = 500;
const ring: LogEntry[] = [];
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let minLevel: Level = (process.env.LOG_LEVEL as Level) || 'info';
let silent = process.env.NODE_ENV === 'test';

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (order[level] < order[minLevel]) return;
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: redactString(msg),
    ...((fields ? redact(fields) : {}) as Record<string, unknown>),
  } as LogEntry;
  ring.push(entry);
  if (ring.length > RING_SIZE) ring.shift();
  if (!silent) {
    const line = JSON.stringify(entry);
    if (level === 'error' || level === 'warn') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, f?: Record<string, unknown>) => write('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => write('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => write('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => write('error', msg, f),
  recent: (limit = 200, level?: Level) => ring.filter((e) => !level || order[e.level] >= order[level]).slice(-limit),
  setLevel: (l: Level) => (minLevel = l),
  setSilent: (s: boolean) => (silent = s),
};
