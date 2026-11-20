import { Router } from 'express';
import { z } from 'zod';
import { keyLimitSchema } from '../../../shared/types.js';
import { toKeyView } from '../../services/apiKeyService.js';
import { effectiveLimits } from '../../services/analysisService.js';
import { logger } from '../../logger.js';
import { AppError, ok } from '../appError.js';
import type { AppContext } from '../context.js';
import { h, parse, requireAdmin } from '../middleware.js';
import { componentHealth } from './system.js';

export async function adminOverview(ctx: AppContext) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const [users, activeKeys, revokedKeys, stats, rateLimited, storageBytes, components, settings, limits, queue] =
    await Promise.all([
      ctx.store.countUsers(),
      ctx.store.countApiKeys({ status: 'active' }),
      ctx.store.countApiKeys({ status: 'revoked' }),
      ctx.store.jobStats(since),
      ctx.store.countAudit('rate_limited', since),
      ctx.cleanup.storageUsage(),
      componentHealth(ctx),
      ctx.store.getSettings(),
      effectiveLimits(ctx.store, ctx.config.media),
      ctx.queue.stats(),
    ]);
  return {
    totals: {
      users,
      activeKeys,
      revokedKeys,
      jobsToday: stats.total,
      failedJobsToday: stats.failed,
      blockedJobsToday: stats.blocked,
      completedJobsToday: stats.completed,
      rateLimitEventsToday: rateLimited,
      avgProcessingMs: stats.avgProcessingMs,
    },
    storage: { usedBytes: storageBytes, maxBytes: ctx.config.media.storageMaxBytes },
    components,
    queue,
    settings: {
      processingEnabled: settings.processingEnabled,
      maxFileSizeBytes: limits.maxFileSizeBytes,
      maxDurationSeconds: limits.maxDurationSeconds,
      envMaxFileSizeBytes: ctx.config.media.maxFileSizeBytes,
      envMaxDurationSeconds: ctx.config.media.maxDurationSeconds,
    },
  };
}

export function adminRoutes(ctx: AppContext) {
  const r = Router();
  r.use(requireAdmin());

  r.get(
    '/overview',
    h(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok(req.requestId, await adminOverview(ctx)));
    }),
  );

  r.get('/logs', (req, res) => {
    const level = z.enum(['debug', 'info', 'warn', 'error']).optional().parse(req.query.level);
    // Entries are redacted at write time — no secrets, tokens or raw keys.
    res.json(ok(req.requestId, { entries: logger.recent(200, level).reverse() }));
  });

  r.get(
    '/keys',
    h(async (req, res) => {
      const rows = await ctx.store.listApiKeys(null, 200);
      const items = await Promise.all(
        rows.map(async (k) => ({ ...toKeyView(k), ownerEmail: (await ctx.store.findUserById(k.userId))?.email ?? null })),
      );
      res.json(ok(req.requestId, { keys: items }));
    }),
  );

  r.post(
    '/keys/:id/revoke',
    h(async (req, res) => {
      req.auditAction = 'admin.key.revoke';
      req.auditMeta = { keyId: req.params.id };
      res.json(ok(req.requestId, { key: await ctx.apiKeys.revoke(req.user!, String(req.params.id), 'admin_revoked') }));
    }),
  );

  /** Set a key's request limit: { "rateLimitPerMinute": 500 } or { "rateLimitPerMinute": null } for unlimited. */
  r.put(
    '/keys/:id/limit',
    h(async (req, res) => {
      const body = parse(keyLimitSchema, req.body);
      req.auditAction = 'admin.key.limit';
      req.auditMeta = { keyId: req.params.id, rateLimitPerMinute: body.rateLimitPerMinute };
      res.json(ok(req.requestId, { key: await ctx.apiKeys.setLimit(req.user!, String(req.params.id), body.rateLimitPerMinute) }));
    }),
  );

  r.get(
    '/requests/:requestId',
    h(async (req, res) => {
      const id = String(req.params.requestId);
      if (!/^req_[A-Za-z0-9_-]{8,40}$/.test(id)) throw new AppError('VALIDATION_FAILED', { field: 'requestId' });
      const [audit, jobs] = await Promise.all([
        ctx.store.findAuditByRequestId(id),
        ctx.store.listJobs({ requestId: id, limit: 50, includeHidden: true }),
      ]);
      res.json(
        ok(req.requestId, {
          requestId: id,
          audit: audit.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
          jobs: jobs.map((j) => ({ id: j.id, status: j.status, errorCode: j.errorCode, platform: j.platform })),
        }),
      );
    }),
  );

  r.put(
    '/settings',
    h(async (req, res) => {
      const body = parse(
        z
          .object({
            processingEnabled: z.boolean().optional(),
            maxFileSizeBytes: z
              .number()
              .int()
              .min(1024 * 1024)
              .max(ctx.config.media.storageMaxBytes)
              .nullable()
              .optional(),
            maxDurationSeconds: z
              .number()
              .int()
              .min(10)
              .max(24 * 3600)
              .nullable()
              .optional(),
          })
          .strict(),
        req.body,
      );
      req.auditAction = 'admin.settings';
      req.auditMeta = body;
      const next = await ctx.store.updateSettings(body);
      ctx.analysis.clearCache(); // limits changed → re-evaluate policy
      logger.info('Runtime settings updated', { by: req.user!.id, ...body });
      res.json(ok(req.requestId, next));
    }),
  );

  return r;
}
