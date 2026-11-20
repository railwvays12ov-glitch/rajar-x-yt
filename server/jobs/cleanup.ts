import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Store } from '../db/store.js';
import { logger } from '../logger.js';

async function dirSize(dir: string, depth = 0): Promise<number> {
  if (depth > 3) return 0;
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(p, depth + 1);
    else if (entry.isFile()) total += (await stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

/**
 * Periodic cleanup: deletes expired outputs, orphaned job directories and expired sessions.
 * Temporary media is never kept beyond MEDIA_RETENTION_MINUTES.
 */
export class CleanupWorker {
  private timer: NodeJS.Timeout | null = null;
  private storageCache = { at: 0, bytes: 0 };
  private running = false;

  constructor(
    private readonly store: Store,
    private readonly tempDir: string,
    private readonly retentionMinutes: number,
    private readonly intervalMs = 60_000,
  ) {}

  start() {
    this.timer = setInterval(() => void this.runOnce(), this.intervalMs);
    this.timer.unref();
    void this.runOnce();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async storageUsage(): Promise<number> {
    if (Date.now() - this.storageCache.at > 30_000) {
      this.storageCache = { at: Date.now(), bytes: await dirSize(this.tempDir) };
    }
    return this.storageCache.bytes;
  }

  async runOnce(now = new Date()): Promise<{ expired: number; orphans: number; sessions: number }> {
    if (this.running) return { expired: 0, orphans: 0, sessions: 0 };
    this.running = true;
    let expired = 0;
    let orphans = 0;
    let sessions = 0;
    try {
      for (const job of await this.store.listExpirable(now, 200)) {
        await rm(path.join(this.tempDir, job.id), { recursive: true, force: true });
        await this.store.updateJob(job.id, {
          status: job.status === 'ready' || job.status === 'completed' ? 'expired' : job.status,
          outputRef: null,
        });
        expired++;
      }

      // Orphans: job dirs whose job no longer references them and are older than 2× retention.
      const cutoff = now.getTime() - this.retentionMinutes * 2 * 60_000;
      for (const entry of await readdir(this.tempDir, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isDirectory()) continue;
        const full = path.join(this.tempDir, entry.name);
        const s = await stat(full).catch(() => null);
        if (!s || s.mtimeMs > cutoff) continue;
        if (entry.name.startsWith('job_')) {
          const job = await this.store.getJob(entry.name);
          if (job?.outputRef && job.expiresAt && job.expiresAt > now) continue;
          if (job && (job.status === 'active' || job.status === 'queued')) continue;
        }
        await rm(full, { recursive: true, force: true });
        orphans++;
      }

      sessions = await this.store.deleteExpiredSessions(now);
      if (expired || orphans) logger.info('Temp cleanup', { expired, orphans, sessions });
    } catch (err) {
      logger.warn('Cleanup pass failed', { err });
    } finally {
      this.running = false;
    }
    return { expired, orphans, sessions };
  }
}
