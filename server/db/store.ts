import { randomBytes } from 'node:crypto';
import type { ErrorCode } from '../../shared/errors.js';
import type { PlatformId } from '../../shared/platforms.js';
import type { ApiScope, JobStatus, MediaType, ProcessOptions, Quality, UserRole, WebhookEvent } from '../../shared/types.js';

export function newId(prefix: 'usr' | 'ses' | 'key' | 'job' | 'req' | 'aud' | 'anl'): string {
  return `${prefix}_${randomBytes(12).toString('base64url')}`;
}

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  role: UserRole;
  disabled: boolean;
  createdAt: Date;
}

export interface SessionRow {
  id: string;
  tokenHash: string;
  userId: string;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export interface ApiKeyRow {
  id: string;
  userId: string;
  name: string;
  keyHash: string;
  displayPrefix: string;
  scopes: ApiScope[];
  /** null = unlimited. */
  rateLimitPerMinute: number | null;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}

/** Who owns a job: an account, or a short-lived anonymous browser session. */
export type JobOwner = { userId: string } | { anonId: string };

export interface JobRow {
  id: string;
  requestId: string;
  userId: string | null;
  anonId: string | null;
  apiKeyId: string | null;
  sourceUrl: string;
  platform: PlatformId;
  title: string | null;
  durationSeconds: number | null;
  mediaType: MediaType;
  format: string;
  quality: Quality;
  options: ProcessOptions;
  status: JobStatus;
  progress: number;
  attempts: number;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  /** Opaque reference relative to MEDIA_TEMP_DIR — never a public path. */
  outputRef: string | null;
  outputFilename: string | null;
  outputSizeBytes: number | null;
  logs: string[];
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  hiddenAt: Date | null;
}

export interface AuditRow {
  id: string;
  requestId: string;
  userId: string | null;
  apiKeyId: string | null;
  action: string;
  ipHash: string | null;
  httpStatus: number | null;
  errorCode: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;
}

export interface RuntimeSettings {
  processingEnabled: boolean;
  maxFileSizeBytes: number | null;
  maxDurationSeconds: number | null;
}

export interface WebhookRow {
  userId: string;
  url: string | null;
  events: WebhookEvent[];
  secretEnc: string | null;
  updatedAt: Date;
}

export interface JobListQuery {
  owner?: JobOwner;
  platform?: PlatformId;
  status?: JobStatus;
  requestId?: string;
  includeHidden?: boolean;
  cursor?: { createdAt: Date; id: string } | null;
  limit: number;
}

export interface JobStats {
  total: number;
  failed: number;
  blocked: number;
  completed: number;
  avgProcessingMs: number | null;
}

export interface Store {
  readonly kind: 'memory' | 'file' | 'postgres';
  ping(): Promise<void>;
  close(): Promise<void>;

  createUser(u: Omit<UserRow, 'id' | 'createdAt' | 'disabled'>): Promise<UserRow>;
  findUserByEmail(email: string): Promise<UserRow | null>;
  findUserById(id: string): Promise<UserRow | null>;
  countUsers(): Promise<number>;

  createSession(s: Omit<SessionRow, 'id' | 'createdAt'>): Promise<SessionRow>;
  findSessionByTokenHash(hash: string): Promise<SessionRow | null>;
  deleteSession(id: string): Promise<void>;
  deleteUserSessions(userId: string): Promise<void>;
  deleteExpiredSessions(now: Date): Promise<number>;

  createApiKey(k: Omit<ApiKeyRow, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt' | 'revokedReason'>): Promise<ApiKeyRow>;
  findApiKeyByHash(hash: string): Promise<ApiKeyRow | null>;
  findApiKeyById(id: string): Promise<ApiKeyRow | null>;
  listApiKeys(userId: string | null, limit?: number): Promise<ApiKeyRow[]>;
  revokeApiKey(id: string, reason: string, at: Date): Promise<ApiKeyRow | null>;
  touchApiKey(id: string, at: Date): Promise<void>;
  updateApiKeyLimit(id: string, rateLimitPerMinute: number | null): Promise<ApiKeyRow | null>;
  countApiKeys(filter: { userId?: string; status: 'active' | 'revoked' }): Promise<number>;

  createJob(j: Omit<JobRow, 'createdAt'>): Promise<JobRow>;
  getJob(id: string): Promise<JobRow | null>;
  updateJob(id: string, patch: Partial<Omit<JobRow, 'id' | 'createdAt'>>): Promise<JobRow | null>;
  /** Atomically moves a job from "queued" to "active". Returns null if another worker won. */
  claimJob(id: string, patch: Partial<Omit<JobRow, 'id' | 'createdAt' | 'status'>>): Promise<JobRow | null>;
  listJobs(q: JobListQuery): Promise<JobRow[]>;
  countJobs(filter: { owner?: JobOwner; since?: Date; statuses?: JobStatus[] }): Promise<number>;
  listJobsByStatus(statuses: JobStatus[], limit: number): Promise<JobRow[]>;
  listExpirable(now: Date, limit: number): Promise<JobRow[]>;
  jobStats(since: Date): Promise<JobStats>;

  addAudit(a: Omit<AuditRow, 'id' | 'createdAt'>): Promise<void>;
  findAuditByRequestId(requestId: string): Promise<AuditRow[]>;
  countAudit(action: string, since: Date): Promise<number>;

  getSettings(): Promise<RuntimeSettings>;
  updateSettings(patch: Partial<RuntimeSettings>): Promise<RuntimeSettings>;

  getWebhook(userId: string): Promise<WebhookRow | null>;
  upsertWebhook(w: WebhookRow): Promise<WebhookRow>;
}

export const DEFAULT_SETTINGS: RuntimeSettings = {
  processingEnabled: true,
  maxFileSizeBytes: null,
  maxDurationSeconds: null,
};

export function ownerMatches(row: Pick<JobRow, 'userId' | 'anonId'>, owner: JobOwner): boolean {
  return 'userId' in owner ? row.userId === owner.userId : row.anonId === owner.anonId;
}

export function encodeCursor(row: Pick<JobRow, 'createdAt' | 'id'>): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

export function decodeCursor(raw: string | undefined): { createdAt: Date; id: string } | null {
  if (!raw) return null;
  try {
    const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    const d = new Date(iso ?? '');
    if (!id || Number.isNaN(d.getTime())) return null;
    return { createdAt: d, id };
  } catch {
    return null;
  }
}
