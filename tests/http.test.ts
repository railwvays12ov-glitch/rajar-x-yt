import assert from 'node:assert/strict';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.js';
import { buildContext } from '../server/bootstrap.js';
import type { AppContext } from '../server/http/context.js';
import { logger } from '../server/logger.js';
import { fakeResolver, testConfig, waitFor, yt } from './helpers.js';

let server: Server;
let base: string;
let ctx: AppContext;
let close: () => Promise<void>;

/** Tiny browser-like client: keeps cookies, sends the CSRF header. */
class Client {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(private readonly origin = 'http://localhost:5173') {}

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        origin: this.origin,
        cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
        ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, v] = pair!.split('=');
      if (/Max-Age=0/.test(c)) this.cookies.delete(k!);
      else this.cookies.set(k!, v!);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON */
    }
    return { status: res.status, json, text, headers: res.headers };
  }

  async boot() {
    const me = await this.req('GET', '/api/auth/me');
    this.csrf = me.json.data.csrfToken;
    return me;
  }
}

before(async () => {
  const config = testConfig({ ALLOW_ANONYMOUS_PROCESSING: 'false', ADMIN_SCOPE_ENABLED: 'false' });
  ({ ctx, close } = await buildContext(config, { resolver: fakeResolver }));
  server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `http://${host}`;
  ctx.config.allowedHosts.push(host); // as ALLOWED_HOSTS would in production
  server.on('request', createApp(ctx));
});

after(async () => {
  server.close();
  await close();
});

describe('System endpoints', () => {
  it('/api/health, /api/ready and /api/version respond with envelopes', async () => {
    const c = new Client();
    const health = await c.req('GET', '/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.json.success, true);
    assert.match(health.json.requestId, /^req_/);
    assert.equal(health.json.data.components.ytdlp.status, 'up');
    assert.equal(health.json.data.components.ffmpeg.status, 'up');
    assert.equal((await c.req('GET', '/api/ready')).status, 200);
    const v = await c.req('GET', '/api/version');
    assert.equal(v.json.data.name, 'RAJAR X YT');
    const s = await c.req('GET', '/api/status');
    assert.equal(s.json.data.status, 'operational');
    assert.ok(s.json.data.platforms.some((p: { id: string }) => p.id === 'youtube'));
  });

  it('sends security headers and rejects unknown Host headers', async () => {
    const c = new Client();
    const r = await c.req('GET', '/api/status');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(r.headers.get('content-security-policy'));
    assert.ok(r.headers.get('x-request-id'));
    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(base);
      request({ host: u.hostname, port: u.port, path: '/api/status', headers: { host: 'attacker.example' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
        .on('error', reject)
        .end();
    });
    assert.equal(status, 421, 'DNS-rebinding guard');
  });

  it('unknown API routes return a friendly NOT_FOUND envelope', async () => {
    const r = await new Client().req('GET', '/api/does-not-exist');
    assert.equal(r.status, 404);
    assert.equal(r.json.error.code, 'NOT_FOUND');
    assert.ok(r.json.error.nextAction);
  });

  it('robots.txt and sitemap.xml are generated', async () => {
    const c = new Client();
    assert.match((await c.req('GET', '/robots.txt')).text, /Sitemap: http:\/\/localhost:5173\/sitemap.xml/);
    assert.match((await c.req('GET', '/sitemap.xml')).text, /<loc>http:\/\/localhost:5173\/docs<\/loc>/);
  });
});

describe('Route manifest', () => {
  it('every documented route is mounted (no 404s)', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/health'],
      ['GET', '/api/ready'],
      ['GET', '/api/version'],
      ['GET', '/api/status'],
      ['GET', '/api/auth/me'],
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/register'],
      ['POST', '/api/auth/logout'],
      ['POST', '/api/analyze'],
      ['GET', '/api/jobs'],
      ['POST', '/api/jobs'],
      ['DELETE', '/api/jobs'],
      ['GET', '/api/keys'],
      ['POST', '/api/keys'],
      ['GET', '/api/settings/webhook'],
      ['PUT', '/api/settings/webhook'],
      ['GET', '/api/admin/overview'],
      ['GET', '/api/admin/logs'],
      ['GET', '/api/admin/keys'],
      ['PUT', '/api/admin/settings'],
      ['POST', '/api/v1/analyze'],
      ['POST', '/api/v1/process'],
      ['GET', '/api/v1/activity'],
      ['GET', '/api/v1/key-info'],
      ['GET', '/api/v1/webhook'],
      ['GET', '/api/v1/admin/overview'],
      ['GET', '/robots.txt'],
      ['GET', '/sitemap.xml'],
    ];
    const c = new Client();
    await c.boot();
    for (const [method, path] of routes) {
      const r = await c.req(method, path, method === 'GET' ? undefined : {});
      assert.notEqual(r.status, 404, `${method} ${path}`);
    }
  });
});

