import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';
import { processOptionsSchema } from '../shared/types.js';
import { buildContext } from '../server/bootstrap.js';
import { AppError } from '../server/http/appError.js';
import { MemoryQueue } from '../server/jobs/queue.js';
import { canTransition, isCancellable } from '../server/jobs/stateMachine.js';
import { fakeResolver, testConfig, waitFor, yt } from './helpers.js';

describe('Job state machine', () => {
  it('allows only the documented transitions', () => {
    assert.ok(canTransition('queued', 'active'));
    assert.ok(canTransition('active', 'ready'));
    assert.ok(canTransition('active', 'queued'), 'retry');
    assert.ok(canTransition('ready', 'completed'));
    assert.ok(canTransition('completed', 'expired'));
    assert.ok(!canTransition('queued', 'ready'), 'cannot claim ready without processing');
    assert.ok(!canTransition('failed', 'active'));
    assert.ok(!canTransition('blocked', 'queued'));
    assert.ok(!canTransition('cancelled', 'active'));
    assert.ok(isCancellable('queued') && isCancellable('active') && !isCancellable('ready'));
  });
});

describe('Memory queue', () => {
  it('never exceeds its concurrency and supports cancellation', async () => {
    const q = new MemoryQueue(2);
    let running = 0;
    let peak = 0;
    const cancelled: string[] = [];
    const done: string[] = [];
    q.start(async (id, signal) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 40);
        signal.addEventListener('abort', () => {
          clearTimeout(t);
          cancelled.push(id);
          resolve();
        });
      });
      running--;
      if (!signal.aborted) done.push(id);
    });
    for (let i = 0; i < 8; i++) await q.enqueue(`job_${i}`);
    await q.cancel('job_0');
    await q.cancel('job_7');
    await waitFor(async () => done.length + cancelled.length === 7);
    assert.equal(peak, 2);
    assert.ok(cancelled.includes('job_0'));
    assert.ok(!done.includes('job_7') && !cancelled.includes('job_7'), 'pending job removed before it ran');
    await q.stop(100);
  });
});

async function harness(env: Record<string, string> = {}) {
  const config = testConfig({ MEDIA_CONCURRENCY: '2', ...env });
  const { ctx, close } = await buildContext(config, { resolver: fakeResolver, retryBaseMs: 20 });
  const user = await ctx.auth.register({
    email: `u${Math.random()}@rajar.test`,
    password: 'correct horse battery',
    displayName: 'U',
  });
  const owner = { userId: user.id };
  const create = (id: string, options: Record<string, unknown> = { mediaType: 'video', quality: '720' }) =>
    ctx.jobs.create({
      owner,
      apiKeyId: null,
      requestId: 'req_testtesttest',
      url: yt(id),
      options: processOptionsSchema.parse(options),
    });
  const settle = (jobId: string) =>
    waitFor(async () => {
      const j = await ctx.store.getJob(jobId);
      return j && !['queued', 'active'].includes(j.status) ? j : null;
    }, 30_000);
  return { ctx, close, owner, create, settle };
}

