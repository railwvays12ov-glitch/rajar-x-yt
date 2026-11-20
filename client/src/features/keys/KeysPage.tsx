import { useCallback, useEffect, useState } from 'react';
import { API_SCOPES, DEFAULT_SCOPES, type ApiKeyView, type ApiScope } from '@shared/types';
import { get, post, toApiError, type ApiError } from '../../lib/api';
import { timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import { Link } from '../../lib/router';
import { useSession } from '../../lib/session';
import { Icon, Spinner } from '../../components/Icon';
import { LimitPicker, formatLimit } from '../../components/LimitPicker';
import { CopyButton, EmptyState, ErrorCallout, Modal, SectionTitle, Skeleton } from '../../components/ui';

const SCOPE_INFO: Record<ApiScope, string> = {
  analyze: 'Validate links and read public metadata',
  process: 'Start, cancel and download authorized processing jobs',
  activity: 'Read your job history and job status',
  webhooks: 'Configure signed webhook delivery',
  admin: 'Owner/admin read-only system overview',
};

function RevealPanel({ rawKey, onDone }: { rawKey: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
        This is the only time the full key is shown. RAJAR X stores only a one-way hash — if you lose it, revoke it and create a
        new one.
      </div>
      <div className="rounded-xl border border-signal/40 bg-void p-3">
        <code className="block font-mono text-[13px] break-all text-white select-all" data-testid="raw-key">
          {rawKey}
        </code>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton value={rawKey} label="Copy key" />
        <span className="text-xs text-ink-dim">
          Store it in an environment variable such as RAJAR_X_API_KEY — never in source code.
        </span>
      </div>
      <label className="flex cursor-pointer items-center gap-3 text-sm text-ink">
        <input
          type="checkbox"
          className="h-4 w-4 accent-[#8b5cf6]"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        I saved this key somewhere safe
      </label>
      <button type="button" className="btn-primary w-full" disabled={!saved} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

function CreateKeyForm({ onCreated, isAdmin }: { onCreated: (raw: string) => void; isAdmin: boolean }) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(DEFAULT_SCOPES);
  const [limit, setLimit] = useState<number | null>(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const visibleScopes = API_SCOPES.filter((s) => s !== 'admin' || isAdmin);

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await post<{ key: ApiKeyView; rawKey: string }>('/api/keys', {
            name: name.trim(),
            scopes,
            rateLimitPerMinute: limit,
          });
          onCreated(r.rawKey);
        } catch (err) {
          setError(toApiError(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div>
        <label className="label" htmlFor="key-name">
          Key name
        </label>
        <input
          id="key-name"
          className="field"
          placeholder="e.g. WhatsApp MD bot"
          value={name}
          maxLength={60}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <fieldset>
        <legend className="label">Scopes</legend>
        <div className="space-y-2">
          {visibleScopes.map((s) => (
            <label
              key={s}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-white/[0.07] p-3 hover:border-white/15"
            >
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-[#8b5cf6]"
                checked={scopes.includes(s)}
                onChange={(e) => setScopes((prev) => (e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)))}
              />
              <span>
                <code className="text-sm text-signal-bright">{s}</code>
                <span className="block text-xs text-ink-dim">{SCOPE_INFO[s]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label className="label" htmlFor="key-limit">
          Request limit
        </label>
        <LimitPicker value={limit} onChange={setLimit} admin={isAdmin} />
        {isAdmin && (
          <p className="mt-1 text-xs text-ink-dim">
            Admin: custom and unlimited limits are available. Unlimited keys also skip daily job quotas.
          </p>
        )}
      </div>
      {error && <ErrorCallout error={error} />}
      <button type="submit" className="btn-primary w-full" disabled={busy || !name.trim() || !scopes.length}>
        {busy ? <Spinner /> : <Icon name="key" />} Create key
      </button>
    </form>
  );
}

export function KeysPage() {
  useDocumentTitle('API Keys');
  const { me, loading, isAdmin } = useSession();
  const [keys, setKeys] = useState<ApiKeyView[] | null>(null);
  const [maxKeys, setMaxKeys] = useState(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [modal, setModal] = useState<'closed' | 'create' | { raw: string }>('closed');
  const [confirm, setConfirm] = useState<{ key: ApiKeyView; action: 'revoke' | 'regenerate' } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await get<{ keys: ApiKeyView[]; maxKeys: number }>('/api/keys');
      setKeys(r.keys);
      setMaxKeys(r.maxKeys);
    } catch (e) {
      setError(toApiError(e));
    }
  }, []);

  useEffect(() => {
    if (me?.user) void load();
  }, [me?.user, load]);

  if (loading) return <Skeleton className="h-64" />;
  if (!me?.user) {
    return (
      <div className="mx-auto max-w-xl py-10">
        <EmptyState
          icon="lock"
          title="Sign in to manage API keys"
          body="RAJAR X API keys power your own integrations, WhatsApp MD bots and automation scripts. API features need an account."
          action={
            <Link href="/login" className="btn-primary">
              Sign in
            </Link>
          }
        />
      </div>
    );
  }

  const active = keys?.filter((k) => k.status === 'active').length ?? 0;
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError(toApiError(e));
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="font-mono text-[11px] tracking-[0.2em] text-signal-bright uppercase">RAJAR X API Keys</div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">
            Built for your content, your APIs, your rules.
          </h1>
          <p className="mt-2 max-w-2xl text-ink-muted">
            Generate keys for your own RAJAR X integrations, WhatsApp MD bots, automation scripts and dashboards.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary shrink-0"
          onClick={() => setModal('create')}
          disabled={active >= maxKeys && maxKeys > 0}
        >
          <Icon name="key" /> Create new key
        </button>
      </header>

      <div className="flex gap-3 rounded-2xl border border-cyan/20 bg-cyan/[0.05] p-4 text-sm">
        <span className="text-cyan">
          <Icon name="lock" />
        </span>
        <p className="text-ink-muted">
          <span className="font-semibold text-white">Your API keys are shown once and never stored in plaintext.</span> RAJAR X
          keeps only a keyed SHA-256 hash and a masked prefix. Keys never appear in logs or analytics. Revoke any key instantly if
          it leaks.{' '}
          <Link href="/docs" className="text-signal-bright underline-offset-2 hover:underline">
            API documentation →
          </Link>
        </p>
      </div>

      {error && <ErrorCallout error={error} onRetry={load} />}

      <section className="holo p-4 sm:p-5">
        <SectionTitle title="Your keys" eyebrow={`${active} active · limit ${maxKeys}`} />
        {keys === null ? (
          <div className="space-y-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : keys.length === 0 ? (
          <EmptyState
            icon="key"
            title="No API keys yet"
            body="Create a key with only the scopes your integration needs. Defaults are analyze + activity."
            action={
              <button type="button" className="btn-primary" onClick={() => setModal('create')}>
                Create your first key
              </button>
            }
          />
        ) : (
          <ul className="divide-y divide-white/[0.06]">
            {keys.map((k) => (
              <li
                key={k.id}
                className={`flex flex-col gap-3 py-4 md:flex-row md:items-center ${k.status === 'revoked' ? 'opacity-55' : ''}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-white">{k.name}</span>
                    <span
                      className={`chip !py-0.5 ${k.status === 'active' ? 'border-ok/30 text-ok' : 'border-danger/30 text-danger'}`}
                    >
                      {k.status}
                    </span>
                  </div>
                  <code className="mt-1 block font-mono text-[13px] text-ink-muted">{k.displayPrefix}</code>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {k.scopes.map((s) => (
                      <span key={s} className="rounded-md bg-signal/10 px-1.5 py-0.5 font-mono text-[11px] text-signal-bright">
                        {s}
                      </span>
                    ))}
                    <span className="rounded-md bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">
                      {formatLimit(k.rateLimitPerMinute)}
                    </span>
                  </div>
                  <div className="mt-2 font-mono text-[11px] text-ink-dim">
                    created {timeAgo(k.createdAt)} · last used {timeAgo(k.lastUsedAt)}
                    {k.revokedAt && ` · revoked ${timeAgo(k.revokedAt)}`}
                  </div>
                </div>
                {k.status === 'active' && (
                  <div className="flex gap-2">
                    <button type="button" className="btn-ghost" onClick={() => setConfirm({ key: k, action: 'regenerate' })}>
                      <Icon name="refresh" size={15} /> Regenerate
                    </button>
                    <button type="button" className="btn-danger" onClick={() => setConfirm({ key: k, action: 'revoke' })}>
                      Revoke
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={modal === 'create'} onClose={() => setModal('closed')} title="Create API key">
        <CreateKeyForm isAdmin={isAdmin} onCreated={(raw) => setModal({ raw })} />
      </Modal>
      <Modal
        open={typeof modal === 'object'}
        onClose={() => {
          setModal('closed');
          void load();
        }}
        title="Your new API key"
        dismissible={false}
      >
        {typeof modal === 'object' && (
          <RevealPanel
            rawKey={modal.raw}
            onDone={() => {
              setModal('closed');
              void load();
            }}
          />
        )}
      </Modal>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm?.action === 'regenerate' ? 'Regenerate this key?' : 'Revoke this key?'}
      >
        <p className="text-sm text-ink-muted">
          <span className="font-semibold text-white">{confirm?.key.name}</span> stops working immediately and integrations using
          it will receive <code>API_KEY_REVOKED</code>.
          {confirm?.action === 'regenerate'
            ? ' A new key with the same name, scopes and limit is shown once.'
            : ' This cannot be undone.'}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => setConfirm(null)}>
            Keep key
          </button>
          <button
            type="button"
            className={confirm?.action === 'regenerate' ? 'btn-primary' : 'btn-danger'}
            onClick={() =>
              act(async () => {
                const c = confirm!;
                setConfirm(null);
                if (c.action === 'revoke') await post(`/api/keys/${c.key.id}/revoke`);
                else setModal({ raw: (await post<{ rawKey: string }>(`/api/keys/${c.key.id}/regenerate`)).rawKey });
              })
            }
          >
            {confirm?.action === 'regenerate' ? 'Regenerate key' : 'Revoke key'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
