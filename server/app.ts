import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { fail } from './http/appError.js';
import type { AppContext } from './http/context.js';
import {
  auditTrail,
  corsAllowList,
  csrfGuard,
  errorHandler,
  hostGuard,
  rateLimit,
  requestContext,
  sessionLoader,
} from './http/middleware.js';
import { accountRoutes } from './http/routes/account.js';
import { adminRoutes } from './http/routes/admin.js';
import { authRoutes } from './http/routes/auth.js';
import { mediaRoutes } from './http/routes/media.js';
import { seoRoutes } from './http/routes/seo.js';
import { systemRoutes } from './http/routes/system.js';
import { v1Routes } from './http/routes/v1.js';

/** Thumbnail CDNs the browser may load preview images from (no other third-party content). */
const IMAGE_HOSTS = [
  'https://i.ytimg.com',
  'https://*.ytimg.com',
  'https://*.cdninstagram.com',
  'https://*.fbcdn.net',
  'https://*.tiktokcdn.com',
  'https://*.tiktokcdn-us.com',
  'https://*.twimg.com',
];

export function createApp(ctx: AppContext): Express {
  const app = express();
  const { config } = ctx;

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('etag', false);

  app.use(requestContext());
  app.use(hostGuard(ctx));
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          styleSrcAttr: ["'unsafe-inline'"], // React style={{…}} props for transforms only
          imgSrc: ["'self'", 'data:', ...IMAGE_HOSTS, ...config.media.extraAllowedDomains.map((d) => `https://*.${d}`)],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          mediaSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: config.cspFrameAncestors.length ? ["'self'", ...config.cspFrameAncestors] : ["'self'"],
          ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      strictTransportSecurity: config.isProd ? { maxAge: 63072000, includeSubDomains: true } : false,
      frameguard: config.cspFrameAncestors.length ? false : { action: 'sameorigin' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });

  app.use(corsAllowList(ctx));
  app.use('/api', express.json({ limit: '16kb', strict: true, type: 'application/json' }));
  app.use(sessionLoader(ctx));
  app.use(auditTrail(ctx));
  const generalLimit = rateLimit(ctx, 'api', { limit: 300, windowMs: 60_000, perIdentity: false });
  // /api/v1 is limited per key (admins can make a key unlimited) and per IP for bad keys.
  app.use('/api', (req, res, next) => (req.originalUrl.startsWith('/api/v1/') ? next() : generalLimit(req, res, next)));
  app.use('/api', csrfGuard(ctx));

  app.use('/api', systemRoutes(ctx));
  app.use('/api/auth', authRoutes(ctx));
  app.use('/api/v1', v1Routes(ctx));
  app.use('/api/admin', adminRoutes(ctx));
  app.use('/api', accountRoutes(ctx));
  app.use('/api', mediaRoutes(ctx));
  app.use('/api', (req, res) => void res.status(404).json(fail(req.requestId, 'NOT_FOUND')));

  app.use(seoRoutes(ctx));

  if (ctx.clientDir && existsSync(path.join(ctx.clientDir, 'index.html'))) {
    const indexHtml = readFileSync(path.join(ctx.clientDir, 'index.html'), 'utf8').replaceAll(
      '__PUBLIC_BASE_URL__',
      config.publicBaseUrl,
    );
    app.use('/assets', express.static(path.join(ctx.clientDir, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use(express.static(ctx.clientDir, { index: false, maxAge: '1h' }));
    // SPA fallback for client routes.
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('html').send(indexHtml);
    });
  }

  app.use(errorHandler());
  return app;
}
