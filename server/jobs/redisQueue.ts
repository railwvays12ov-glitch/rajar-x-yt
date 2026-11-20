import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import { logger } from '../logger.js';
import type { JobHandler, JobQueue, QueueStats } from './queue.js';

const PENDING = 'rx:jobs:pending';
const DELAYED = 'rx:jobs:delayed';
const CANCEL_CHANNEL = 'rx:jobs:cancel';
const processingKey = (instance: string) => `rx:jobs:processing:${instance}`;

/**
 * Redis-backed queue for multi-instance production. Each worker slot uses its own
 * blocking connection (BLMOVE pending → processing:<instance>). Cancellation is
 * broadcast over pub/sub so whichever instance runs the job aborts it.
 */
export class RedisQueue implements JobQueue {
  readonly driver = 'redis' as const;
  private readonly instance = randomBytes(6).toString('hex');
  private readonly active = new Map<string, AbortController>();
  private readonly workers: Redis[] = [];
  private subscriber: Redis | null = null;
  private delayTimer: NodeJS.Timeout | null = null;
  private running: Promise<void>[] = [];
  private stopping = false;

  constructor(
    private readonly redis: Redis,
    private readonly concurrency: number,
  ) {}

  start(handler: JobHandler) {
    this.subscriber = this.redis.duplicate();
    void this.subscriber.subscribe(CANCEL_CHANNEL);
    this.subscriber.on('message', (_ch: string, jobId: string) => this.active.get(jobId)?.abort('cancelled'));

    // Promote delayed retries whose time has come.
    this.delayTimer = setInterval(() => void this.promoteDelayed(), 1000);
    this.delayTimer.unref();

    for (let i = 0; i < this.concurrency; i++) {
      const conn = this.redis.duplicate();
      this.workers.push(conn);
      this.running.push(this.loop(conn, handler));
    }
    logger.info('Redis queue started', { instance: this.instance, concurrency: this.concurrency });
  }

  private async loop(conn: Redis, handler: JobHandler) {
    while (!this.stopping) {
      let jobId: string | null = null;
      try {
        jobId = await conn.blmove(PENDING, processingKey(this.instance), 'RIGHT', 'LEFT', 5);
      } catch (err) {
        if (this.stopping) break;
        logger.warn('Redis queue poll failed', { err });
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!jobId) continue;
      const ctrl = new AbortController();
      this.active.set(jobId, ctrl);
      try {
        await handler(jobId, ctrl.signal);
      } catch (err) {
        logger.error('Job handler crashed', { jobId, err });
      } finally {
        this.active.delete(jobId);
        await this.redis.lrem(processingKey(this.instance), 1, jobId).catch(() => {});
      }
    }
  }

  private async promoteDelayed() {
    try {
      const due = await this.redis.zrangebyscore(DELAYED, 0, Date.now(), 'LIMIT', 0, 50);
      for (const id of due) {
        if (await this.redis.zrem(DELAYED, id)) await this.redis.lpush(PENDING, id);
      }
    } catch {
      /* transient */
    }
  }

  async enqueue(jobId: string, delayMs = 0) {
    if (delayMs > 0) await this.redis.zadd(DELAYED, Date.now() + delayMs, jobId);
    else await this.redis.lpush(PENDING, jobId);
  }

  async cancel(jobId: string) {
    await this.redis.lrem(PENDING, 0, jobId);
    await this.redis.zrem(DELAYED, jobId);
    await this.redis.publish(CANCEL_CHANNEL, jobId);
  }

  async stats(): Promise<QueueStats> {
    const [pending, delayed] = await Promise.all([this.redis.llen(PENDING), this.redis.zcard(DELAYED)]);
    return { driver: 'redis', pending: pending + delayed, active: this.active.size, concurrency: this.concurrency };
  }

  async stop(timeoutMs: number) {
    this.stopping = true;
    if (this.delayTimer) clearInterval(this.delayTimer);
    for (const ctrl of this.active.values()) ctrl.abort('shutdown');
    await Promise.race([Promise.all(this.running), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
    // Anything still marked processing by this instance goes back to pending for another worker.
    const leftovers = await this.redis.lrange(processingKey(this.instance), 0, -1).catch(() => [] as string[]);
    for (const id of leftovers) await this.redis.lpush(PENDING, id).catch(() => {});
    await this.redis.del(processingKey(this.instance)).catch(() => {});
    for (const w of this.workers) w.disconnect();
    this.subscriber?.disconnect();
  }
}
