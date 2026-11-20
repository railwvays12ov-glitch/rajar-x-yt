import { useState } from 'react';
import { ERROR_CATALOG, ERROR_CODES } from '@shared/errors';
import { WEBHOOK_EVENTS } from '@shared/types';
import { useDocumentTitle } from '../../lib/hooks';
import { CopyButton } from '../../components/ui';
import { snippets } from './snippets';

function Code({ code, lang }: { code: string; lang: string }) {
  return (
    <div className="my-3 overflow-hidden rounded-xl border border-white/[0.08] bg-void">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-3 py-1.5">
        <span className="font-mono text-[11px] tracking-wider text-ink-dim uppercase">{lang}</span>
        <CopyButton value={code} />
      </div>
      <pre className="overflow-x-auto p-4 text-[12.5px] leading-relaxed text-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function Tabs({ tabs }: { tabs: { id: string; label: string; code: string }[] }) {
  const [active, setActive] = useState(tabs[0]!.id);
  const t = tabs.find((x) => x.id === active)!;
  return (
    <div>
      <div role="tablist" className="flex gap-1 overflow-x-auto">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            type="button"
            aria-selected={x.id === active}
            onClick={() => setActive(x.id)}
            className={`rounded-lg px-3 py-1.5 font-mono text-xs ${x.id === active ? 'bg-signal/20 text-white' : 'text-ink-dim hover:text-ink'}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <Code code={t.code} lang={t.label} />
    </div>
  );
}

const ENDPOINTS: [string, string, string, string][] = [
  [
    'POST',
    '/api/v1/analyze',
    'analyze',
    'Validate a public URL and return metadata, formats and safe-use status. Never downloads.',
  ],
  ['GET', '/api/v1/analyze?url=…', 'analyze', 'Same as above, for link-style clients.'],
  ['POST', '/api/v1/process', 'process', 'Queue an authorized processing job. Requires "rightsConfirmed": true.'],
  ['GET', '/api/v1/jobs/:id', 'process | activity', 'Job status, progress, error code and output details.'],
  ['POST', '/api/v1/jobs/:id/cancel', 'process', 'Cancel a queued or active job.'],
  ['GET', '/api/v1/jobs/:id/file', 'process', 'One-time download: the file is deleted from the server once fully sent.'],
  ['GET', '/api/v1/activity', 'activity', 'Paginated job history. Query: platform, status, limit (≤50), cursor.'],
  ['GET', '/api/v1/key-info', 'any', 'Name, masked prefix, scopes and limits of the calling key.'],
  ['GET / PUT', '/api/v1/webhook', 'webhooks', 'Read or set your webhook URL and subscribed events.'],
  ['GET', '/api/v1/admin/overview', 'admin', 'Owner/admin system overview (only if the operator enables admin scope).'],
];

const TOC = [
  ['auth', 'Authentication'],
  ['scopes', 'Key scopes'],
  ['limits', 'Rate limits'],
  ['endpoints', 'Endpoints'],
  ['examples', 'Examples'],
  ['responses', 'Responses'],
  ['errors', 'Error codes'],
  ['webhooks', 'Webhook events'],
  ['whatsapp', 'WhatsApp MD bots'],
] as const;

export function DocsPage() {
  useDocumentTitle(
    'API Documentation',
    'Authenticate with rjar_live_ API keys, analyze public links and run authorized processing jobs.',
  );
  const base = window.location.origin;
  const s = snippets(base);

  return (
    <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav className="hidden lg:block" aria-label="Documentation sections">
        <div className="sticky top-24 space-y-1">
          {TOC.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="block rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:bg-white/5 hover:text-white"
            >
              {label}
            </a>
          ))}
        </div>
      </nav>

      <article className="prose-doc min-w-0">
        <div className="font-mono text-[11px] tracking-[0.2em] text-signal-bright uppercase">Developer docs · v1</div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">RAJAR X API</h1>
        <p className="mt-2 max-w-2xl">
          The same validation, restrictions and safe-use policy as the dashboard — for your own integrations. Analyze first.
          Process only what you’re allowed to use.
        </p>

        <h2 id="auth">Authentication</h2>
        <p>
          Create a key in <strong className="text-white">API Keys</strong>. Send it on every request as a bearer token. Keys start
          with <code>rjar_live_</code>, are shown once, and only a hash is stored.
        </p>
        <Code lang="http" code={`Authorization: Bearer $RAJAR_X_API_KEY`} />
        <p>
          For simple clients and direct links you can also pass the key as a URL parameter: <code>?key=rjar_live_…</code> (or{' '}
          <code>?api_key=</code>). The server strips it from the request and redacts it from logs, but URLs can still end up in
          browser history, chat previews and third-party proxies — prefer the header whenever you can, and never share a link that
          contains your key.
        </p>
        <Code
          lang="url"
          code={`${base}/api/v1/analyze?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DVIDEO_ID&key=$RAJAR_X_API_KEY\n${base}/api/v1/jobs/JOB_ID/file?key=$RAJAR_X_API_KEY`}
        />
        <p>
          Never commit keys, paste them in screenshots, or put them in client-side code. Load them from an environment variable
          such as <code>RAJAR_X_API_KEY</code>. Browser cookies never authenticate <code>/api/v1</code>.
        </p>

        <h2 id="scopes">Key scopes</h2>
        <ul>
          <li>
            <code>analyze</code> — validate links and read public metadata (default)
          </li>
          <li>
            <code>activity</code> — read job history and job status (default)
          </li>
          <li>
            <code>process</code> — create, cancel and download authorized processing jobs
          </li>
          <li>
            <code>webhooks</code> — configure signed webhook delivery
          </li>
          <li>
            <code>admin</code> — owner/admin only, and only when the operator enables it. Never granted to normal users.
          </li>
        </ul>

        <h2 id="limits">Rate limits</h2>
        <p>
          Each key has its own per-minute limit (30, 60, 120 or 300) chosen at creation. Admins can set any custom limit on any
          key, or make a key <strong className="text-white">unlimited</strong> — unlimited keys skip the per-key, per-IP media and
          daily job limits (jobs still wait in the server queue when all workers are busy). Media endpoints also share a per-IP
          limit set by the operator, and processing is bounded by per-account daily quotas and concurrent-job limits. Limited
          responses return HTTP 429, <code>RATE_LIMITED</code> or <code>QUOTA_EXCEEDED</code>, and a <code>Retry-After</code>{' '}
          header. Back off exponentially.
        </p>

        <h2 id="endpoints">Endpoints</h2>
        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-white/[0.03] font-mono text-[11px] tracking-wider text-ink-dim uppercase">
              <tr>
                <th className="px-3 py-2">Method</th>
                <th className="px-3 py-2">Path</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Purpose</th>
              </tr>
            </thead>
            <tbody>
              {ENDPOINTS.map(([m, p, sc, d]) => (
                <tr key={p + m} className="border-t border-white/[0.06]">
                  <td className="px-3 py-2 font-mono text-xs text-cyan">{m}</td>
                  <td className="px-3 py-2 font-mono text-xs text-white">{p}</td>
                  <td className="px-3 py-2 font-mono text-xs text-signal-bright">{sc}</td>
                  <td className="px-3 py-2 text-ink-muted">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>Process options</h3>
        <p>
          <code>mediaType</code>: video | audio | thumbnail · <code>container</code>: mp4 | webm · <code>audioFormat</code>: mp3 |
          m4a | wav · <code>quality</code>: best | 2160 | 1440 | 1080 | 720 | 480 · <code>audioMode</code>: original | highest |
          normalized · <code>audioBitrate</code>: auto | 128 | 192 | 256 | 320 · <code>embedMetadata</code>,{' '}
          <code>embedThumbnail</code>: boolean · <code>subtitleLang</code>: an uploader-published language from analysis, or null.
        </p>

        <h2 id="examples">Request examples</h2>
        <Tabs
          tabs={[
            { id: 'curl-a', label: 'cURL · analyze', code: s.curlAnalyze },
            { id: 'curl-p', label: 'cURL · process', code: s.curlProcess },
            { id: 'js', label: 'JavaScript', code: s.js },
            { id: 'py', label: 'Python', code: s.python },
          ]}
        />

        <h2 id="responses">Response format</h2>
        <p>
          Every response uses the same envelope. Log the <code>requestId</code> — support and admins can trace a request with it.
        </p>
        <div className="grid gap-3 xl:grid-cols-2">
          <Code lang="json · success" code={s.success} />
          <Code lang="json · error" code={s.failure} />
        </div>

        <h2 id="errors">Error codes</h2>
        <p>Codes are stable and machine-readable. Messages are written for humans and never include internal details.</p>
        <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-white/[0.03] font-mono text-[11px] tracking-wider text-ink-dim uppercase">
              <tr>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">HTTP</th>
                <th className="px-3 py-2">Meaning · next action</th>
              </tr>
            </thead>
            <tbody>
              {ERROR_CODES.map((c) => (
                <tr key={c} className="border-t border-white/[0.06] align-top">
                  <td className="px-3 py-2 font-mono text-xs text-white">{c}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink-dim">{ERROR_CATALOG[c].status}</td>
                  <td className="px-3 py-2 text-ink-muted">
                    {ERROR_CATALOG[c].message} <span className="text-ink-dim">{ERROR_CATALOG[c].nextAction}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 id="webhooks">Webhook events</h2>
        <p>
          Configure an HTTPS endpoint in Settings (or <code>PUT /api/v1/webhook</code>). Events:{' '}
          {WEBHOOK_EVENTS.map((e, i) => (
            <span key={e}>
              {i ? ', ' : ''}
              <code>{e}</code>
            </span>
          ))}
          . Each delivery is a JSON POST signed with your webhook secret (shown once) in the <code>X-RajarX-Signature</code>{' '}
          header. Deliveries time out after 5 s and retry up to 3 times. Private or internal addresses are refused.
        </p>
        <Code lang="javascript · verify signature" code={s.webhookVerify} />

        <h2 id="whatsapp">WhatsApp MD bot integration</h2>
        <p>
          Authorized bots can call the API with a key loaded from <code>RAJAR_X_API_KEY</code>. The reference bot checks sender
          permissions against an allow-list, applies cooldowns, uses timeouts with exponential backoff, validates every response,
          enforces a file-size cap, includes a safe-use notice in replies, and logs request IDs — never keys. It does not
          auto-process links from unknown users and contains no mass-messaging features.
        </p>
        <Code lang="javascript" code={s.whatsapp} />
      </article>
    </div>
  );
}
