import {
  DEFAULT_SETTINGS,
  newId,
  ownerMatches,
  type ApiKeyRow,
  type AuditRow,
  type JobListQuery,
  type JobOwner,
  type JobRow,
  type RuntimeSettings,
  type SessionRow,
  type Store,
  type UserRow,
  type WebhookRow,
} from './store.js';
import { TERMINAL_STATUSES } from '../../shared/types.js';

const clone = <T>(v: T): T => structuredClone(v);

/**
 * In-memory store for development, tests and single-process demos.
 * Data is lost on restart. Production deployments use the Postgres store.
 */
export class MemoryStore implements Store {
  readonly kind: 'memory' | 'file' = 'memory';
  protected users = new Map<string, UserRow>();
  protected sessions = new Map<string, SessionRow>();
  protected keys = new Map<string, ApiKeyRow>();
  protected jobs = new Map<string, JobRow>();
  protected audit: AuditRow[] = [];
  protected settings: RuntimeSettings = { ...DEFAULT_SETTINGS };
  protected webhooks = new Map<string, WebhookRow>();

  async ping() {}
  async close() {}

  async createUser(u: Omit<UserRow, 'id' | 'createdAt' | 'disabled'>) {
    const row: UserRow = { ...u, id: newId('usr'), disabled: false, createdAt: new Date() };
    this.users.set(row.id, row);
    return clone(row);
  }
  async findUserByEmail(email: string) {
    for (const u of this.users.values()) if (u.email === email) return clone(u);
    return null;
  }
  async findUserById(id: string) {
    const u = this.users.get(id);
    return u ? clone(u) : null;
  }
  async countUsers() {
    return this.users.size;
  }

