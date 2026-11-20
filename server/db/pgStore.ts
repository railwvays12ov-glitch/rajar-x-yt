import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import {
  DEFAULT_SETTINGS,
  newId,
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
import type { JobStatus } from '../../shared/types.js';

const { users, sessions, apiKeys, jobs, auditLogs, settings, webhooks } = schema;

/** PostgreSQL store. All queries are parameterized by Drizzle — no string-built SQL. */
export class PgStore implements Store {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;
  private readonly db: NodePgDatabase<typeof schema>;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({
      connectionString: databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      statement_timeout: 15_000,
    });
    this.db = drizzle(this.pool, { schema });
  }

  async ping() {
    await this.pool.query('select 1');
  }
  async close() {
    await this.pool.end();
  }

  private ownerWhere(owner: JobOwner): SQL {
    return 'userId' in owner ? eq(jobs.userId, owner.userId) : eq(jobs.anonId, owner.anonId);
  }

  async createUser(u: Omit<UserRow, 'id' | 'createdAt' | 'disabled'>) {
    const [row] = await this.db
      .insert(users)
      .values({ ...u, id: newId('usr') })
      .returning();
    return row as UserRow;
  }
  async findUserByEmail(email: string) {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return (row as UserRow | undefined) ?? null;
  }
  async findUserById(id: string) {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return (row as UserRow | undefined) ?? null;
  }
  async countUsers() {
    const [r] = await this.db.select({ n: count() }).from(users);
    return Number(r?.n ?? 0);
  }

  async createSession(s: Omit<SessionRow, 'id' | 'createdAt'>) {
    const [row] = await this.db
      .insert(sessions)
      .values({ ...s, id: newId('ses') })
      .returning();
    return row as SessionRow;
  }
  async findSessionByTokenHash(hash: string) {
    const [row] = await this.db.select().from(sessions).where(eq(sessions.tokenHash, hash)).limit(1);
    return (row as SessionRow | undefined) ?? null;
  }
  async deleteSession(id: string) {
    await this.db.delete(sessions).where(eq(sessions.id, id));
  }
  async deleteUserSessions(userId: string) {
    await this.db.delete(sessions).where(eq(sessions.userId, userId));
  }
  async deleteExpiredSessions(now: Date) {
    const rows = await this.db.delete(sessions).where(lte(sessions.expiresAt, now)).returning({ id: sessions.id });
    return rows.length;
  }

  async createApiKey(k: Omit<ApiKeyRow, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt' | 'revokedReason'>) {
    const [row] = await this.db
      .insert(apiKeys)
      .values({ ...k, id: newId('key') })
      .returning();
    return row as ApiKeyRow;
  }
  async findApiKeyByHash(hash: string) {
    const [row] = await this.db.select().from(apiKeys).where(eq(apiKeys.keyHash, hash)).limit(1);
    return (row as ApiKeyRow | undefined) ?? null;
  }
  async findApiKeyById(id: string) {
    const [row] = await this.db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    return (row as ApiKeyRow | undefined) ?? null;
  }
  async listApiKeys(userId: string | null, limit = 200) {
    const q = this.db.select().from(apiKeys);
    const rows = await (userId ? q.where(eq(apiKeys.userId, userId)) : q).orderBy(desc(apiKeys.createdAt)).limit(limit);
    return rows as ApiKeyRow[];
  }
  async revokeApiKey(id: string, reason: string, at: Date) {
    await this.db
      .update(apiKeys)
      .set({ revokedAt: at, revokedReason: reason })
      .where(and(eq(apiKeys.id, id), isNull(apiKeys.revokedAt)));
    return this.findApiKeyById(id);
  }
  async updateApiKeyLimit(id: string, rateLimitPerMinute: number | null) {
    await this.db.update(apiKeys).set({ rateLimitPerMinute }).where(eq(apiKeys.id, id));
    return this.findApiKeyById(id);
  }
  async touchApiKey(id: string, at: Date) {
    await this.db.update(apiKeys).set({ lastUsedAt: at }).where(eq(apiKeys.id, id));
  }
  async countApiKeys(filter: { userId?: string; status: 'active' | 'revoked' }) {
    const conds: SQL[] = [filter.status === 'active' ? isNull(apiKeys.revokedAt) : isNotNull(apiKeys.revokedAt)];
    if (filter.userId) conds.push(eq(apiKeys.userId, filter.userId));
    const [r] = await this.db
      .select({ n: count() })
      .from(apiKeys)
      .where(and(...conds));
    return Number(r?.n ?? 0);
  }

  async createJob(j: Omit<JobRow, 'createdAt'>) {
    const [row] = await this.db.insert(jobs).values(j).returning();
    return row as JobRow;
  }
  async getJob(id: string) {
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    return (row as JobRow | undefined) ?? null;
  }
  async updateJob(id: string, patch: Partial<Omit<JobRow, 'id' | 'createdAt'>>) {
    const [row] = await this.db.update(jobs).set(patch).where(eq(jobs.id, id)).returning();
    return (row as JobRow | undefined) ?? null;
  }
  async claimJob(id: string, patch: Partial<Omit<JobRow, 'id' | 'createdAt' | 'status'>>) {
    const [row] = await this.db
      .update(jobs)
      .set({ ...patch, status: 'active' })
      .where(and(eq(jobs.id, id), eq(jobs.status, 'queued')))
      .returning();
    return (row as JobRow | undefined) ?? null;
  }
  async listJobs(q: JobListQuery) {
    const conds: SQL[] = [];
    if (q.owner) conds.push(this.ownerWhere(q.owner));
    if (q.platform) conds.push(eq(jobs.platform, q.platform));
    if (q.status) conds.push(eq(jobs.status, q.status));
    if (q.requestId) conds.push(eq(jobs.requestId, q.requestId));
    if (!q.includeHidden) conds.push(isNull(jobs.hiddenAt));
    if (q.cursor) {
      conds.push(
        or(lt(jobs.createdAt, q.cursor.createdAt), and(eq(jobs.createdAt, q.cursor.createdAt), lt(jobs.id, q.cursor.id)))!,
      );
    }
    const rows = await this.db
      .select()
      .from(jobs)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(jobs.createdAt), desc(jobs.id))
      .limit(q.limit);
    return rows as JobRow[];
  }
  async countJobs(filter: { owner?: JobOwner; since?: Date; statuses?: JobStatus[] }) {
    const conds: SQL[] = [];
    if (filter.owner) conds.push(this.ownerWhere(filter.owner));
    if (filter.since) conds.push(gte(jobs.createdAt, filter.since));
    if (filter.statuses) conds.push(inArray(jobs.status, filter.statuses));
    const [r] = await this.db
      .select({ n: count() })
      .from(jobs)
      .where(conds.length ? and(...conds) : undefined);
    return Number(r?.n ?? 0);
  }
  async listJobsByStatus(statuses: JobStatus[], limit: number) {
    const rows = await this.db.select().from(jobs).where(inArray(jobs.status, statuses)).orderBy(jobs.createdAt).limit(limit);
    return rows as JobRow[];
  }
  async listExpirable(now: Date, limit: number) {
    const rows = await this.db
      .select()
      .from(jobs)
      .where(and(isNotNull(jobs.outputRef), lte(jobs.expiresAt, now)))
      .limit(limit);
    return rows as JobRow[];
  }
  async jobStats(since: Date) {
    const [r] = await this.db
      .select({
        total: count(),
        failed: sql<number>`count(*) filter (where ${jobs.status} = 'failed')`,
        blocked: sql<number>`count(*) filter (where ${jobs.status} = 'blocked')`,
        completed: sql<number>`count(*) filter (where ${jobs.status} in ('ready','completed'))`,
        avgMs: sql<
          string | null
        >`avg(extract(epoch from (${jobs.completedAt} - ${jobs.startedAt})) * 1000) filter (where ${jobs.status} in ('ready','completed'))`,
      })
      .from(jobs)
      .where(gte(jobs.createdAt, since));
    return {
      total: Number(r?.total ?? 0),
      failed: Number(r?.failed ?? 0),
      blocked: Number(r?.blocked ?? 0),
      completed: Number(r?.completed ?? 0),
      avgProcessingMs: r?.avgMs != null ? Math.round(Number(r.avgMs)) : null,
    };
  }

  async addAudit(a: Omit<AuditRow, 'id' | 'createdAt'>) {
    await this.db.insert(auditLogs).values({ ...a, id: newId('aud') });
  }
  async findAuditByRequestId(requestId: string) {
    const rows = await this.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.requestId, requestId))
      .orderBy(auditLogs.createdAt)
      .limit(100);
    return rows as AuditRow[];
  }
  async countAudit(action: string, since: Date) {
    const [r] = await this.db
      .select({ n: count() })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, action), gte(auditLogs.createdAt, since)));
    return Number(r?.n ?? 0);
  }

  async getSettings(): Promise<RuntimeSettings> {
    const [row] = await this.db.select().from(settings).where(eq(settings.key, 'runtime')).limit(1);
    return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<RuntimeSettings>) ?? {}) };
  }
  async updateSettings(patch: Partial<RuntimeSettings>) {
    const next = { ...(await this.getSettings()), ...patch };
    await this.db
      .insert(settings)
      .values({ key: 'runtime', value: next })
      .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
    return next;
  }

  async getWebhook(userId: string) {
    const [row] = await this.db.select().from(webhooks).where(eq(webhooks.userId, userId)).limit(1);
    return (row as WebhookRow | undefined) ?? null;
  }
  async upsertWebhook(w: WebhookRow) {
    await this.db
      .insert(webhooks)
      .values(w)
      .onConflictDoUpdate({
        target: webhooks.userId,
        set: { url: w.url, events: w.events, secretEnc: w.secretEnc, updatedAt: w.updatedAt },
      });
    return w;
  }
}
