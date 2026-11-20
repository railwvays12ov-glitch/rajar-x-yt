import { MemoryStore } from './memoryStore.js';
import type {
  ApiKeyRow,
  AuditRow,
  JobListQuery,
  JobOwner,
  JobRow,
  RuntimeSettings,
  SessionRow,
  Store,
  UserRow,
  WebhookRow,
} from './store.js';
import type { JobStatus } from '../../shared/types.js';

/**
 * Privacy wrapper: only ACCOUNT data reaches the persistent store (file or PostgreSQL) —
 * users, sessions, API keys, webhook settings and admin settings.
 *
 * Jobs/activity history and audit entries live in memory only and disappear on restart.
 * Media files are temporary and deleted after download or expiry (see JobService / CleanupWorker).
 */
export class AccountsOnlyStore implements Store {
  private readonly ephemeral = new MemoryStore();

  constructor(private readonly accounts: Store) {}

  get kind() {
    return this.accounts.kind;
  }
  ping() {
    return this.accounts.ping();
  }
  close() {
    return this.accounts.close();
  }

  // ── Accounts (persistent) ────────────────────────────────────────────────
  createUser(u: Omit<UserRow, 'id' | 'createdAt' | 'disabled'>) {
    return this.accounts.createUser(u);
  }
  findUserByEmail(email: string) {
    return this.accounts.findUserByEmail(email);
  }
  findUserById(id: string) {
    return this.accounts.findUserById(id);
  }
  countUsers() {
    return this.accounts.countUsers();
  }
  createSession(s: Omit<SessionRow, 'id' | 'createdAt'>) {
    return this.accounts.createSession(s);
  }
  findSessionByTokenHash(hash: string) {
    return this.accounts.findSessionByTokenHash(hash);
  }
  deleteSession(id: string) {
    return this.accounts.deleteSession(id);
  }
  deleteUserSessions(userId: string) {
    return this.accounts.deleteUserSessions(userId);
  }
  deleteExpiredSessions(now: Date) {
    return this.accounts.deleteExpiredSessions(now);
  }
  createApiKey(k: Omit<ApiKeyRow, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt' | 'revokedReason'>) {
    return this.accounts.createApiKey(k);
  }
  findApiKeyByHash(hash: string) {
    return this.accounts.findApiKeyByHash(hash);
  }
  findApiKeyById(id: string) {
    return this.accounts.findApiKeyById(id);
  }
  listApiKeys(userId: string | null, limit?: number) {
    return this.accounts.listApiKeys(userId, limit);
  }
  revokeApiKey(id: string, reason: string, at: Date) {
    return this.accounts.revokeApiKey(id, reason, at);
  }
  touchApiKey(id: string, at: Date) {
    return this.accounts.touchApiKey(id, at);
  }
  updateApiKeyLimit(id: string, rateLimitPerMinute: number | null) {
    return this.accounts.updateApiKeyLimit(id, rateLimitPerMinute);
  }
  countApiKeys(filter: { userId?: string; status: 'active' | 'revoked' }) {
    return this.accounts.countApiKeys(filter);
  }
  getSettings() {
    return this.accounts.getSettings();
  }
  updateSettings(patch: Partial<RuntimeSettings>) {
    return this.accounts.updateSettings(patch);
  }
  getWebhook(userId: string) {
    return this.accounts.getWebhook(userId);
  }
  upsertWebhook(w: WebhookRow) {
    return this.accounts.upsertWebhook(w);
  }

  // ── Activity & audit (memory only, never written to disk) ────────────────
  createJob(j: Omit<JobRow, 'createdAt'>) {
    return this.ephemeral.createJob(j);
  }
  getJob(id: string) {
    return this.ephemeral.getJob(id);
  }
  updateJob(id: string, patch: Partial<Omit<JobRow, 'id' | 'createdAt'>>) {
    return this.ephemeral.updateJob(id, patch);
  }
  claimJob(id: string, patch: Partial<Omit<JobRow, 'id' | 'createdAt' | 'status'>>) {
    return this.ephemeral.claimJob(id, patch);
  }
  listJobs(q: JobListQuery) {
    return this.ephemeral.listJobs(q);
  }
  countJobs(filter: { owner?: JobOwner; since?: Date; statuses?: JobStatus[] }) {
    return this.ephemeral.countJobs(filter);
  }
  listJobsByStatus(statuses: JobStatus[], limit: number) {
    return this.ephemeral.listJobsByStatus(statuses, limit);
  }
  listExpirable(now: Date, limit: number) {
    return this.ephemeral.listExpirable(now, limit);
  }
  jobStats(since: Date) {
    return this.ephemeral.jobStats(since);
  }
  addAudit(a: Omit<AuditRow, 'id' | 'createdAt'>) {
    return this.ephemeral.addAudit(a);
  }
  findAuditByRequestId(requestId: string) {
    return this.ephemeral.findAuditByRequestId(requestId);
  }
  countAudit(action: string, since: Date) {
    return this.ephemeral.countAudit(action, since);
  }
}
