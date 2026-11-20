import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import type { ErrorCode } from '../../shared/errors.js';
import type { ApiScope } from '../../shared/types.js';
import { newId, type JobOwner } from '../db/store.js';
import { logger } from '../logger.js';
import { hasScope } from '../security/apiKeys.js';
import { randomToken } from '../security/passwords.js';
import { hashIp } from '../security/secretBox.js';
import { AppError, fail } from './appError.js';
import type { AppContext } from './context.js';

export const COOKIE = { session: 'rx_session', csrf: 'rx_csrf', anon: 'rx_anon' } as const;

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wraps async handlers so rejections reach the error middleware. */
export const h =
  (fn: AsyncHandler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<S extends ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  return schema.parse(value);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k && !(k in out) && v.length < 4096) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

export function setCookie(
  ctx: AppContext,
  res: Response,
  name: string,
  value: string,
  opts: { maxAgeMs: number; httpOnly: boolean },
) {
  res.cookie(name, value, {
    httpOnly: opts.httpOnly,
    secure: ctx.config.cookies.secure,
    sameSite: ctx.config.cookies.sameSite,
    path: '/',
    maxAge: opts.maxAgeMs,
  });
}

export function clearCookie(ctx: AppContext, res: Response, name: string) {
  res.clearCookie(name, { path: '/', secure: ctx.config.cookies.secure, sameSite: ctx.config.cookies.sameSite });
}

/** Request ID + cookie jar. Accepts a well-formed inbound X-Request-Id from the proxy. */
export function requestContext(): RequestHandler {
  return (req, res, next) => {
    const inbound = req.get('x-request-id');
    req.requestId = inbound && /^req_[A-Za-z0-9_-]{8,40}$/.test(inbound) ? inbound : newId('req');
    req.cookieJar = parseCookies(req.headers.cookie);
    res.setHeader('X-Request-Id', req.requestId);
    next();
  };
}

/** DNS-rebinding protection for this server: only answer to configured Host headers. */
export function hostGuard(ctx: AppContext): RequestHandler {
  const allowed = new Set(ctx.config.allowedHosts.map((h) => h.toLowerCase()));
  const exempt = new Set(['/api/health', '/api/ready', '/api/version']);
  const anyHost = allowed.has('*');
  return (req, res, next) => {
    if (anyHost || exempt.has(req.path)) return next();
    const host = (req.headers.host ?? '').toLowerCase();
    if (!allowed.has(host)) {
      res.status(421).json(fail(req.requestId, 'FORBIDDEN', { reason: 'host' }));
      return;
    }
    next();
  };
}

export function corsAllowList(ctx: AppContext): RequestHandler {
  const allowed = new Set(ctx.config.allowedOrigins);
  return (req, res, next) => {
    const origin = req.get('origin');
    const isV1 = req.path.startsWith('/api/v1/');
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
    } else if (origin && isV1) {
      // Bearer-only API may be called from any origin, but never with cookies.
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,X-CSRF-Token,X-Request-Id');
      res.setHeader('Access-Control-Max-Age', '600');
      res.status(204).end();
      return;
    }
    next();
  };
}

/** Loads the session user (if any) and assigns an anonymous id cookie for limited guest use. */
export function sessionLoader(ctx: AppContext): RequestHandler {
  return h(async (req, res, next) => {
    const resolved = await ctx.auth.resolveSession(req.cookieJar[COOKIE.session]);
    if (resolved) {
      req.user = resolved.user;
      req.sessionId = resolved.sessionId;
    } else if (req.cookieJar[COOKIE.session]) {
      clearCookie(ctx, res, COOKIE.session);
    }
    const anon = req.cookieJar[COOKIE.anon];
    if (anon && /^[A-Za-z0-9_-]{20,64}$/.test(anon)) req.anonId = anon;
    next();
  });
}

export function ensureAnonId(ctx: AppContext, req: Request, res: Response): string {
  if (!req.anonId) {
    req.anonId = randomBytes(18).toString('base64url');
    setCookie(ctx, res, COOKIE.anon, req.anonId, { maxAgeMs: 7 * 24 * 3600_000, httpOnly: true });
  }
  return req.anonId;
}

export function ensureCsrf(ctx: AppContext, req: Request, res: Response): string {
  let token = req.cookieJar[COOKIE.csrf];
  if (!token || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) {
    token = randomToken(24);
    setCookie(ctx, res, COOKIE.csrf, token, { maxAgeMs: 7 * 24 * 3600_000, httpOnly: false });
  }
  return token;
}

