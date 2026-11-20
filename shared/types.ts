import { z } from 'zod';
import type { ErrorCode } from './errors.js';
import type { PlatformId } from './platforms.js';

/* ---------------------------------- Scopes --------------------------------- */

export const API_SCOPES = ['analyze', 'process', 'activity', 'webhooks', 'admin'] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const DEFAULT_SCOPES: ApiScope[] = ['analyze', 'activity'];
export const KEY_RATE_LIMIT_OPTIONS = [30, 60, 120, 300] as const;
export const MAX_KEY_RATE_LIMIT = 1_000_000;

export type UserRole = 'user' | 'admin' | 'owner';

/* ------------------------------- Media options ------------------------------ */

export const MEDIA_TYPES = ['video', 'audio', 'thumbnail'] as const;
export const VIDEO_CONTAINERS = ['mp4', 'webm'] as const;
export const AUDIO_FORMATS = ['mp3', 'm4a', 'wav'] as const;
export const QUALITIES = ['best', '2160', '1440', '1080', '720', '480', 'audio'] as const;
export const AUDIO_MODES = ['original', 'highest', 'normalized'] as const;
export const AUDIO_BITRATES = ['auto', '128', '192', '256', '320'] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];
export type Quality = (typeof QUALITIES)[number];

export const processOptionsSchema = z
  .object({
    mediaType: z.enum(MEDIA_TYPES),
    container: z.enum(VIDEO_CONTAINERS).default('mp4'),
    audioFormat: z.enum(AUDIO_FORMATS).default('mp3'),
    quality: z.enum(QUALITIES).default('best'),
    audioMode: z.enum(AUDIO_MODES).default('original'),
    audioBitrate: z.enum(AUDIO_BITRATES).default('auto'),
    embedMetadata: z.boolean().default(true),
    embedThumbnail: z.boolean().default(false),
    subtitleLang: z
      .string()
      .regex(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/)
      .nullable()
      .default(null),
  })
  .strict();

export type ProcessOptions = z.infer<typeof processOptionsSchema>;

export const urlInputSchema = z.object({ url: z.string().trim().min(8).max(2048) }).strict();

export const processRequestSchema = z
  .object({
    url: z.string().trim().min(8).max(2048),
    options: processOptionsSchema,
    /** User confirms they own or are authorized to use the media. */
    rightsConfirmed: z.literal(true),
  })
  .strict();

/* -------------------------------- Analysis --------------------------------- */

export interface FormatSummary {
  id: string;
  kind: 'video' | 'audio' | 'muxed';
  ext: string;
  height: number | null;
  fps: number | null;
  abr: number | null;
  vcodec: string | null;
  acodec: string | null;
  filesize: number | null;
}

export interface AnalysisResult {
  analysisId: string;
  platform: PlatformId;
  platformName: string;
  sourceUrl: string;
  title: string;
  uploader: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  hasVideo: boolean;
  hasAudio: boolean;
  availableHeights: number[];
  formats: FormatSummary[];
  subtitles: string[];
  estimatedSizes: Partial<Record<Quality, number | null>>;
  safeUse: {
    status: 'allowed' | 'blocked';
    reason: ErrorCode | null;
    notice: string;
  };
  limits: { maxFileSizeBytes: number; maxDurationSeconds: number };
}

/* ---------------------------------- Jobs ----------------------------------- */

export const JOB_STATUSES = ['queued', 'active', 'ready', 'completed', 'blocked', 'failed', 'cancelled', 'expired'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const TERMINAL_STATUSES: JobStatus[] = ['completed', 'blocked', 'failed', 'cancelled', 'expired'];

export interface JobView {
  id: string;
  requestId: string;
  platform: PlatformId;
  sourceUrl: string;
  title: string | null;
  mediaType: MediaType;
  format: string;
  quality: Quality;
  status: JobStatus;
  progress: number;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  outputFilename: string | null;
  outputSizeBytes: number | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  logs: string[];
}

/* -------------------------------- API keys --------------------------------- */

export interface ApiKeyView {
  id: string;
  name: string;
  displayPrefix: string;
  scopes: ApiScope[];
  /** null = unlimited (no per-key rate limit, no daily job quota). Only admins can set it. */
  rateLimitPerMinute: number | null;
  status: 'active' | 'revoked';
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const keyLimitSchema = z
  .object({ rateLimitPerMinute: z.number().int().min(1).max(MAX_KEY_RATE_LIMIT).nullable() })
  .strict();

export const createKeySchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
    /** Normal users: one of KEY_RATE_LIMIT_OPTIONS. Admins: any 1–1,000,000, or null for unlimited. */
    rateLimitPerMinute: z.number().int().min(1).max(1_000_000).nullable(),
  })
  .strict();

/* ---------------------------------- Auth ----------------------------------- */

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(10).max(200),
    displayName: z.string().trim().min(1).max(60),
  })
  .strict();

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(200),
  })
  .strict();

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  createdAt: string;
}

export interface MeResponse {
  user: SessionUser | null;
  csrfToken: string;
  anonymous: { analyzeAllowed: boolean; processingAllowed: boolean };
  quota: { dailyJobs: number; usedToday: number; maxActiveJobs: number; maxApiKeys: number };
}

/* --------------------------------- System ---------------------------------- */

export interface ComponentHealth {
  status: 'up' | 'down' | 'disabled';
  detail?: string;
  version?: string;
}

export interface SystemStatus {
  status: 'operational' | 'degraded' | 'maintenance';
  processingEnabled: boolean;
  components: {
    ytdlp: ComponentHealth;
    ffmpeg: ComponentHealth;
    database: ComponentHealth;
    redis: ComponentHealth;
    storage: ComponentHealth;
  };
  platforms: { id: PlatformId; name: string; glyph: string; scope: string; enabled: boolean }[];
  limits: { maxFileSizeBytes: number; maxDurationSeconds: number; retentionMinutes: number };
}

export const WEBHOOK_EVENTS = ['job.queued', 'job.ready', 'job.failed', 'job.blocked', 'job.cancelled'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const webhookConfigSchema = z
  .object({
    url: z.string().url().max(2048).nullable(),
    events: z.array(z.enum(WEBHOOK_EVENTS)).max(WEBHOOK_EVENTS.length),
  })
  .strict();
