import { Router, type Request } from 'express';
import { z } from 'zod';
import { processRequestSchema, urlInputSchema, webhookConfigSchema } from '../../../shared/types.js';
import { toJobView } from '../../services/jobService.js';
import { AppError, ok } from '../appError.js';
import type { AppContext } from '../context.js';
import { apiKeyAuth, h, parse, rateLimit, requireScope } from '../middleware.js';
import { adminOverview } from './admin.js';
import { listActivity, sendJobFile } from './shared.js';

/**
 * Public integration API (Bearer rjar_live_… keys). Used by scripts, dashboards and
 * authorized WhatsApp MD bots. Same validation and restrictions as the dashboard.
 */
export function v1Routes(ctx: AppContext) {
  const r = Router();
  r.use(apiKeyAuth(ctx));
  const heavy = rateLimit(ctx, 'v1-media');
  const owner = (req: Request) => ({ userId: req.apiKey!.userId });

  r.get('/key-info', (req, res) => {
    const k = req.apiKey!;
    res.json(
      ok(req.requestId, {
        id: k.id,
        name: k.name,
        displayPrefix: k.displayPrefix,
        scopes: k.scopes,
        rateLimitPerMinute: k.rateLimitPerMinute, // null = unlimited
        createdAt: k.createdAt.toISOString(),
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      }),
    );
  });

  // Link-friendly variant: GET /api/v1/analyze?url=…&key=rjar_live_…
  r.get(
    '/analyze',
    requireScope('analyze'),
    heavy,
    h(async (req, res) => {
      const { url } = parse(urlInputSchema, { url: req.query.url });
      req.auditAction = 'v1.analyze';
      res.json(ok(req.requestId, await ctx.analysis.analyze(url)));
    }),
  );

  r.post(
    '/analyze',
    requireScope('analyze'),
    heavy,
    h(async (req, res) => {
      const { url } = parse(urlInputSchema, req.body);
      req.auditAction = 'v1.analyze';
      res.json(ok(req.requestId, await ctx.analysis.analyze(url)));
    }),
  );

  r.post(
    '/process',
    requireScope('process'),
    heavy,
    h(async (req, res) => {
      const body = parse(processRequestSchema, req.body);
      req.auditAction = 'v1.process';
      const job = await ctx.jobs.create({
        owner: owner(req),
        apiKeyId: req.apiKey!.id,
        requestId: req.requestId,
        url: body.url,
        options: body.options,
        unlimited: req.apiKey!.rateLimitPerMinute === null,
      });
      req.auditMeta = { jobId: job.id };
      res.status(202).json(ok(req.requestId, job));
    }),
  );

  r.get(
    '/jobs/:id',
    h(async (req, res) => {
      const scopes = req.apiKey!.scopes;
      if (!scopes.includes('process') && !scopes.includes('activity'))
        throw new AppError('SCOPE_MISSING', { required: 'process|activity' });
      const job = await ctx.jobs.getOwned(String(req.params.id), owner(req));
      res.json(ok(req.requestId, toJobView(job)));
    }),
  );

  r.post(
    '/jobs/:id/cancel',
    requireScope('process'),
    h(async (req, res) => {
      res.json(ok(req.requestId, await ctx.jobs.cancel(String(req.params.id), owner(req))));
    }),
  );

  r.get(
    '/jobs/:id/file',
    requireScope('process'),
    h(async (req, res) => {
      req.auditAction = 'v1.file';
      await sendJobFile(ctx, req, res, owner(req));
    }),
  );

  r.get(
    '/activity',
    requireScope('activity'),
    h(async (req, res) => {
      res.json(ok(req.requestId, await listActivity(ctx, owner(req), req.query)));
    }),
  );

  r.get(
    '/webhook',
    requireScope('webhooks'),
    h(async (req, res) => {
      res.json(ok(req.requestId, await ctx.webhooks.get(req.apiKey!.userId)));
    }),
  );

  r.put(
    '/webhook',
    requireScope('webhooks'),
    h(async (req, res) => {
      const body = parse(webhookConfigSchema.extend({ rotateSecret: z.boolean().default(false) }), req.body);
      req.auditAction = 'v1.webhook.configure';
      res.json(ok(req.requestId, await ctx.webhooks.configure(req.apiKey!.userId, body.url, body.events, body.rotateSecret)));
    }),
  );

  r.get(
    '/admin/overview',
    requireScope('admin'),
    h(async (req, res) => {
      const owner = await ctx.store.findUserById(req.apiKey!.userId);
      if (!owner || owner.role === 'user' || !ctx.config.limits.adminScopeEnabled) throw new AppError('FORBIDDEN');
      res.json(ok(req.requestId, await adminOverview(ctx)));
    }),
  );

  return r;
}