  async createSession(s: Omit<SessionRow, 'id' | 'createdAt'>) {
    const row: SessionRow = { ...s, id: newId('ses'), createdAt: new Date() };
    this.sessions.set(row.id, row);
    return clone(row);
  }
  async findSessionByTokenHash(hash: string) {
    for (const s of this.sessions.values()) if (s.tokenHash === hash) return clone(s);
    return null;
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async deleteUserSessions(userId: string) {
    for (const [id, s] of this.sessions) if (s.userId === userId) this.sessions.delete(id);
  }
  async deleteExpiredSessions(now: Date) {
    let n = 0;
    for (const [id, s] of this.sessions) {
      if (s.expiresAt <= now) {
        this.sessions.delete(id);
        n++;
      }
    }
    return n;
  }

  async createApiKey(k: Omit<ApiKeyRow, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt' | 'revokedReason'>) {
    const row: ApiKeyRow = {
      ...k,
      id: newId('key'),
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
      revokedReason: null,
    };
    this.keys.set(row.id, row);
    return clone(row);
  }
  async findApiKeyByHash(hash: string) {
    for (const k of this.keys.values()) if (k.keyHash === hash) return clone(k);
    return null;
  }
  async findApiKeyById(id: string) {
    const k = this.keys.get(id);
    return k ? clone(k) : null;
  }
  async listApiKeys(userId: string | null, limit = 200) {
    return [...this.keys.values()]
      .filter((k) => userId === null || k.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }
  async revokeApiKey(id: string, reason: string, at: Date) {
    const k = this.keys.get(id);
    if (!k) return null;
    if (!k.revokedAt) {
      k.revokedAt = at;
      k.revokedReason = reason;
    }
    return clone(k);
  }
  async updateApiKeyLimit(id: string, rateLimitPerMinute: number | null) {
    const k = this.keys.get(id);
    if (!k) return null;
    k.rateLimitPerMinute = rateLimitPerMinute;
    return clone(k);
  }
  async touchApiKey(id: string, at: Date) {
    const k = this.keys.get(id);
    if (k) k.lastUsedAt = at;
  }
  async countApiKeys(filter: { userId?: string; status: 'active' | 'revoked' }) {
    return [...this.keys.values()].filter(
      (k) => (!filter.userId || k.userId === filter.userId) && (filter.status === 'active' ? !k.revokedAt : !!k.revokedAt),
    ).length;
  }

  async createJob(j: Omit<JobRow, 'createdAt'>) {
    const row: JobRow = { ...j, createdAt: new Date() };
    this.jobs.set(row.id, row);
    return clone(row);
  }
  async getJob(id: string) {
    const j = this.jobs.get(id);
    return j ? clone(j) : null;
  }
  async updateJob(id: string, patch: Partial<Omit<JobRow, 'id' | 'createdAt'>>) {
    const j = this.jobs.get(id);
    if (!j) return null;
    Object.assign(j, clone(patch));
    return clone(j);
  }
  async claimJob(id: string, patch: Partial<Omit<JobRow, 'id' | 'createdAt' | 'status'>>) {
    const j = this.jobs.get(id);
    if (!j || j.status !== 'queued') return null;
    Object.assign(j, clone(patch), { status: 'active' });
    return clone(j);
  }
  async listJobs(q: JobListQuery) {
    return [...this.jobs.values()]
      .filter((j) => !q.owner || ownerMatches(j, q.owner))
      .filter((j) => !q.platform || j.platform === q.platform)
      .filter((j) => !q.status || j.status === q.status)
      .filter((j) => !q.requestId || j.requestId === q.requestId)
      .filter((j) => q.includeHidden || !j.hiddenAt)
      .filter(
        (j) =>
          !q.cursor ||
          j.createdAt < q.cursor.createdAt ||
          (j.createdAt.getTime() === q.cursor.createdAt.getTime() && j.id < q.cursor.id),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : -1))
      .slice(0, q.limit)
      .map(clone);
  }
  async countJobs(filter: { owner?: JobOwner; since?: Date; statuses?: JobRow['status'][] }) {
    return [...this.jobs.values()].filter(
      (j) =>
        (!filter.owner || ownerMatches(j, filter.owner)) &&
        (!filter.since || j.createdAt >= filter.since) &&
        (!filter.statuses || filter.statuses.includes(j.status)),
    ).length;
  }
  async listJobsByStatus(statuses: JobRow['status'][], limit: number) {
    return [...this.jobs.values()]
      .filter((j) => statuses.includes(j.status))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }
  async listExpirable(now: Date, limit: number) {
    return [...this.jobs.values()]
      .filter((j) => j.outputRef && j.expiresAt && j.expiresAt <= now)
      .slice(0, limit)
      .map(clone);
  }
  async jobStats(since: Date) {
    const rows = [...this.jobs.values()].filter((j) => j.createdAt >= since);
    const durations = rows
      .filter((j) => j.startedAt && j.completedAt && (j.status === 'ready' || j.status === 'completed'))
      .map((j) => j.completedAt!.getTime() - j.startedAt!.getTime());
    return {
      total: rows.length,
      failed: rows.filter((j) => j.status === 'failed').length,
      blocked: rows.filter((j) => j.status === 'blocked').length,
      completed: rows.filter((j) => j.status === 'ready' || j.status === 'completed').length,
      avgProcessingMs: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    };
  }

  async addAudit(a: Omit<AuditRow, 'id' | 'createdAt'>) {
    this.audit.push({ ...clone(a), id: newId('aud'), createdAt: new Date() });
    if (this.audit.length > 20_000) this.audit.splice(0, 5_000);
  }
  async findAuditByRequestId(requestId: string) {
    return this.audit.filter((a) => a.requestId === requestId).map(clone);
  }
  async countAudit(action: string, since: Date) {
    return this.audit.filter((a) => a.action === action && a.createdAt >= since).length;
  }

  async getSettings() {
    return { ...this.settings };
  }
  async updateSettings(patch: Partial<RuntimeSettings>) {
    this.settings = { ...this.settings, ...patch };
    return { ...this.settings };
  }

  async getWebhook(userId: string) {
    const w = this.webhooks.get(userId);
    return w ? clone(w) : null;
  }
  async upsertWebhook(w: WebhookRow) {
    this.webhooks.set(w.userId, clone(w));
    return clone(w);
  }

  /** Test helper. */
  _terminalCount() {
    return [...this.jobs.values()].filter((j) => TERMINAL_STATUSES.includes(j.status)).length;
  }
}
