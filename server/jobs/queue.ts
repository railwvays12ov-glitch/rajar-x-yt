import { logger } from '../logger.js';

/** Processes one job. Must honour the AbortSignal (cancellation / shutdown). */
export type JobHandler = (jobId: string, signal: AbortSignal) => Promise<void>;

export interface QueueStats {
  driver: 'memory' | 'redis';
  pending: number;
  active: number;
  concurrency: number;
}

export interface JobQueue {
  readonly driver: 'memory' | 'redis';
  start(handler: JobHandler): void;
  enqueue(jobId: string, delayMs?: number): Promise<void>;
  /** Removes a pending job or aborts it if running on any instance. */
  cancel(jobId: string): Promise<void>;
  stats(): Promise<QueueStats>;
  /** Stops taking work, aborts running jobs, waits up to timeoutMs. */
  stop(timeoutMs: number): Promise<void>;
}

/**
 * Bounded in-process queue for development and single-instance deployments.
 * Concurrency is fixed — never unbounded.
 */
export class MemoryQueue implements JobQueue {
  readonly driver = 'memory' as const;
  private pending: string[] = [];
  private active = new Map<string, { ctrl: AbortController; done: Promise<void> }>();
  private timers = new Set<NodeJS.Timeout>();
  private handler: JobHandler | null = null;
  private stopping = false;

  constructor(
    private readonly concurrency: number,
    private readonly maxPending = 10_000,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be >= 1');
  }

  start(handler: JobHandler) {
    this.handler = handler;
    this.pump();
  }

  async enqueue(jobId: string, delayMs = 0) {
    if (this.stopping) return;
    if (this.pending.length >= this.maxPending) throw new Error('Queue is full');
    if (delayMs > 0) {
      const t = setTimeout(() => {
        this.timers.delete(t);
        this.pending.push(jobId);
        this.pump();
      }, delayMs);
      this.timers.add(t);
      return;
    }
    if (!this.pending.includes(jobId) && !this.active.has(jobId)) this.pending.push(jobId);
    this.pump();
  }

  async cancel(jobId: string) {
    this.pending = this.pending.filter((id) => id !== jobId);
    this.active.get(jobId)?.ctrl.abort('cancelled');
  }

  async stats(): Promise<QueueStats> {
    return { driver: 'memory', pending: this.pending.length, active: this.active.size, concurrency: this.concurrency };
  }

  private pump() {
    if (!this.handler || this.stopping) return;
    while (this.active.size < this.concurrency && this.pending.length) {
      const id = this.pending.shift()!;
      const ctrl = new AbortController();
      const done = this.handler(id, ctrl.signal)
        .catch((err) => logger.error('Job handler crashed', { jobId: id, err }))
        .finally(() => {
          this.active.delete(id);
          this.pump();
        });
      this.active.set(id, { ctrl, done });
    }
  }

  async stop(timeoutMs: number) {
    this.stopping = true;
    for (const t of this.timers) clearTimeout(t);
    for (const { ctrl } of this.active.values()) ctrl.abort('shutdown');
    const all = Promise.all([...this.active.values()].map((a) => a.done));
    await Promise.race([all, new Promise((r) => setTimeout(r, timeoutMs).unref())]);
  }
}