describe('Authorized processing pipeline (fake yt-dlp + real FFmpeg)', () => {
  it('analyzes public media and refuses restricted media', async () => {
    const { ctx, close } = await harness();
    const a = await ctx.analysis.analyze(yt('okVideo1234'));
    assert.equal(a.platform, 'youtube');
    assert.deepEqual(a.availableHeights, [1080, 720]);
    assert.deepEqual(a.subtitles, ['en']);
    assert.equal(a.safeUse.status, 'allowed');
    const expectations: [string, string][] = [
      ['privVideo12', 'MEDIA_PRIVATE'],
      ['loginVideo1', 'PLATFORM_BOT_CHECK'],
      ['memberVid12', 'LOGIN_REQUIRED'],
      ['geoVideo123', 'GEO_RESTRICTED'],
      ['goneVideo12', 'MEDIA_UNAVAILABLE'],
      ['drmVideo123', 'DRM_PROTECTED'],
      ['ageVideo123', 'AGE_RESTRICTED'],
      ['liveVideo12', 'LIVE_UNSUPPORTED'],
      ['longVideo12', 'DURATION_TOO_LONG'],
      ['privAvail12', 'LOGIN_REQUIRED'],
      ['playlist123', 'PLAYLIST_UNSUPPORTED'],
    ];
    for (const [id, code] of expectations) {
      await assert.rejects(ctx.analysis.analyze(yt(id)), (e: AppError) => e.code === code, id);
    }
    await close();
  });

  it('processes video and audio to real files and only then reports ready', async () => {
    const { ctx, close, create, settle } = await harness();
    const video = await create('okVideo1234', { mediaType: 'video', quality: '720', container: 'mp4', subtitleLang: 'en' });
    assert.equal(video.status, 'queued');
    const v = await settle(video.id);
    assert.equal(v.status, 'ready', JSON.stringify(v.logs));
    assert.equal(v.progress, 1);
    assert.ok(v.outputRef && !v.outputRef.startsWith('/'), 'output reference is relative, never a server path');
    const full = ctx.engine.resolveOutput(v.outputRef!);
    assert.ok(existsSync(full) && statSync(full).size > 0);
    assert.match(v.outputFilename!, /^RAJAR X Test Clip Neon Orbit 1080p \[720p mp4\]\.mp4$/);
    assert.ok(v.expiresAt! > new Date());

    const audio = await settle(
      (await create('okVideo1234', { mediaType: 'audio', audioFormat: 'mp3', audioMode: 'normalized' })).id,
    );
    assert.equal(audio.status, 'ready', JSON.stringify(audio.logs));
    assert.ok(audio.logs.some((l) => l.includes('loudness normalization')));
    assert.match(audio.outputRef!, /media\.mp3$/);
    await close();
  });

  it('blocks oversized output and refuses unavailable qualities up front', async () => {
    const { close, create } = await harness();
    await assert.rejects(
      create('bigVideo123', { mediaType: 'video', quality: 'best' }),
      (e: AppError) => e.code === 'FILE_TOO_LARGE',
    );
    await assert.rejects(
      create('okVideo1234', { mediaType: 'video', quality: '2160' }),
      (e: AppError) => e.code === 'FORMAT_UNAVAILABLE',
    );
    await assert.rejects(
      create('okVideo1234', { mediaType: 'video', quality: '720', subtitleLang: 'fr' }),
      (e: AppError) => e.code === 'FORMAT_UNAVAILABLE',
    );
    await close();
  });

  it('enforces quotas and maintenance mode', async () => {
    const { ctx, close, create } = await harness({ USER_DAILY_JOB_QUOTA: '1' });
    await create('okVideo1234', { mediaType: 'thumbnail' });
    await assert.rejects(create('okVideo1234', { mediaType: 'thumbnail' }), (e: AppError) => e.code === 'QUOTA_EXCEEDED');
    await ctx.store.updateSettings({ processingEnabled: false });
    await assert.rejects(create('okVideo1234'), (e: AppError) => e.code === 'SERVER_MAINTENANCE');
    await close();
  });

  it('cancels jobs and cleans up expired files', async () => {
    const { ctx, close, create, settle, owner } = await harness({ MEDIA_CONCURRENCY: '1' });
    const first = await create('okVideo1234', { mediaType: 'audio', audioFormat: 'wav' });
    const second = await create('okVideo1234', { mediaType: 'audio', audioFormat: 'm4a' });
    const cancelled = await ctx.jobs.cancel(second.id, owner);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal((await settle(first.id)).status, 'ready');
    assert.equal((await ctx.store.getJob(second.id))!.status, 'cancelled');

    const done = (await ctx.store.getJob(first.id))!;
    const r = await ctx.cleanup.runOnce(new Date(done.expiresAt!.getTime() + 1000));
    assert.equal(r.expired, 1);
    const expired = (await ctx.store.getJob(first.id))!;
    assert.equal(expired.status, 'expired');
    assert.equal(expired.outputRef, null);
    assert.ok(!existsSync(ctx.engine.resolveOutput(done.outputRef!)));
    await close();
  });

  it('retries transient failures with backoff, then fails with a stable code', async () => {
    const { close, create, settle } = await harness({ MEDIA_MAX_RETRIES: '2' });
    const job = await settle((await create('flakyVid123', { mediaType: 'audio' })).id);
    assert.equal(job.status, 'failed');
    assert.equal(job.errorCode, 'NETWORK_FAILURE');
    assert.equal(job.attempts, 3);
    assert.equal(job.outputRef, null, 'never claims a file that was not produced');
    assert.ok(job.logs.filter((l) => l.includes('retry scheduled')).length === 2);
    await close();
  });

  it('fails safely when yt-dlp or FFmpeg is missing', async () => {
    const { ctx, close } = await harness({ YTDLP_BIN: '/nonexistent/yt-dlp', FFMPEG_BIN: '/nonexistent/ffmpeg' });
    const h = await ctx.engine.health(true);
    assert.equal(h.ytdlp.status, 'down');
    assert.equal(h.ffmpeg.status, 'down');
    await assert.rejects(ctx.analysis.analyze(yt('okVideo1234')), (e: AppError) => e.code === 'YTDLP_UNAVAILABLE');
    await close();
  });
});
