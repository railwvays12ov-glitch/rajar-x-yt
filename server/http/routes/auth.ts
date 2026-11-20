import { Router, type Request, type Response } from 'express';
import { loginSchema, registerSchema, type MeResponse } from '../../../shared/types.js';
import { toSessionUser } from '../../services/authService.js';
import { fail, ok } from '../appError.js';
import type { AppContext } from '../context.js';
import { COOKIE, clearCookie, ensureCsrf, h, parse, rateLimit, setCookie } from '../middleware.js';

export function authRoutes(ctx: AppContext) {
  const r = Router();
  const authLimit = rateLimit(ctx, 'auth', { limit: 10, windowMs: 15 * 60_000, perIdentity: false });

  r.get(
    '/me',
    h(async (req, res) => {
      const csrfToken = ensureCsrf(ctx, req, res);
      const owner = req.user ? { userId: req.user.id } : req.anonId ? { anonId: req.anonId } : null;
      const quota = owner
        ? await ctx.jobs.quotaFor(owner)
        : { dailyJobs: ctx.config.limits.anonDailyJobs, usedToday: 0, maxActiveJobs: ctx.config.limits.userMaxActiveJobs };
      const body: MeResponse = {
        user: req.user ? toSessionUser(req.user) : null,
        csrfToken,
        anonymous: { analyzeAllowed: ctx.config.limits.anonAnalyze, processingAllowed: ctx.config.limits.anonProcessing },
        quota: { ...quota, maxApiKeys: ctx.config.limits.userMaxApiKeys },
      };
      res.setHeader('Cache-Control', 'no-store');
      res.json(ok(req.requestId, body));
    }),
  );

  const startSession = async (req: Request, res: Response, userId: string) => {
    if (req.sessionId) await ctx.auth.logout(req.sessionId); // rotate on privilege change
    const { token } = await ctx.auth.createSession(userId, req.get('user-agent'));
    setCookie(ctx, res, COOKIE.session, token, { maxAgeMs: ctx.config.cookies.sessionTtlMs, httpOnly: true });
  };

  r.post(
    '/register',
    authLimit,
    h(async (req, res) => {
      const input = parse(registerSchema, req.body);
      const user = await ctx.auth.register(input);
      await startSession(req, res, user.id);
      req.auditAction = 'auth.register';
      req.user = user;
      res.status(201).json(ok(req.requestId, { user: toSessionUser(user) }));
    }),
  );

  r.post(
    '/login',
    rateLimit(ctx, 'auth-login', { limit: 10, windowMs: 15 * 60_000, perIdentity: false }),
    h(async (req, res) => {
      const input = parse(loginSchema, req.body);
      // Also limit per target account so one IP pool can't brute-force a single email.
      const perAccount = await ctx.limiter.check('auth-account', input.email, 20, 60 * 60_000);
      if (!perAccount.allowed) {
        res.setHeader('Retry-After', '900');
        res.status(429).json(fail(req.requestId, 'RATE_LIMITED', { retryAfterSeconds: 900 }));
        return;
      }
      req.auditAction = 'auth.login';
      const user = await ctx.auth.login(input.email, input.password);
      await startSession(req, res, user.id);
      req.user = user;
      res.json(ok(req.requestId, { user: toSessionUser(user) }));
    }),
  );

  r.post(
    '/logout',
    h(async (req, res) => {
      if (req.sessionId) await ctx.auth.logout(req.sessionId);
      clearCookie(ctx, res, COOKIE.session);
      req.auditAction = 'auth.logout';
      res.json(ok(req.requestId, { loggedOut: true }));
    }),
  );

  return r;
}
