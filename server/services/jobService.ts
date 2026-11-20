import { ERROR_CATALOG, type ErrorCode } from '../../shared/errors.js';
import { TERMINAL_STATUSES, type JobView, type ProcessOptions } from '../../shared/types.js';
import { newId, ownerMatches, type JobOwner, type JobRow, type Store } from '../db/store.js';
import { AppError } from '../http/appError.js';
import { canTransition, isCancellable } from '../jobs/stateMachine.js';
import type { JobQueue } from '../jobs/queue.js';
import { logger } from '../logger.js';
import { outputExtension, qualityLabel } from '../media/args.js';
import type { MediaEngine } from '../media/engine.js';
import { BLOCKING, RETRYABLE } from '../media/errorMap.js';
import { buildOutputFilename } from '../media/filename.js';
import { optionAvailable } from '../media/metadata.js';
import { assertPublicHost, type Resolver } from '../security/urlPolicy.js';
import { effectiveLimits, type AnalysisService } from './analysisService.js';
import type { WebhookService } from './webhookService.js';

export function toJobView(j: JobRow): JobView {
  return {
    id: j.id,
    requestId: j.requestId,
    platform: j.platform,
    sourceUrl: j.sourceUrl,
    title: j.title,
    mediaType: j.mediaType,
    format: j.format,
    quality: j.quality,
    status: j.status,
    progress: Math.round(j.progress * 1000) / 1000,
    errorCode: j.errorCode,
    errorMessage: j.errorMessage,
    outputFilename: j.status === 'ready' || j.status === 'completed' ? j.outputFilename : null, // name kept for the history line
    outputSizeBytes: j.outputSizeBytes,
    attempts: j.attempts,
    createdAt: j.createdAt.toISOString(),
    startedAt: j.startedAt?.toISOString() ?? null,
    completedAt: j.completedAt?.toISOString() ?? null,
    expiresAt: j.expiresAt?.toISOString() ?? null,
    logs: j.logs.slice(-40),
  };
}

export interface JobServiceDeps {
  store: Store;
  queue: JobQueue;
  engine: MediaEngine;
  analysis: AnalysisService;
  webhooks: WebhookService;
  resolver?: Resolver;
  baseLimits: { maxFileSizeBytes: number; maxDurationSeconds: number };
  retentionMinutes: number;
  maxRetries: number;
  quotas: { userDailyJobs: number; userMaxActiveJobs: number; anonDailyJobs: number };
  /** Base delay for exponential retry backoff. */
  retryBaseMs?: number;
}

const ACTIVE_STATUSES = ['queued', 'active'] as const;
const DAY_MS = 24 * 3600_000;

export class JobService {
  constructor(private readonly d: JobServiceDeps) {}

  async quotaFor(owner: JobOwner) {
    const daily = 'userId' in owner ? this.d.quotas.userDailyJobs : this.d.quotas.anonDailyJobs;
    const usedToday = await this.d.store.countJobs({ owner, since: new Date(Date.now() - DAY_MS) });
    return { dailyJobs: daily, usedToday, maxActiveJobs: this.d.quotas.userMaxActiveJobs };
  }

  async create(input: {
    owner: JobOwner;
    apiKeyId: string | null;
    requestId: string;
    url: string;
    options: ProcessOptions;
    /** Admin-set unlimited API key: skips daily and concurrent per-user job quotas. */
    unlimited?: boolean;
  }): Promise<JobView> {
    const settings = await this.d.store.getSettings();
    if (!settings.processingEnabled) throw new AppError('SERVER_MAINTENANCE');

    const health = await this.d.engine.health();
    if (health.ytdlp.status !== 'up') throw new AppError('YTDLP_UNAVAILABLE');
    if (health.ffmpeg.status !== 'up') throw new AppError('FFMPEG_UNAVAILABLE');

    if (!input.unlimited) {
      const quota = await this.quotaFor(input.owner);
      if (quota.usedToday >= quota.dailyJobs) throw new AppError('QUOTA_EXCEEDED', { reason: 'daily' });
      const activeNow = await this.d.store.countJobs({ owner: input.owner, statuses: [...ACTIVE_STATUSES] });
      if (activeNow >= quota.maxActiveJobs) throw new AppError('QUOTA_EXCEEDED', { reason: 'concurrent' });
    }
    // Server-wide concurrency stays bounded by MEDIA_CONCURRENCY — extra jobs simply wait in the queue.

    // Re-runs (or reuses cached) validation + metadata policy. Throws on any restriction.
    const analysis = await this.d.analysis.analyze(input.url);
    const limits = await effectiveLimits(this.d.store, this.d.baseLimits);

    const o = input.options;
    if (!optionAvailable(o, analysis.availableHeights, analysis.hasAudio, analysis.hasVideo)) {
      throw new AppError('FORMAT_UNAVAILABLE');
    }
    if (o.subtitleLang && !analysis.subtitles.includes(o.subtitleLang)) throw new AppError('FORMAT_UNAVAILABLE');
    const est = o.mediaType === 'audio' ? analysis.estimatedSizes.audio : analysis.estimatedSizes[o.quality];
    if (o.mediaType !== 'thumbnail' && est && est > limits.maxFileSizeBytes) throw new AppError('FILE_TOO_LARGE');

    const row = await this.d.store.createJob({
      id: newId('job'),
      requestId: input.requestId,
      userId: 'userId' in input.owner ? input.owner.userId : null,
      anonId: 'anonId' in input.owner ? input.owner.anonId : null,
      apiKeyId: input.apiKeyId,
      sourceUrl: analysis.sourceUrl,
      platform: analysis.platform,
      title: analysis.title,
      durationSeconds: analysis.durationSeconds,
      mediaType: o.mediaType,
      format: outputExtension(o),
      quality: o.mediaType === 'audio' ? 'audio' : o.quality,
      options: { ...o, subtitleLang: o.subtitleLang && analysis.subtitles.includes(o.subtitleLang) ? o.subtitleLang : null },
      status: 'queued',
      progress: 0,
      attempts: 0,
      errorCode: null,
      errorMessage: null,
      outputRef: null,
      outputFilename: null,
      outputSizeBytes: null,
      logs: [`[${new Date().toISOString()}] queued · ${qualityLabel(o)}`],
      startedAt: null,
      completedAt: null,
      expiresAt: null,
      hiddenAt: null,
    });
    await this.d.queue.enqueue(row.id);
    this.d.webhooks.emit(row.userId, 'job.queued', { jobId: row.id, requestId: row.requestId });
    return toJobView(row);
  }

