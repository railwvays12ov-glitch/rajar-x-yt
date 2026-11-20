import { access, constants, mkdir } from 'node:fs/promises';
import { Router } from 'express';
import { PLATFORMS, OTHER_PLATFORM } from '../../../shared/platforms.js';
import type { ComponentHealth, SystemStatus } from '../../../shared/types.js';
import { effectiveLimits } from '../../services/analysisService.js';
import { ok } from '../appError.js';
import type { AppContext } from '../context.js';
import { h } from '../middleware.js';

export async function componentHealth(ctx: AppContext): Promise<SystemStatus['components']> {
  const media = await ctx.engine.health();
  const database: ComponentHealth = await ctx.store
    .ping()
    .then((): ComponentHealth => ({ status: 'up', detail: ctx.store.kind }))
    .catch((): ComponentHealth => ({ status: 'down', detail: 'Database unreachable' }));
  const redis: ComponentHealth = ctx.redisPing
    ? await ctx
        .redisPing()
        .then((): ComponentHealth => ({ status: 'up' }))
        .catch((): ComponentHealth => ({ status: 'down', detail: 'Redis unreachable' }))
    : { status: 'disabled', detail: 'In-process queue and rate limits' };
  const storage: ComponentHealth = await mkdir(ctx.config.media.tempDir, { recursive: true, mode: 0o700 })
    .then(() => access(ctx.config.media.tempDir, constants.W_OK))
    .then((): ComponentHealth => ({ status: 'up' }))
    .catch((): ComponentHealth => ({ status: 'down', detail: 'Temp directory not writable' }));
  return { ytdlp: media.ytdlp, ffmpeg: media.ffmpeg, database, redis, storage };
}

export function systemRoutes(ctx: AppContext) {
  const r = Router();

  /** Liveness + dependency health. Always 200 while the process is serving. */
  r.get(
    '/health',
    h(async (req, res) => {
      const components = await componentHealth(ctx);
      const degraded = Object.values(components).some((c) => c.status === 'down');
      res.json(
        ok(req.requestId, {
          status: degraded ? 'degraded' : 'ok',
          uptimeSeconds: Math.round(process.uptime()),
          components,
          setupWarnings: [
            ...(components.ytdlp.status === 'down' ? ['yt-dlp is not installed or YTDLP_BIN is wrong.'] : []),
            ...(components.ffmpeg.status === 'down' ? ['FFmpeg is not installed or FFMPEG_BIN is wrong.'] : []),
          ],
        }),
      );
    }),
  );

  /** Readiness: 503 until the database and temp storage are usable. */
  r.get(
    '/ready',
    h(async (req, res) => {
      const c = await componentHealth(ctx);
      const ready = c.database.status === 'up' && c.storage.status === 'up' && c.redis.status !== 'down';
      res.status(ready ? 200 : 503).json({
        success: ready,
        requestId: req.requestId,
        data: { ready, database: c.database.status, storage: c.storage.status, redis: c.redis.status },
        error: ready ? null : { code: 'STORAGE_UNAVAILABLE', message: 'Service is not ready.', nextAction: 'Retry shortly.' },
      });
    }),
  );

  r.get('/version', (req, res) => {
    res.json(
      ok(req.requestId, {
        name: 'RAJAR X YT',
        version: ctx.config.version,
        apiVersion: 'v1',
        node: process.version,
        startedAt: ctx.startedAt.toISOString(),
      }),
    );
  });

  r.get(
    '/status',
    h(async (req, res) => {
      const [components, settings, limits] = await Promise.all([
        componentHealth(ctx),
        ctx.store.getSettings(),
        effectiveLimits(ctx.store, ctx.config.media),
      ]);
      const down =
        components.ytdlp.status === 'down' || components.ffmpeg.status === 'down' || components.database.status === 'down';
      const disabled = new Set(ctx.config.media.disabledPlatforms);
      const status: SystemStatus = {
        status: !settings.processingEnabled ? 'maintenance' : down ? 'degraded' : 'operational',
        processingEnabled: settings.processingEnabled,
        components,
        platforms: [
          ...PLATFORMS.map((p) => ({ id: p.id, name: p.name, glyph: p.glyph, scope: p.scope, enabled: !disabled.has(p.id) })),
          {
            id: OTHER_PLATFORM.id,
            name: OTHER_PLATFORM.name,
            glyph: OTHER_PLATFORM.glyph,
            scope: OTHER_PLATFORM.scope,
            enabled: ctx.config.media.extraAllowedDomains.length > 0 && !disabled.has('other'),
          },
        ],
        limits: { ...limits, retentionMinutes: ctx.config.media.retentionMinutes },
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok(req.requestId, status));
    }),
  );

  return r;
}