describe('Auth, CSRF and permissions', () => {
  it('rejects state-changing requests without CSRF token or from foreign origins', async () => {
    const c = new Client();
    const noToken = await c.req('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' });
    assert.equal(noToken.status, 403);
    assert.equal(noToken.json.error.code, 'CSRF_FAILED');
    const evil = new Client('https://evil.example');
    await evil.boot();
    const r = await evil.req('POST', '/api/auth/login', { email: 'a@b.co', password: 'x' });
    assert.equal(r.json.error.code, 'CSRF_FAILED');
  });

  it('anonymous users can analyze but cannot create keys or process', async () => {
    const c = new Client();
    await c.boot();
    const a = await c.req('POST', '/api/analyze', { url: yt('okVideo1234') });
    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(a.json.data.safeUse.status, 'allowed');
    assert.equal(
      (await c.req('POST', '/api/keys', { name: 'x', scopes: ['analyze'], rateLimitPerMinute: 60 })).json.error.code,
      'UNAUTHENTICATED',
    );
    const p = await c.req('POST', '/api/jobs', {
      url: yt('okVideo1234'),
      options: { mediaType: 'audio' },
      rightsConfirmed: true,
    });
    assert.equal(p.json.error.code, 'ANONYMOUS_DISABLED');
  });

  it('restricted media fails safely with a request ID and no internals', async () => {
    const c = new Client();
    await c.boot();
    const r = await c.req('POST', '/api/analyze', { url: yt('privVideo12') });
    assert.equal(r.status, 403);
    assert.equal(r.json.success, false);
    assert.equal(r.json.error.code, 'MEDIA_PRIVATE');
    assert.match(r.json.requestId, /^req_/);
    assert.ok(!/yt-dlp|stderr|\/tmp|ERROR:/.test(r.text));
    const drm = await c.req('POST', '/api/analyze', { url: yt('drmVideo123') });
    assert.equal(drm.json.error.code, 'DRM_PROTECTED');
    const ssrf = await c.req('POST', '/api/analyze', { url: 'https://rebind.youtube.com/watch?v=okVideo1234' });
    assert.equal(ssrf.json.error.code, 'INVALID_URL');
  });

  it('non-admins cannot reach admin routes; the owner can', async () => {
    const user = new Client();
    await user.boot();
    await user.req('POST', '/api/auth/register', {
      email: 'plain@rajar.test',
      password: 'correct horse battery',
      displayName: 'Plain',
    });
    assert.equal((await user.req('GET', '/api/admin/overview')).json.error.code, 'FORBIDDEN');

    const owner = new Client();
    await owner.boot();
    const reg = await owner.req('POST', '/api/auth/register', {
      email: 'owner@rajar.test',
      password: 'correct horse battery',
      displayName: 'Owner',
    });
    assert.equal(reg.json.data.user.role, 'owner');
    const o = await owner.req('GET', '/api/admin/overview');
    assert.equal(o.status, 200);
    assert.ok(o.json.data.totals.users >= 2);
    const s = await owner.req('PUT', '/api/admin/settings', { processingEnabled: false });
    assert.equal(s.json.data.processingEnabled, false);
    await owner.req('PUT', '/api/admin/settings', { processingEnabled: true });
  });
});