  async getOwned(jobId: string, owner: JobOwner | null, isAdmin = false): Promise<JobRow> {
    const job = await this.d.store.getJob(jobId);
    if (!job || (!isAdmin && (!owner || !ownerMatches(job, owner)))) throw new AppError('NOT_FOUND');
    return job;
  }

  async cancel(jobId: string, owner: JobOwner): Promise<JobView> {
    const job = await this.getOwned(jobId, owner);
    if (!isCancellable(job.status)) throw new AppError('VALIDATION_FAILED', { reason: 'not-cancellable' });
    await this.d.queue.cancel(jobId);
    const updated = await this.finish(job.id, 'cancelled', 'PROCESSING_CANCELLED');
    await this.d.engine.removeJobDir(job.id);
    return toJobView(updated ?? job);
  }

  async retry(jobId: string, owner: JobOwner, requestId: string, apiKeyId: string | null, unlimited = false) {
    const job = await this.getOwned(jobId, owner);
    if (!TERMINAL_STATUSES.includes(job.status)) throw new AppError('VALIDATION_FAILED', { reason: 'still-running' });
    return this.create({ owner, apiKeyId, requestId, url: job.sourceUrl, options: job.options, unlimited });
  }

  /** After a complete download the file is deleted immediately — nothing is kept on the server. */
  async markDownloaded(job: JobRow) {
    if (job.status !== 'ready') return;
    await this.d.engine.removeJobDir(job.id);
    await this.d.store.updateJob(job.id, {
      status: 'completed',
      outputRef: null,
      logs: [...job.logs, `[${new Date().toISOString()}] delivered · file deleted from server`].slice(-40),
    });
  }

  async hide(jobId: string, owner: JobOwner) {
    const job = await this.getOwned(jobId, owner);
    if (!TERMINAL_STATUSES.includes(job.status) && job.status !== 'ready') {
      throw new AppError('VALIDATION_FAILED', { reason: 'still-running' });
    }
    await this.d.store.updateJob(job.id, { hiddenAt: new Date() });
  }

  async hideAll(owner: JobOwner) {
    const rows = await this.d.store.listJobs({ owner, limit: 500 });
    for (const j of rows) {
      if (TERMINAL_STATUSES.includes(j.status) || j.status === 'ready') {
        await this.d.store.updateJob(j.id, { hiddenAt: new Date() });
      }
    }
  }

