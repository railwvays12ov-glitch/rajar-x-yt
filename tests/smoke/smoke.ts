/**
 * Production smoke test. Usage: BASE_URL=https://rajarx.example.com npm run test:smoke
 * Checks health/readiness/version endpoints and that the SPA serves the home and docs pages.
 */
const base = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');

interface Check {
  name: string;
  path: string;
  expectStatus: number;
  verify: (body: string, res: Response) => string | null;
}

const json = (body: string) => JSON.parse(body) as { success: boolean; requestId: string; data: Record<string, unknown> };

const checks: Check[] = [
  {
    name: 'health',
    path: '/api/health',
    expectStatus: 200,
    verify: (b) => {
      const j = json(b);
      if (!j.success || !/^req_/.test(j.requestId)) return 'bad envelope';
      const c = j.data.components as Record<string, { status: string }>;
      const down = Object.entries(c)
        .filter(([, v]) => v.status === 'down')
        .map(([k]) => k);
      return down.length ? `components down: ${down.join(', ')}` : null;
    },
  },
  { name: 'ready', path: '/api/ready', expectStatus: 200, verify: (b) => (json(b).data.ready === true ? null : 'not ready') },
  {
    name: 'version',
    path: '/api/version',
    expectStatus: 200,
    verify: (b) => (json(b).data.name === 'RAJAR X YT' ? null : 'wrong name'),
  },
  {
    name: 'home page',
    path: '/',
    expectStatus: 200,
    verify: (b, r) =>
      !r.headers.get('content-type')?.includes('text/html')
        ? 'not html'
        : !b.includes('<div id="root">')
          ? 'missing app root'
          : b.includes('__PUBLIC_BASE_URL__')
            ? 'base URL placeholder not replaced'
            : !r.headers.get('content-security-policy')
              ? 'missing CSP header'
              : null,
  },
  {
    name: 'docs page',
    path: '/docs',
    expectStatus: 200,
    verify: (b) => (b.includes('<div id="root">') ? null : 'missing app root'),
  },
  {
    name: 'robots.txt',
    path: '/robots.txt',
    expectStatus: 200,
    verify: (b) => (b.includes('Sitemap:') ? null : 'no sitemap line'),
  },
  {
    name: 'api 404 envelope',
    path: '/api/__smoke__',
    expectStatus: 404,
    verify: (b) => (json(b).success === false ? null : 'bad envelope'),
  },
];

let failed = 0;
for (const c of checks) {
  try {
    const res = await fetch(base + c.path, { signal: AbortSignal.timeout(10_000) });
    const body = await res.text();
    const problem = res.status !== c.expectStatus ? `HTTP ${res.status}` : c.verify(body, res);
    console.log(`${problem ? '✗' : '✓'} ${c.name.padEnd(18)} ${problem ?? ''}`);
    if (problem) failed++;
  } catch (err) {
    failed++;
    console.log(`✗ ${c.name.padEnd(18)} ${(err as Error).message}`);
  }
}
console.log(failed ? `\n${failed} smoke check(s) failed against ${base}` : `\nAll smoke checks passed against ${base}`);
process.exit(failed ? 1 : 0);