describe('API keys and the v1 API', () => {
  it('creates a key shown once, lists masked, authenticates, enforces scopes and revocation', async () => {
    const c = new Client();
    await c.boot();
    await c.req('POST', '/api/auth/register', { email: 'dev@rajar.test', password: 'correct horse battery', displayName: 'Dev' });

    const created = await c.req('POST', '/api/keys', {
      name: 'WhatsApp bot',
      scopes: ['analyze', 'activity', 'process'],
      rateLimitPerMinute: 60,
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const raw: string = created.json.data.rawKey;
    assert.match(raw, /^rjar_live_[0-9A-Za-z]{40}$/);
    assert.equal(created.headers.get('cache-control'), 'no-store');

    const list = await c.req('GET', '/api/keys');
    assert.ok(!list.text.includes(raw), 'list never contains the raw key');
    assert.ok(!list.text.includes('keyHash'));
    assert.match(list.json.data.keys[0].displayPrefix, /…/);

    const bearer = { authorization: `Bearer ${raw}`, cookie: '' };
    const info = await c.req('GET', '/api/v1/key-info', undefined, bearer);
    assert.equal(info.status, 200);
    assert.deepEqual(info.json.data.scopes, ['analyze', 'activity', 'process']);

    const analyzed = await c.req('POST', '/api/v1/analyze', { url: yt('okVideo1234') }, bearer);
    assert.equal(analyzed.json.data.title, 'RAJAR X Test Clip: Neon / Orbit <1080p>');

    const job = await c.req(
      'POST',
      '/api/v1/process',
      { url: yt('okVideo1234'), options: { mediaType: 'thumbnail' }, rightsConfirmed: true },
      bearer,
    );
    assert.equal(job.status, 202, JSON.stringify(job.json));
    const jobId = job.json.data.id;
    const ready = await waitFor(async () => {
      const r = await c.req('GET', `/api/v1/jobs/${jobId}`, undefined, bearer);
      return r.json.data.status === 'ready' ? r : null;
    });
    assert.equal(ready.json.data.outputFilename.endsWith('.jpg'), true);
    const file = await c.req('GET', `/api/v1/jobs/${jobId}/file`, undefined, bearer);
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('content-type'), 'image/jpeg');
    assert.match(file.headers.get('content-disposition') ?? '', /^attachment;/);

    const activity = await c.req('GET', '/api/v1/activity?limit=5', undefined, bearer);
    assert.equal(activity.json.data.items[0].id, jobId);
    assert.equal(activity.json.data.items[0].requestId, job.json.requestId);

    // Rights confirmation is mandatory.
    const noRights = await c.req(
      'POST',
      '/api/v1/process',
      { url: yt('okVideo1234'), options: { mediaType: 'thumbnail' } },
      bearer,
    );
    assert.equal(noRights.json.error.code, 'VALIDATION_FAILED');

    // Scope enforcement
    const limited = await c.req('POST', '/api/keys', { name: 'read only', scopes: ['activity'], rateLimitPerMinute: 30 });
    const lim = { authorization: `Bearer ${limited.json.data.rawKey}`, cookie: '' };
    const denied = await c.req('POST', '/api/v1/analyze', { url: yt('okVideo1234') }, lim);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.error.code, 'SCOPE_MISSING');

    // Revocation
    await c.req('POST', `/api/keys/${created.json.data.key.id}/revoke`);
    const revoked = await c.req('GET', '/api/v1/key-info', undefined, bearer);
    assert.equal(revoked.status, 401);
    assert.equal(revoked.json.error.code, 'API_KEY_REVOKED');

    const bogus = await c.req('GET', '/api/v1/key-info', undefined, { authorization: 'Bearer rjar_live_nope', cookie: '' });
    assert.equal(bogus.json.error.code, 'API_KEY_INVALID');

    // Cookies alone never authenticate the v1 API.
    assert.equal((await c.req('GET', '/api/v1/key-info')).json.error.code, 'API_KEY_INVALID');

    // Raw keys never appear in logs or the audit trail.
    const logs = JSON.stringify(logger.recent(500));
    assert.ok(!logs.includes(raw));
    const audit = JSON.stringify(await ctx.store.findAuditByRequestId(job.json.requestId));
    assert.ok(audit.includes('v1.process'));
    assert.ok(!audit.includes(raw));
  });

  it('accepts the key as a URL parameter (?key= / ?api_key=) and never echoes it', async () => {
    const c = new Client();
    await c.boot();
    await c.req('POST', '/api/auth/register', { email: 'url@rajar.test', password: 'correct horse battery', displayName: 'URL' });
    const created = await c.req('POST', '/api/keys', { name: 'link', scopes: ['analyze', 'process'], rateLimitPerMinute: 60 });
    const raw: string = created.json.data.rawKey;
    const info = await c.req('GET', `/api/v1/key-info?key=${raw}`, undefined, { cookie: '' });
    assert.equal(info.status, 200);
    assert.ok(!info.text.includes(raw));
    const alt = await c.req('GET', `/api/v1/key-info?api_key=${raw}`, undefined, { cookie: '' });
    assert.equal(alt.status, 200);
    const analyzed = await c.req('GET', `/api/v1/analyze?url=${encodeURIComponent(yt('okVideo1234'))}&key=${raw}`, undefined, {
      cookie: '',
    });
    assert.equal(analyzed.json.data.platform, 'youtube');

    // Link-style download: process → file via ?key=, then the file is deleted from the server.
    const job = await c.req(
      'POST',
      `/api/v1/process?key=${raw}`,
      { url: yt('okVideo1234'), options: { mediaType: 'thumbnail' }, rightsConfirmed: true },
      { cookie: '' },
    );
    const id = job.json.data.id;
    await waitFor(
      async () => (await c.req('GET', `/api/v1/jobs/${id}?key=${raw}`, undefined, { cookie: '' })).json.data.status === 'ready',
    );
    const file = await c.req('GET', `/api/v1/jobs/${id}/file?key=${raw}`, undefined, { cookie: '' });
    assert.equal(file.status, 200);
    const after = await waitFor(async () => {
      const j = (await c.req('GET', `/api/v1/jobs/${id}?key=${raw}`, undefined, { cookie: '' })).json.data;
      return j.status === 'completed' ? j : null;
    });
    assert.ok(after.logs.some((l: string) => l.includes('file deleted from server')));
    const again = await c.req('GET', `/api/v1/jobs/${id}/file?key=${raw}`, undefined, { cookie: '' });
    assert.equal(again.json.error.code, 'JOB_EXPIRED');
    assert.ok(!JSON.stringify(logger.recent(500)).includes(raw), 'URL keys are redacted from logs');
  });

  it('admins can make a key unlimited or set a custom limit; users cannot', async () => {
    const owner = new Client();
    await owner.boot();
    await owner.req('POST', '/api/auth/login', { email: 'owner@rajar.test', password: 'correct horse battery' });
    const user = new Client();
    await user.boot();
    await user.req('POST', '/api/auth/register', {
      email: 'lim@rajar.test',
      password: 'correct horse battery',
      displayName: 'Lim',
    });
    const k = await user.req('POST', '/api/keys', { name: 'bot', scopes: ['activity'], rateLimitPerMinute: 30 });
    const raw = k.json.data.rawKey;
    const id = k.json.data.key.id;

    assert.equal(
      (await user.req('POST', '/api/keys', { name: 'x', scopes: ['activity'], rateLimitPerMinute: null })).json.error.code,
      'FORBIDDEN',
    );
    assert.equal(
      (await user.req('PUT', `/api/admin/keys/${id}/limit`, { rateLimitPerMinute: null })).json.error.code,
      'FORBIDDEN',
    );

    const set = await owner.req('PUT', `/api/admin/keys/${id}/limit`, { rateLimitPerMinute: null });
    assert.equal(set.status, 200, JSON.stringify(set.json));
    assert.equal(set.json.data.key.rateLimitPerMinute, null);
    let last;
    for (let i = 0; i < 40; i++) last = await user.req('GET', `/api/v1/key-info?key=${raw}`, undefined, { cookie: '' });
    assert.equal(last!.status, 200, 'unlimited key is never rate limited');
    assert.equal(last!.headers.get('ratelimit-limit'), 'unlimited');

    await owner.req('PUT', `/api/admin/keys/${id}/limit`, { rateLimitPerMinute: 2 });
    const statuses = [];
    for (let i = 0; i < 3; i++)
      statuses.push((await user.req('GET', `/api/v1/key-info?key=${raw}`, undefined, { cookie: '' })).status);
    assert.equal(statuses[2], 429, 'custom limit is enforced');
  });

  it('per-key rate limits return RATE_LIMITED with Retry-After', async () => {
    const c = new Client();
    await c.boot();
    await c.req('POST', '/api/auth/register', { email: 'rl@rajar.test', password: 'correct horse battery', displayName: 'RL' });
    const k = await c.req('POST', '/api/keys', { name: 'tiny', scopes: ['activity'], rateLimitPerMinute: 30 });
    const auth = { authorization: `Bearer ${k.json.data.rawKey}`, cookie: '' };
    let last;
    for (let i = 0; i < 31; i++) last = await c.req('GET', '/api/v1/key-info', undefined, auth);
    assert.equal(last!.status, 429);
    assert.equal(last!.json.error.code, 'RATE_LIMITED');
    assert.ok(Number(last!.headers.get('retry-after')) > 0);
  });
});
