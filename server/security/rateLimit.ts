/**
 * Fixed-window rate limiter with pluggable storage. The in-memory store is used for
 * development and single-instance deployments; RedisRateStore shares counters across
 * instances. Both are bounded — expired buckets are swept.
 */
export interface RateStore {
  /** Increments the counter for key and returns the new count and window reset time. */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

export class MemoryRateStore implements RateStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();
  private lastSweep = Date.now();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 100_000,
  ) {}

  async hit(key: string, windowMs: number) {
    const t = this.now();
    if (t - this.lastSweep > 60_000 || this.buckets.size > this.maxKeys) this.sweep(t);
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= t) {
      const fresh = { count: 1, resetAt: t + windowMs };
      this.buckets.set(key, fresh);
      return { ...fresh };
    }
    existing.count += 1;
    return { ...existing };
  }

  private sweep(t: number) {
    for (const [k, v] of this.buckets) if (v.resetAt <= t) this.buckets.delete(k);
    this.lastSweep = t;
  }
}

/** Minimal Redis interface (satisfied by ioredis) so this module has no hard dependency. */
export interface RedisLike {
  multi(): { incr(k: string): unknown; pttl(k: string): unknown; exec(): Promise<[Error | null, unknown][] | null> };
  pexpire(k: string, ms: number): Promise<unknown>;
}

export class RedisRateStore implements RateStore {
  constructor(
    private readonly redis: RedisLike,
    private readonly prefix = 'rx:rl:',
  ) {}

  async hit(key: string, windowMs: number) {
    const k = this.prefix + key;
    const tx = this.redis.multi();
    tx.incr(k);
    tx.pttl(k);
    const res = (await tx.exec()) ?? [];
    const count = Number(res[0]?.[1] ?? 1);
    let ttl = Number(res[1]?.[1] ?? -1);
    if (ttl < 0) {
      await this.redis.pexpire(k, windowMs);
      ttl = windowMs;
    }
    return { count, resetAt: Date.now() + ttl };
  }
}

export interface RateDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export class RateLimiter {
  /** Called on every rejection so admins can see rate-limit events. */
  onLimited?: (bucket: string) => void;

  constructor(private store: RateStore) {}

  setStore(store: RateStore) {
    this.store = store;
  }

  async check(bucket: string, id: string, limit: number, windowMs: number): Promise<RateDecision> {
    const { count, resetAt } = await this.store.hit(`${bucket}:${id}`, windowMs);
    const allowed = count <= limit;
    if (!allowed) this.onLimited?.(bucket);
    return { allowed, limit, remaining: Math.max(0, limit - count), resetAt };
  }
}
