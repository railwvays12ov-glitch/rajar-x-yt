import { Router } from 'express';
import { z } from 'zod';
import { createKeySchema, webhookConfigSchema } from '../../../shared/types.js';
import { ok } from '../appError.js';
import type { AppContext } from '../context.js';
import { h, parse, rateLimit, requireUser } from '../middleware.js';

/** Signed-in account features: API keys and webhook settings. */
export function accountRoutes(ctx: AppContext) {
  const r = Router();
  // Per-route (not router.use) so other /api routers mounted alongside stay reachable.
  const auth = requireUser();

  r.get(
    '/keys',
    auth,
    h(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok(req.requestId, { keys: await ctx.apiKeys.list(req.user!.id), maxKeys: ctx.config.limits.userMaxApiKeys }));
    }),
  );

  r.post(
    '/keys',
    auth,
    rateLimit(ctx, 'keys', { limit: 10, windowMs: 60_000 }),
    h(async (req, res) => {
      const input = parse(createKeySchema, req.body);
      const { key, rawKey } = await ctx.apiKeys.create(req.user!, input);
      req.auditAction = 'key.create';
      req.auditMeta = { keyId: key.id, scopes: key.scopes };
      // The raw key appears in this response only. It is never stored or logged.
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(ok(req.requestId, { key, rawKey }));
    }),
  );

  r.post(
    '/keys/:id/revoke',
    auth,
    h(async (req, res) => {
      req.auditAction = 'key.revoke';
      req.auditMeta = { keyId: req.params.id };
      res.json(ok(req.requestId, { key: await ctx.apiKeys.revoke(req.user!, String(req.params.id)) }));
    }),
  );

  r.post(
    '/keys/:id/regenerate',
    auth,
    rateLimit(ctx, 'keys', { limit: 10, windowMs: 60_000 }),
    h(async (req, res) => {
      const { key, rawKey } = await ctx.apiKeys.regenerate(req.user!, String(req.params.id));
      req.auditAction = 'key.regenerate';
      req.auditMeta = { oldKeyId: req.params.id, keyId: key.id };
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(ok(req.requestId, { key, rawKey }));
    }),
  );

  r.get(
    '/settings/webhook',
    auth,
    h(async (req, res) => {
      res.json(ok(req.requestId, await ctx.webhooks.get(req.user!.id)));
    }),
  );

  r.put(
    '/settings/webhook',
    auth,
    h(async (req, res) => {
      const body = parse(webhookConfigSchema.extend({ rotateSecret: z.boolean().default(false) }), req.body);
      req.auditAction = 'webhook.configure';
      const saved = await ctx.webhooks.configure(req.user!.id, body.url, body.events, body.rotateSecret);
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok(req.requestId, saved));
    }),
  );

  return r;
}
