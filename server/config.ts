import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Persistent data directory. On RAJAR X HOSTING /data is a VPS folder that survives redeploys.
 * Override with DATA_DIR.
 */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env) {
  const base =
    env.DATA_DIR || env.PERSISTENT_DIR || env.RAJARX_DATA_DIR || (existsSync('/data') ? '/data' : path.resolve('data'));
  return env.DATA_DIR ? base : path.join(base, 'rajar-x-yt');
}

/** Generates SESSION_SECRET / API_KEY_PEPPER once and keeps them in the data directory. */
function persistentSecrets(dataDir: string) {
  const file = path.join(dataDir, 'secrets.json');
  try {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8')) as { sessionSecret?: string; apiKeyPepper?: string };
      if (saved.sessionSecret && saved.apiKeyPepper) return saved as { sessionSecret: string; apiKeyPepper: string };
    }
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const created = { sessionSecret: randomBytes(48).toString('base64url'), apiKeyPepper: randomBytes(48).toString('base64url') };
    writeFileSync(file, JSON.stringify(created, null, 2), { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {
      /* best effort */
    }
    return created;
  } catch {
    return null;
  }
}

/** Finds yt-dlp / FFmpeg: env → binaries installed into ./bin by scripts/install-media-tools.mjs → PATH. */
function resolveBinary(envValue: string | undefined, local: string, fallback: string) {
  if (envValue) return envValue;
  const candidate = path.resolve(local);
  return existsSync(candidate) ? candidate : fallback;
}

/** Parses sizes like "500M", "2G", "750k" or plain bytes. */
export function parseSize(input: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmgt]?)b?\s*$/i.exec(input);
  if (!m) throw new Error(`Invalid size: ${input}`);
  const n = Number(m[1]);
  const unit = (m[2] ?? '').toLowerCase();
  const mult = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 }[unit] ?? 1;
  return Math.floor(n * mult);
}

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0', 'yes', 'no'])
    .optional()
    .transform((v) => (v === undefined ? def : ['true', '1', 'yes'].includes(v)));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  APP_VERSION: z.string().default('1.0.0'),
  PUBLIC_BASE_URL: z.string().url().optional(),
  RAJARX_PUBLIC_URL: z.string().url().optional(),
  ALLOWED_ORIGINS: csv,
  ALLOWED_HOSTS: csv,
  TRUST_PROXY: z.string().optional(),
  CSP_FRAME_ANCESTORS: csv,

  YTDLP_BIN: z.string().optional(),
  FFMPEG_BIN: z.string().optional(),
  MEDIA_TEMP_DIR: z.string().default('/tmp/rajar-x-media'),
  MEDIA_MAX_FILE_SIZE: z.string().default('500M').transform(parseSize),
  MEDIA_MAX_DURATION: z.coerce.number().int().positive().default(7200),
  MEDIA_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
  MEDIA_ANALYZE_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  MEDIA_RETENTION_MINUTES: z.coerce.number().int().positive().default(30),
  MEDIA_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(2),
  MEDIA_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  MEDIA_EXTRA_ALLOWED_DOMAINS: csv,
  PLATFORMS_DISABLED: csv,
  STORAGE_MAX_BYTES: z.string().default('20G').transform(parseSize),

  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(20),
  USER_DAILY_JOB_QUOTA: z.coerce.number().int().min(0).default(50),
  USER_MAX_ACTIVE_JOBS: z.coerce.number().int().min(1).default(2),
  USER_MAX_API_KEYS: z.coerce.number().int().min(0).default(10),
  ALLOW_ANONYMOUS_ANALYZE: bool(true),
  ALLOW_ANONYMOUS_PROCESSING: bool(false),
  ANON_DAILY_JOB_QUOTA: z.coerce.number().int().min(0).default(2),
  ADMIN_SCOPE_ENABLED: bool(false),

  DATABASE_URL: z.string().optional().default(''),
  REDIS_URL: z.string().optional().default(''),
  SESSION_SECRET: z.string().optional().default(''),
  API_KEY_PEPPER: z.string().optional().default(''),
  OWNER_EMAIL: z.string().optional().default(''),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 14),
  SUPPORT_EMAIL: z.string().default('support@example.com'),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${fields}`);
  }
  const c = parsed.data;
  const isProd = c.NODE_ENV === 'production';
  const dataDir = resolveDataDir(env);
  const hosted = Boolean(env.RAJARX_DATA_DIR || env.PERSISTENT_DIR || env.RAJARX_PUBLIC_URL);

  // Secrets: use env values when given, otherwise generate once and keep them on disk.
  if (c.NODE_ENV !== 'test' && (!c.SESSION_SECRET || !c.API_KEY_PEPPER)) {
    const saved = persistentSecrets(dataDir);
    if (saved) {
      if (!c.SESSION_SECRET) c.SESSION_SECRET = saved.sessionSecret;
      if (!c.API_KEY_PEPPER) c.API_KEY_PEPPER = saved.apiKeyPepper;
    }
  }
  if (isProd) {
    for (const key of ['SESSION_SECRET', 'API_KEY_PEPPER'] as const) {
      if (!c[key]) throw new Error(`${key} must be set in production (or make the data directory writable).`);
    }
    if (c.SESSION_SECRET.length < 32 || c.API_KEY_PEPPER.length < 32) {
      throw new Error('SESSION_SECRET and API_KEY_PEPPER must be at least 32 characters.');
    }
  }

  // Development fallbacks are random per boot, so nothing usable is ever hardcoded.
  const devSecret = () => `dev-${crypto.randomUUID()}-${crypto.randomUUID()}`;
  // Public URL: explicit → the project subdomain given by RAJAR X HOSTING → localhost (dev).
  const publicUrl = c.PUBLIC_BASE_URL || c.RAJARX_PUBLIC_URL || `http://localhost:${isProd ? c.PORT : 5173}`;
  const base = new URL(publicUrl);
  const knownPublicUrl = Boolean(c.PUBLIC_BASE_URL || c.RAJARX_PUBLIC_URL);
  const extraHosts = c.ALLOWED_HOSTS.filter((h) => h !== '*');
  // Without a known public URL every Host is accepted ("*"), so the app works behind any domain.
  const anyHost = c.ALLOWED_HOSTS.includes('*') || (!knownPublicUrl && isProd);
  const allowedOrigins = c.ALLOWED_ORIGINS.length ? c.ALLOWED_ORIGINS : [base.origin, ...extraHosts.map((h) => `https://${h}`)];
  const allowedHosts = anyHost
    ? ['*']
    : extraHosts.length
      ? [base.host, ...extraHosts]
      : isProd
        ? [base.host]
        : [base.host, `localhost:${c.PORT}`, `127.0.0.1:${c.PORT}`];

  const secureCookies = isProd || c.COOKIE_SAMESITE === 'none';

  return {
    env: c.NODE_ENV,
    isProd,
    port: c.PORT,
    host: c.HOST,
    version: c.APP_VERSION,
    publicBaseUrl: base.origin,
    allowedOrigins,
    allowedHosts,
    trustProxy: c.TRUST_PROXY || (hosted ? 'uniquelocal' : 'loopback'),
    dataDir,
    anyOrigin: anyHost,
    cspFrameAncestors: c.CSP_FRAME_ANCESTORS,
    media: {
      ytdlpBin: resolveBinary(c.YTDLP_BIN, 'bin/yt-dlp', 'yt-dlp'),
      ffmpegBin: resolveBinary(c.FFMPEG_BIN, 'bin/ffmpeg', 'ffmpeg'),
      tempDir: c.MEDIA_TEMP_DIR,
      maxFileSizeBytes: c.MEDIA_MAX_FILE_SIZE,
      maxDurationSeconds: c.MEDIA_MAX_DURATION,
      jobTimeoutMs: c.MEDIA_JOB_TIMEOUT_MS,
      analyzeTimeoutMs: c.MEDIA_ANALYZE_TIMEOUT_MS,
      retentionMinutes: c.MEDIA_RETENTION_MINUTES,
      concurrency: c.MEDIA_CONCURRENCY,
      maxRetries: c.MEDIA_MAX_RETRIES,
      extraAllowedDomains: c.MEDIA_EXTRA_ALLOWED_DOMAINS.map((d) => d.toLowerCase()),
      disabledPlatforms: c.PLATFORMS_DISABLED.map((d) => d.toLowerCase()),
      storageMaxBytes: c.STORAGE_MAX_BYTES,
    },
    limits: {
      windowSeconds: c.RATE_LIMIT_WINDOW_SECONDS,
      maxRequests: c.RATE_LIMIT_MAX_REQUESTS,
      userDailyJobs: c.USER_DAILY_JOB_QUOTA,
      userMaxActiveJobs: c.USER_MAX_ACTIVE_JOBS,
      userMaxApiKeys: c.USER_MAX_API_KEYS,
      anonAnalyze: c.ALLOW_ANONYMOUS_ANALYZE,
      anonProcessing: c.ALLOW_ANONYMOUS_PROCESSING,
      anonDailyJobs: c.ANON_DAILY_JOB_QUOTA,
      adminScopeEnabled: c.ADMIN_SCOPE_ENABLED,
    },
    databaseUrl: c.DATABASE_URL === '' && c.NODE_ENV === 'test' ? 'memory' : c.DATABASE_URL,
    redisUrl: c.REDIS_URL,
    sessionSecret: c.SESSION_SECRET || devSecret(),
    apiKeyPepper: c.API_KEY_PEPPER || devSecret(),
    ownerEmail: c.OWNER_EMAIL.trim().toLowerCase(),
    cookies: {
      sameSite: c.COOKIE_SAMESITE,
      secure: secureCookies,
      sessionTtlMs: c.SESSION_TTL_HOURS * 3600_000,
    },
    supportEmail: c.SUPPORT_EMAIL,
  };
}
