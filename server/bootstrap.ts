import { mkdir } from 'node:fs/promises';
import type { AppConfig } from './config.js';
import { createStore } from './db/client.js';
import type { AppContext } from './http/context.js';
import { CleanupWorker } from './jobs/cleanup.js';
import { MemoryQueue, type JobQueue } from './jobs/queue.js';
import { logger } from './logger.js';
import { MediaEngine } from './media/engine.js';
import { MemoryRateStore, RateLimiter, RedisRateStore, type RedisLike } from './security/rateLimit.js';
import type { Resolver } from './security/urlPolicy.js';
import { AnalysisService } from './services/analysisService.js';
import { ApiKeyService } from './services/apiKeyService.js';
import { AuthService } from './services/authService.js';
import { JobService } from './services/jobService.js';
import { WebhookService } from './services/webhookService.js';

export interface BootOptions {
  clientDir?: string | null;
  /** Injected in tests to avoid real DNS. */
  resolver?: Resolver;
  retryBaseMs?: number;
}

/** Wires every service. Shared by the HTTP server and the test suite. */
export async function buildContext(
  config: AppConfig,
  opts: BootOptions = {},
): Promise<{ ctx: AppContext; close: () => Promise<void> }> {
  await mkdir(config.media.tempDir, { recursive: true, mode: 0o700 });
  const store = await createStore(config);

  const limiter = new RateLimiter(new MemoryRateStore());
  let queue: JobQueue = new MemoryQueue(config.media.concurrency);
  let redisPing: (() => Promise<void>) | null = null;
  let redisClose: (() => Promise<void>) | null = null;

  if (config.redisUrl) {
    const { Redis } = await import('ioredis');
    const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: true });
    await redis.connect();
    const { RedisQueue } = await import('./jobs/redisQueue.js');
    queue = new RedisQueue(redis, config.media.concurrency);
    limiter.setStore(new RedisRateStore(redis as unknown as RedisLike));
    redisPing = async () => {
      await redis.ping();
    };
    redisClose = async () => {
      await redis.quit().catch(() => redis.disconnect());
    };
    logger.info('Using Redis for queue and rate limits');
  }

  const engine = new MediaEngine({
    ytdlpBin: config.media.ytdlpBin,
    ffmpegBin: config.media.ffmpegBin,
    tempDir: config.media.tempDir,
    analyzeTimeoutMs: config.media.analyzeTimeoutMs,
    jobTimeoutMs: config.media.jobTimeoutMs,
  });

  const urlPolicy = {
    extraAllowedDomains: config.media.extraAllowedDomains,
    disabledPlatforms: config.media.disabledPlatforms,
  };
  const baseLimits = {
    maxFileSizeBytes: config.media.maxFileSizeBytes,
    maxDurationSeconds: config.media.maxDurationSeconds,
  };

  const webhooks = new WebhookService(store, config.sessionSecret, opts.resolver);
  const analysis = new AnalysisService({ store, engine, urlPolicy, baseLimits, resolver: opts.resolver });
  const jobs = new JobService({
    store,
    queue,
    engine,
    analysis,
    webhooks,
    resolver: opts.resolver,
    baseLimits,
    retentionMinutes: config.media.retentionMinutes,
    maxRetries: config.media.maxRetries,
    quotas: {
      userDailyJobs: config.limits.userDailyJobs,
      userMaxActiveJobs: config.limits.userMaxActiveJobs,
      anonDailyJobs: config.limits.anonDailyJobs,
    },
    retryBaseMs: opts.retryBaseMs,
  });

  const cleanup = new CleanupWorker(store, config.media.tempDir, config.media.retentionMinutes);

  const ctx: AppContext = {
    config,
    store,
    engine,
    queue,
    limiter,
    cleanup,
    auth: new AuthService(store, { ownerEmail: config.ownerEmail, sessionTtlMs: config.cookies.sessionTtlMs }),
    apiKeys: new ApiKeyService({
      store,
      pepper: config.apiKeyPepper,
      maxKeysPerUser: config.limits.userMaxApiKeys,
      adminScopeEnabled: config.limits.adminScopeEnabled,
    }),
    analysis,
    jobs,
    webhooks,
    redisPing,
    startedAt: new Date(),
    clientDir: opts.clientDir ?? null,
  };

  queue.start(jobs.handle);
  await jobs.recover();
  cleanup.start();

  const health = await engine.health(true);
  if (health.ytdlp.status !== 'up') logger.warn('SETUP: yt-dlp not available — analysis and processing are disabled.');
  if (health.ffmpeg.status !== 'up') logger.warn('SETUP: FFmpeg not available — processing is disabled.');

  const close = async () => {
    cleanup.stop();
    await queue.stop(20_000);
    await redisClose?.();
    await store.close();
  };
  return { ctx, close };
}