  /** Queue handler: runs one job end-to-end. */
  readonly handle = async (jobId: string, signal: AbortSignal): Promise<void> => {
    const job = await this.d.store.getJob(jobId);
    if (!job || job.status !== 'queued') return;
    const settings = await this.d.store.getSettings();
    if (!settings.processingEnabled) {
      await this.d.queue.enqueue(jobId, 30_000);
      return;
    }

    const attempts = job.attempts + 1;
    const startedAt = new Date();
    const claimed = await this.d.store.claimJob(jobId, {
      attempts,
      startedAt,
      progress: 0.01,
      logs: [...job.logs, `[${startedAt.toISOString()}] active · attempt ${attempts}`].slice(-40),
    });
    if (!claimed) return; // another worker took it, or it was cancelled

    const logs = [...claimed.logs];
    let lastWrite = 0;
    let pendingProgress = 0.01;
    let finished = false;
    let inflight: Promise<unknown> = Promise.resolve();
    // Throttled progress writes. Stopped (and drained) before any terminal update so a
    // late progress write can never overwrite the final status, logs or progress.
    const flush = () => {
      if (finished || Date.now() - lastWrite < 750) return;
      lastWrite = Date.now();
      inflight = this.d.store.updateJob(jobId, { progress: pendingProgress, logs: logs.slice(-40) }).catch(() => {});
    };
    const stopProgress = async () => {
      finished = true;
      await inflight;
    };

    try {
      // Narrow the DNS-rebinding window: re-check the host right before spawning.
      await assertPublicHost(new URL(job.sourceUrl).hostname, this.d.resolver);
      const limits = await effectiveLimits(this.d.store, this.d.baseLimits);
      const analysis = await this.d.analysis.analyze(job.sourceUrl, signal);

      const result = await this.d.engine.download({
        jobId,
        url: job.sourceUrl,
        options: job.options,
        maxFileSizeBytes: limits.maxFileSizeBytes,
        allowedSubtitleLangs: analysis.subtitles,
        signal,
        onProgress: (f) => {
          pendingProgress = Math.max(pendingProgress, f);
          flush();
        },
        onLog: (line) => {
          logs.push(line);
          if (logs.length > 60) logs.splice(0, logs.length - 60);
        },
      });

      await stopProgress();
      const current = await this.d.store.getJob(jobId);
      if (!current || current.status !== 'active') {
        await this.d.engine.removeJobDir(jobId); // cancelled while finishing
        return;
      }
      const now = new Date();
      await this.d.store.updateJob(jobId, {
        status: 'ready',
        progress: 1,
        outputRef: result.outputRef,
        outputSizeBytes: result.sizeBytes,
        outputFilename: buildOutputFilename(job.title, qualityLabel(job.options), result.ext),
        completedAt: now,
        expiresAt: new Date(now.getTime() + this.d.retentionMinutes * 60_000),
        logs: [...logs, `[${now.toISOString()}] ready · ${(result.sizeBytes / 1048576).toFixed(1)} MB`].slice(-40),
      });
      this.d.webhooks.emit(job.userId, 'job.ready', { jobId, requestId: job.requestId });
    } catch (err) {
      await stopProgress();
      const code: ErrorCode = err instanceof AppError ? err.code : 'PROCESSING_FAILED';
      if (!(err instanceof AppError)) logger.error('Unexpected job error', { jobId, err });

      if (signal.aborted && signal.reason === 'shutdown') {
        await this.d.store.updateJob(jobId, { status: 'queued', attempts: job.attempts, progress: 0 });
        return;
      }
      if (signal.aborted || code === 'PROCESSING_CANCELLED') {
        await this.finish(jobId, 'cancelled', 'PROCESSING_CANCELLED');
        return;
      }
      if (RETRYABLE.has(code) && attempts <= this.d.maxRetries) {
        const delay = (this.d.retryBaseMs ?? 5000) * 2 ** (attempts - 1);
        await this.d.store.updateJob(jobId, {
          status: 'queued',
          progress: 0,
          logs: [...logs, `[${new Date().toISOString()}] retry scheduled in ${Math.round(delay / 1000)}s (${code})`].slice(-40),
        });
        await this.d.queue.enqueue(jobId, delay);
        return;
      }
      await this.finish(jobId, BLOCKING.has(code) ? 'blocked' : 'failed', code, logs);
    }
  };

  private async finish(jobId: string, status: 'cancelled' | 'blocked' | 'failed', code: ErrorCode, logs?: string[]) {
    const job = await this.d.store.getJob(jobId);
    if (!job || !canTransition(job.status, status)) return job;
    const now = new Date();
    const updated = await this.d.store.updateJob(jobId, {
      status,
      errorCode: code,
      errorMessage: ERROR_CATALOG[code].message,
      completedAt: now,
      logs: [...(logs ?? job.logs), `[${now.toISOString()}] ${status} · ${code}`].slice(-40),
    });
    const event = status === 'cancelled' ? 'job.cancelled' : status === 'blocked' ? 'job.blocked' : 'job.failed';
    this.d.webhooks.emit(job.userId, event, { jobId, requestId: job.requestId, errorCode: code });
    return updated;
  }

  /** After a restart: jobs left "active" by a crash go back to the queue. */
  async recover() {
    const stale = await this.d.store.listJobsByStatus(['active', 'queued'], 1000);
    for (const j of stale) {
      if (j.status === 'active') await this.d.store.updateJob(j.id, { status: 'queued', progress: 0 });
      await this.d.queue.enqueue(j.id);
    }
    if (stale.length) logger.info('Recovered jobs after restart', { count: stale.length });
  }
}