/**
 * CSRF for cookie-authenticated, state-changing requests: double-submit token
 * plus Origin allow-list. Bearer-key API routes (/api/v1) are exempt by design.
 */
export function csrfGuard(ctx: AppContext): RequestHandler {
  const allowed = new Set(ctx.config.allowedOrigins);
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.originalUrl.startsWith('/api/v1/')) return next();
    const origin = req.get('origin');
    // When the public URL is not configured, accept requests from the same host the app is served on.
    const sameHost =
      ctx.config.anyOrigin && origin
        ? safeHost(origin) === (req.get('x-forwarded-host') ?? req.get('host') ?? '').toLowerCase()
        : false;
    const cookie = req.cookieJar[COOKIE.csrf];
    const header = req.get('x-csrf-token');
    if ((origin && !allowed.has(origin) && !sameHost) || !cookie || !header || cookie !== header) {
      res.status(403).json(fail(req.requestId, 'CSRF_FAILED'));
      return;
    }
    next();
  };
}

function safeHost(origin: string) {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return '';
  }
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}

function sendLimited(res: Response, req: Request, resetAt: number, limit: number, code: ErrorCode = 'RATE_LIMITED') {
  const retry = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  res.setHeader('Retry-After', String(retry));
  res.setHeader('RateLimit-Limit', String(limit));
  res.setHeader('RateLimit-Remaining', '0');
  res.setHeader('RateLimit-Reset', String(retry));
  res.status(429).json(fail(req.requestId, code, { retryAfterSeconds: retry }));
}

/** Rate limit by IP (always) and by user / API key when known. */
export function rateLimit(
  ctx: AppContext,
  bucket: string,
  opts: { limit?: number; windowMs?: number; perIdentity?: boolean } = {},
): RequestHandler {
  return h(async (req, res, next) => {
    if (isUnlimitedKey(req)) return next();
    const limit = opts.limit ?? ctx.config.limits.maxRequests;
    const windowMs = opts.windowMs ?? ctx.config.limits.windowSeconds * 1000;
    const ipDecision = await ctx.limiter.check(bucket, `ip:${clientIp(req)}`, limit, windowMs);
    if (!ipDecision.allowed) return void recordLimited(ctx, req).then(() => sendLimited(res, req, ipDecision.resetAt, limit));
    if (opts.perIdentity !== false) {
      const identity = req.apiKey
        ? `key:${req.apiKey.id}`
        : req.user
          ? `user:${req.user.id}`
          : req.anonId
            ? `anon:${req.anonId}`
            : null;
      if (identity) {
        const d = await ctx.limiter.check(bucket, identity, limit, windowMs);
        if (!d.allowed) return void recordLimited(ctx, req).then(() => sendLimited(res, req, d.resetAt, limit));
      }
    }
    res.setHeader('RateLimit-Limit', String(limit));
    res.setHeader('RateLimit-Remaining', String(ipDecision.remaining));
    next();
  });
}

async function recordLimited(ctx: AppContext, req: Request) {
  await ctx.store
    .addAudit({
      requestId: req.requestId,
      userId: req.user?.id ?? req.apiKey?.userId ?? null,
      apiKeyId: req.apiKey?.id ?? null,
      action: 'rate_limited',
      ipHash: hashIp(clientIp(req), ctx.config.sessionSecret),
      httpStatus: 429,
      errorCode: 'RATE_LIMITED',
      meta: { path: req.path },
    })
    .catch(() => {});
}

export function requireUser(): RequestHandler {
  return (req, _res, next) => next(req.user ? undefined : new AppError('UNAUTHENTICATED'));
}

export function requireAdmin(): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError('UNAUTHENTICATED'));
    next(req.user.role === 'admin' || req.user.role === 'owner' ? undefined : new AppError('FORBIDDEN'));
  };
}

/**
 * Reads the API key from `Authorization: Bearer …` or, for simple clients/links, from the
 * `?key=` / `?api_key=` URL parameter. The parameter is removed from req.query immediately,
 * is redacted by the logger, and is excluded from audit rows and the Nginx access log.
 */
export function takeApiKey(req: Request): string | undefined {
  const header = req.get('authorization');
  const q = req.query as Record<string, unknown>;
  const fromQuery = typeof q.key === 'string' ? q.key : typeof q.api_key === 'string' ? q.api_key : undefined;
  delete q.key;
  delete q.api_key;
  if (header) return header;
  return fromQuery ? `Bearer ${fromQuery.trim()}` : undefined;
}

