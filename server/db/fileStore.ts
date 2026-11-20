import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { copyFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.js';
import { MemoryStore } from './memoryStore.js';

/**
 * Persistent single-file store for single-container hosting (RAJAR X HOSTING, small VPS).
 * Works like the in-memory store but every change is written (debounced, atomically)
 * to a JSON file on the persistent disk, e.g. /data/rajar-x-yt/database.json.
 * No PostgreSQL or Redis server is needed.
 */
// Only account data is written to disk. Jobs/activity and audit entries are never persisted
// (AccountsOnlyStore keeps them in memory), so those methods do not trigger a save.
const MUTATING = [
  'createUser',
  'createSession',
  'deleteSession',
  'deleteUserSessions',
  'deleteExpiredSessions',
  'createApiKey',
  'revokeApiKey',
  'touchApiKey',
  'updateApiKeyLimit',
  'updateSettings',
  'upsertWebhook',
] as const;

type Snapshot = {
  version: 1;
  savedAt: string;
  users: unknown[];
  sessions: unknown[];
  keys: unknown[];
  jobs: unknown[];
  audit: unknown[];
  settings: unknown;
  webhooks: unknown[];
};

function replacer(this: Record<string, unknown>, key: string, value: unknown) {
  const raw = this[key];
  return raw instanceof Date ? { $date: raw.toISOString() } : value;
}
function reviver(_key: string, value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    '$date' in (value as Record<string, unknown>) &&
    Object.keys(value as object).length === 1
  ) {
    return new Date((value as { $date: string }).$date);
  }
  return value;
}

export class FileStore extends MemoryStore {
  override readonly kind = 'file' as const;
  private timer: NodeJS.Timeout | null = null;
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(private readonly file: string) {
    super();
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    this.load();
    const self = this as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    for (const name of MUTATING) {
      const original = self[name]!.bind(this);
      self[name] = async (...args: unknown[]) => {
        const result = await original(...args);
        this.scheduleSave(name === 'touchApiKey' ? 5000 : 400);
        return result;
      };
    }
  }

  private load() {
    if (!existsSync(this.file)) {
      logger.info('Creating new database file', { file: this.file });
      return;
    }
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8'), reviver) as Snapshot;
      const toMap = <T extends { id?: string; userId?: string }>(rows: unknown[], key: 'id' | 'userId' = 'id') =>
        new Map((rows as T[]).map((row) => [String(row[key]), row]));
      this.users = toMap(data.users) as typeof this.users;
      this.sessions = toMap(data.sessions) as typeof this.sessions;
      this.keys = toMap(data.keys) as typeof this.keys;
      // Older files may contain jobs/audit entries — they are dropped and purged on the next save.
      this.settings = { ...this.settings, ...(data.settings as object) };
      this.webhooks = toMap(data.webhooks, 'userId') as typeof this.webhooks;
      if (data.jobs?.length || data.audit?.length) this.scheduleSave(100); // purge old activity from disk
      logger.info('Loaded database file', { file: this.file, users: this.users.size, keys: this.keys.size });
    } catch (err) {
      const broken = `${this.file}.corrupt-${Date.now()}`;
      try {
        renameSync(this.file, broken);
      } catch {
        /* ignore */
      }
      logger.error('Database file was unreadable; moved aside and starting fresh', { broken, err });
    }
  }

  private snapshot(): string {
    const data: Snapshot = {
      version: 1,
      savedAt: new Date().toISOString(),
      users: [...this.users.values()],
      sessions: [...this.sessions.values()],
      keys: [...this.keys.values()],
      jobs: [],
      audit: [],
      settings: this.settings,
      webhooks: [...this.webhooks.values()],
    };
    return JSON.stringify(data, replacer);
  }

  private scheduleSave(delayMs: number) {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delayMs);
    this.timer.unref?.();
  }

  /** Atomic write: temp file → rename. Keeps one previous copy as .bak. */
  async flush() {
    if (!this.dirty) return this.saving;
    this.dirty = false;
    const body = this.snapshot();
    this.saving = this.saving
      .then(async () => {
        const temp = `${this.file}.tmp`;
        await writeFile(temp, body, { mode: 0o600 });
        if (existsSync(this.file)) await copyFile(this.file, `${this.file}.bak`).catch(() => undefined);
        await rename(temp, this.file);
      })
      .catch((err) => {
        this.dirty = true;
        logger.error('Could not save database file', { err });
      });
    return this.saving;
  }

  override async ping() {
    writeFileSync(path.join(path.dirname(this.file), '.write-test'), String(Date.now()));
  }

  override async close() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.dirty = true;
    await this.flush();
  }
}
