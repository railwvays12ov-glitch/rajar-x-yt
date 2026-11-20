import { useEffect, useState } from 'react';
import { WEBHOOK_EVENTS, type WebhookEvent } from '@shared/types';
import { get, put, toApiError, type ApiError } from '../../lib/api';
import { useDocumentTitle } from '../../lib/hooks';
import { Link } from '../../lib/router';
import { useSession } from '../../lib/session';
import { Icon, Spinner } from '../../components/Icon';
import { CopyButton, EmptyState, ErrorCallout, SectionTitle } from '../../components/ui';

function WebhookSettings() {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['job.ready', 'job.failed', 'job.blocked']);
  const [hasSecret, setHasSecret] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    get<{ url: string | null; events: WebhookEvent[]; hasSecret: boolean }>('/api/settings/webhook')
      .then((w) => {
        setUrl(w.url ?? '');
        if (w.events.length) setEvents(w.events);
        setHasSecret(w.hasSecret);
      })
      .catch((e) => setError(toApiError(e)));
  }, []);

  const save = async (rotateSecret = false) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await put<{ url: string | null; secret: string | null }>('/api/settings/webhook', {
        url: url.trim() || null,
        events,
        rotateSecret,
      });
      if (r.secret) {
        setSecret(r.secret);
        setHasSecret(true);
      }
      setSaved(true);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="holo p-5">
      <SectionTitle eyebrow="Integrations" title="Webhooks" />
      <p className="mb-4 text-sm text-ink-muted">
        Receive signed POST requests when your jobs change state. HTTPS on port 443 only; private and internal addresses are
        refused.
      </p>
      <label className="label" htmlFor="wh-url">
        Endpoint URL
      </label>
      <input
        id="wh-url"
        className="field"
        type="url"
        placeholder="https://your-app.example.com/rajar-webhook"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <fieldset className="mt-4">
        <legend className="label">Events</legend>
        <div className="flex flex-wrap gap-2">
          {WEBHOOK_EVENTS.map((ev) => (
            <label
              key={ev}
              className={`chip cursor-pointer ${events.includes(ev) ? 'border-signal/50 bg-signal/15 text-white' : 'border-white/10 text-ink-dim'}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={events.includes(ev)}
                onChange={(e) => setEvents((p) => (e.target.checked ? [...p, ev] : p.filter((x) => x !== ev)))}
              />
              {ev}
            </label>
          ))}
        </div>
      </fieldset>
      {secret && (
        <div className="mt-4 rounded-xl border border-warn/40 bg-warn/10 p-3">
          <p className="text-sm text-warn">Signing secret — shown once. Store it with your receiver.</p>
          <code className="mt-2 block font-mono text-[13px] break-all text-white">{secret}</code>
          <div className="mt-2">
            <CopyButton value={secret} label="Copy secret" />
          </div>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <ErrorCallout error={error} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" onClick={() => save(false)} disabled={busy}>
          {busy ? <Spinner /> : <Icon name="check" />} Save webhook
        </button>
        {hasSecret && url && (
          <button type="button" className="btn-ghost" onClick={() => save(true)} disabled={busy}>
            <Icon name="refresh" size={15} /> Rotate secret
          </button>
        )}
        {saved && <span className="text-sm text-ok">Saved</span>}
      </div>
    </section>
  );
}

export function SettingsPage() {
  useDocumentTitle('Settings');
  const { me, logout } = useSession();
  if (!me?.user) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <EmptyState
          icon="settings"
          title="Sign in to manage settings"
          body="Profile, sessions, quotas and webhooks are available to signed-in accounts."
          action={
            <Link href="/login" className="btn-primary">
              Sign in
            </Link>
          }
        />
      </div>
    );
  }
  const q = me.quota;
  return (
    <div className="space-y-6">
      <header>
        <div className="font-mono text-[11px] tracking-[0.2em] text-signal-bright uppercase">Account</div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">Settings</h1>
      </header>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="holo p-5">
          <SectionTitle eyebrow="Profile" title={me.user.displayName} />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            <dt className="text-ink-dim">Email</dt>
            <dd className="text-ink">{me.user.email}</dd>
            <dt className="text-ink-dim">Role</dt>
            <dd className="text-ink capitalize">{me.user.role}</dd>
            <dt className="text-ink-dim">Member since</dt>
            <dd className="text-ink">{new Date(me.user.createdAt).toLocaleDateString()}</dd>
          </dl>
          <div className="mt-5 border-t border-white/[0.06] pt-4">
            <div className="label">Session</div>
            <p className="mb-3 text-sm text-ink-muted">
              Sessions use secure, HTTP-only cookies and expire automatically. Signing out invalidates this session on the server.
            </p>
            <button type="button" className="btn-ghost" onClick={() => void logout()}>
              <Icon name="logout" size={16} /> Sign out
            </button>
          </div>
        </section>
        <section className="holo p-5">
          <SectionTitle eyebrow="Usage" title="Quotas & limits" />
          <div className="space-y-4">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-ink-muted">Jobs in the last 24 h</span>
                <span className="font-mono text-ink">
                  {q.usedToday} / {q.dailyJobs}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-signal to-cyan"
                  style={{ width: `${Math.min(100, (q.usedToday / Math.max(1, q.dailyJobs)) * 100)}%` }}
                />
              </div>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-ink-dim">Concurrent jobs</dt>
              <dd className="font-mono text-ink">{q.maxActiveJobs}</dd>
              <dt className="text-ink-dim">API keys</dt>
              <dd className="font-mono text-ink">up to {q.maxApiKeys}</dd>
            </dl>
          </div>
        </section>
      </div>
      <WebhookSettings />
    </div>
  );
}