export const isUnlimitedKey = (req: Request) => !!req.apiKey && req.apiKey.rateLimitPerMinute === null;

/** API-key auth + per-key rate limit (skipped for admin-set unlimited keys). */
export function apiKeyAuth(ctx: AppContext): RequestHandler {
  return h(async (req, res, next) => {
    req.user = undefined; // cookies never authenticate /api/v1
    let key;
    try {
      key = await ctx.apiKeys.authenticate(takeApiKey(req));
    } catch (err) {
      // Throttle invalid-key attempts per IP (valid keys are limited per key below).
      const d = await ctx.limiter.check('v1-badkey', `ip:${clientIp(req)}`, 60, 60_000);
      if (!d.allowed) return sendLimited(res, req, d.resetAt, 60);
      throw err;
    }
    req.apiKey = key;
    if (key.rateLimitPerMinute === null) {
      res.setHeader('RateLimit-Limit', 'unlimited');
      return next();
    }
    const d = await ctx.limiter.check('v1-key', key.id, key.rateLimitPerMinute, 60_000);
    res.setHeader('RateLimit-Limit', String(key.rateLimitPerMinute));
    res.setHeader('RateLimit-Remaining', String(d.remaining));
    if (!d.allowed) {
      await recordLimited(ctx, req);
      return sendLimited(res, req, d.resetAt, key.rateLimitPerMinute);
    }
    next();
  });
}

export function requireScope(scope: ApiScope): RequestHandler {
  return (req, _res, next) => {
    if (!req.apiKey) return next(new AppError('API_KEY_INVALID'));
    next(hasScope(req.apiKey.scopes, scope) ? undefined : new AppError('SCOPE_MISSING', { required: scope }));
  };
}

export function ownerOf(req: Request): JobOwner | null {
  if (req.apiKey) return { userId: req.apiKey.userId };
  if (req.user) return { userId: req.user.id };
  if (req.anonId) return { anonId: req.anonId };
  return null;
}

/** Writes an audit row for every API-key call and every state-changing dashboard call. */
export function auditTrail(ctx: AppContext): RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      const isV1 = req.originalUrl.startsWith('/api/v1/');
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
      if (!req.originalUrl.startsWith('/api/') || (!isV1 && !mutating && !req.auditAction)) return;
      if (res.statusCode === 429) return; // already recorded as rate_limited
      const route = (req.route?.path as string | undefined) ?? req.path;
      void ctx.store
        .addAudit({
          requestId: req.requestId,
          userId: req.user?.id ?? req.apiKey?.userId ?? null,
          apiKeyId: req.apiKey?.id ?? null,
          action: req.auditAction ?? `${req.method} ${req.baseUrl}${route}`,
          ipHash: hashIp(clientIp(req), ctx.config.sessionSecret),
          httpStatus: res.statusCode,
          errorCode: (res.locals.errorCode as string | undefined) ?? null,
          meta: req.auditMeta ?? {},
        })
        .catch((err) => logger.warn('Audit write failed', { err }));
    });
    next();
  };
}

export function errorHandler(): (err: unknown, req: Request, res: Response, next: NextFunction) => void {
  return (err, req, res, _next) => {
    const requestId = req.requestId ?? newId('req');
    let code: ErrorCode = 'INTERNAL_ERROR';
    let details: Record<string, unknown> | undefined;
    let status = 500;

    if (err instanceof AppError) {
      code = err.code;
      status = err.status;
      details = err.details?.reason === 'path' ? undefined : err.details;
    } else if (err instanceof ZodError) {
      code = 'VALIDATION_FAILED';
      status = 400;
      details = { fields: err.issues.slice(0, 10).map((i) => ({ path: i.path.join('.'), issue: i.code })) };
    } else if (err && typeof err === 'object' && 'type' in err) {
      const t = (err as { type?: string }).type;
      if (t === 'entity.too.large' || t === 'entity.parse.failed' || t === 'charset.unsupported') {
        code = 'VALIDATION_FAILED';
        status = t === 'entity.too.large' ? 413 : 400;
        details = { reason: t };
      }
    }

    if (code === 'INTERNAL_ERROR') logger.error('Unhandled error', { requestId, path: req.path, err });
    res.locals.errorCode = code;
    if (res.headersSent) return void res.end();
    res.status(status).json(fail(requestId, code, details));
  };
}
