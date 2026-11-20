import { Router } from 'express';
import type { AppContext } from '../context.js';

export const PUBLIC_ROUTES = ['/', '/docs', '/terms', '/privacy', '/login'];

/** robots.txt and sitemap.xml are generated from PUBLIC_BASE_URL so they are always absolute. */
export function seoRoutes(ctx: AppContext) {
  const r = Router();
  const base = ctx.config.publicBaseUrl;

  r.get('/robots.txt', (_req, res) => {
    res
      .type('text/plain')
      .send(
        [
          'User-agent: *',
          'Allow: /',
          'Disallow: /api/',
          'Disallow: /keys',
          'Disallow: /activity',
          'Disallow: /settings',
          'Disallow: /admin',
          `Sitemap: ${base}/sitemap.xml`,
          '',
        ].join('\n'),
      );
  });

  r.get('/sitemap.xml', (_req, res) => {
    const urls = PUBLIC_ROUTES.map(
      (p) => `  <url><loc>${base}${p === '/' ? '/' : p}</loc><changefreq>weekly</changefreq></url>`,
    ).join('\n');
    res
      .type('application/xml')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
      );
  });

  return r;
}
