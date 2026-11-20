import { Router, type Request } from 'express';
import { processRequestSchema, urlInputSchema } from '../../../shared/types.js';
import { toJobView } from '../../services/jobService.js';
import { AppError, ok } from '../appError.js';
import type { AppContext } from '../context.js';
import { ensureAnonId, h, ownerOf, parse, rateLimit } from '../middleware.js';
import { listActivity, sendJobFile } from './shared.js';

/** Dashboard (cookie-session) media routes. */
export function mediaRoutes(ctx: AppContext) {
  const r = Router();
  const heavy = rateLimit(ctx, 'media');

  const requireOwner = (req: Request) => {
    const owner = ownerOf(req);
    if (!owner) throw new AppError('UNAUTHENTICATED');
    return owner;
  };

  r.post(
    '/analyze',
    heavy,
    h(async (req, res) => {
      if (!req.user && !ctx.config.limits.anonAnalyze) throw new AppError('ANONYMOUS_DISABLED');
      if (!req.user) ensureAnonId(ctx, req, res);
      const { url } = parse(urlInputSchema, req.body);
      req.auditAction = 'analyze';
      const result = await ctx.analysis.analyze(url);
      req.auditMeta = { platform: result.platform };
      res.json(ok(req.requestId, result));
    }),
  );

  r.post(
    '/jobs',
    heavy,
    h(async (req, res) => {
      if (!req.user && !ctx.config.limits.anonProcessing) throw new AppError('ANONYMOUS_DISABLED');
      if (!req.user) ensureAnonId(ctx, req, res);
      const body = parse(processRequestSchema, req.body);
      req.auditAction = 'job.create';
      const job = await ctx.jobs.create({
        owner: requireOwner(req),
        apiKeyId: null,
        requestId: req.requestId,
        url: body.url,
        options: body.options,
      });
      req.auditMeta = { jobId: job.id, platform: job.platform };
      res.status(202).json(ok(req.requestId, job));
    }),
  );

  r.get(
    '/jobs',
    h(async (req, res) => {
      const owner = ownerOf(req);
      if (!owner) return void res.json(ok(req.requestId, { items: [], nextCursor: null }));
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok(req.requestId, await listActivity(ctx, owner, req.query)));
    }),
  );

  r.delete(
    '/jobs',
    h(async (req, res) => {
      await ctx.jobs.hideAll(requireOwner(req));
      res.json(ok(req.requestId, { cleared: true }));
    }),
  );

  r.get(
    '/jobs/:id',
    h(async (req, res) => {
      const job = await ctx.jobs.getOwned(String(req.params.id), ownerOf(req));
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok(req.requestId, toJobView(job)));
    }),
  );

  r.post(
    '/jobs/:id/cancel',
    h(async (req, res) => {
      res.json(ok(req.requestId, await ctx.jobs.cancel(String(req.params.id), requireOwner(req))));
    }),
  );

  r.post(
    '/jobs/:id/retry',
    heavy,
    h(async (req, res) => {
      const job = await ctx.jobs.retry(String(req.params.id), requireOwner(req), req.requestId, null);
      res.status(202).json(ok(req.requestId, job));
    }),
  );

  r.delete(
    '/jobs/:id',
    h(async (req, res) => {
      await ctx.jobs.hide(String(req.params.id), requireOwner(req));
      res.json(ok(req.requestId, { cleared: true }));
    }),
  );

  r.get(
    '/jobs/:id/file',
    h(async (req, res) => {
      await sendJobFile(ctx, req, res, ownerOf(req));
    }),
  );

  return r;
}
