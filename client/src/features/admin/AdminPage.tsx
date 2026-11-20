import { useCallback, useEffect, useState } from 'react';
import type { ApiKeyView, ComponentHealth } from '@shared/types';
import { get, post, put, toApiError, type ApiError } from '../../lib/api';
import { formatBytes, timeAgo } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import { useSession } from '../../lib/session';
import { Icon, Spinner } from '../../components/Icon';
import { ComponentList } from '../../components/layout/StatusIndicator';
import { LimitPicker, formatLimit } from '../../components/LimitPicker';
import { EmptyState, ErrorCallout, SectionTitle, Skeleton, Toggle } from '../../components/ui';

interface Overview {
  totals: Record<string, number | null>;
  storage: { usedBytes: number; maxBytes: number };
  components: Record<string, ComponentHealth>;
  queue: { driver: string; pending: number; active: number; concurrency: number };
  settings: {
    processingEnabled: boolean;
    maxFileSizeBytes: number;
    maxDurationSeconds: number;
    envMaxFileSizeBytes: number;
    envMaxDurationSeconds: number;
  };
}
interface LogEntry {
  ts: string;
  level: string;
  msg: string;
  [k: string]: unknown;
}

const STAT_LABELS: [string, string][] = [
  ['users', 'Total users'],
  ['activeKeys', 'Active API keys'],
  ['revokedKeys', 'Revoked keys'],
  ['jobsToday', 'Jobs today'],
  ['failedJobsToday', 'Failed jobs'],
  ['blockedJobsToday', 'Blocked (policy)'],
  ['rateLimitEventsToday', 'Rate-limit events'],
  ['avgProcessingMs', 'Avg processing'],
];

/** Inline per-key limit control: custom number or unlimited. */
function KeyLimitEditor({
  keyId,
  value,
  onSaved,
  onError,
}: {
  keyId: string;
  value: number | null;
  onSaved: () => Promise<void>;
  onError: (e: ApiError) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<number | null>(value);
  const [saving, setSaving] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        className={`chip !py-0.5 ${value === null ? 'border-magenta/50 text-magenta' : 'border-white/15 text-ink'} hover:border-signal/60`}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title="Change limit"
      >
        {formatLimit(value)} · edit
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 py-1">
      <LimitPicker value={draft} onChange={setDraft} admin id={`limit-${keyId}`} />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary !min-h-8 !px-3 !py-1 !text-xs"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await put(`/api/admin/keys/${keyId}/limit`, { rateLimitPerMinute: draft });
              setEditing(false);
              await onSaved();
            } catch (e) {
              onError(toApiError(e));
            } finally {
              setSaving(false);
            }
          }}
        >
          Save
        </button>
        <button type="button" className="btn-ghost !min-h-8 !px-3 !py-1 !text-xs" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function AdminPage() {
  useDocumentTitle('Admin');
  const { isAdmin, refreshStatus } = useSession();
  const [o, setO] = useState<Overview | null>(null);
  const [keys, setKeys] = useState<(ApiKeyView & { ownerEmail: string | null })[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [level, setLevel] = useState('');
  const [error, setError] = useState<ApiError | null>(null);
  const [reqId, setReqId] = useState('');
  const [inspect, setInspect] = useState<unknown>(null);
  const [limits, setLimits] = useState({ mb: '', minutes: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ov, k, l] = await Promise.all([
        get<Overview>('/api/admin/overview'),
        get<{ keys: (ApiKeyView & { ownerEmail: string | null })[] }>('/api/admin/keys'),
        get<{ entries: LogEntry[] }>(`/api/admin/logs${level ? `?level=${level}` : ''}`),
      ]);
      setO(ov);
      setKeys(k.keys);
      setLogs(l.entries);
      setLimits({
        mb: String(Math.round(ov.settings.maxFileSizeBytes / 1048576)),
        minutes: String(Math.round(ov.settings.maxDurationSeconds / 60)),
      });
    } catch (e) {
      setError(toApiError(e));
    }
  }, [level]);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  if (!isAdmin)
    return <EmptyState icon="lock" title="Admin only" body="This control center is available to owner and admin accounts." />;

  const updateSettings = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await put('/api/admin/settings', body);
      await Promise.all([load(), refreshStatus()]);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[11px] tracking-[0.2em] text-magenta uppercase">Owner / admin</div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-white">Control center</h1>
        </div>
        <button type="button" className="btn-ghost" onClick={load}>
          <Icon name="refresh" size={15} /> Refresh
        </button>
      </header>
      {error && <ErrorCallout error={error} onRetry={load} />}
      {!o ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {STAT_LABELS.map(([k, label]) => (
              <div key={k} className="holo holo-quiet p-4">
                <div className="font-mono text-[11px] tracking-wider text-ink-dim uppercase">{label}</div>
                <div className="mt-1 font-display text-2xl font-bold text-white">
                  {k === 'avgProcessingMs'
                    ? o.totals[k] != null
                      ? `${((o.totals[k] as number) / 1000).toFixed(1)}s`
                      : '—'
                    : (o.totals[k] ?? 0)}
                </div>
              </div>
            ))}
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="holo p-5">
              <SectionTitle eyebrow="Health" title="Components" />
              <ComponentList components={o.components} />
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 font-mono text-[12px]">
                <dt className="text-ink-dim">Queue</dt>
                <dd className="text-ink">
                  {o.queue.driver} · {o.queue.active}/{o.queue.concurrency} active · {o.queue.pending} pending
                </dd>
                <dt className="text-ink-dim">Temp storage</dt>
                <dd className="text-ink">
                  {formatBytes(o.storage.usedBytes)} of {formatBytes(o.storage.maxBytes)}
                </dd>
              </dl>
            </section>

            <section className="holo p-5">
              <SectionTitle eyebrow="Controls" title="Processing policy" />
              <Toggle
                checked={o.settings.processingEnabled}
                disabled={busy}
                onChange={(v) => updateSettings({ processingEnabled: v })}
                label="Processing enabled"
                hint="Turn off to pause all new processing (maintenance mode). Analysis keeps working."
              />
              <form
                className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  void updateSettings({
                    maxFileSizeBytes: Math.round(Number(limits.mb) * 1048576),
                    maxDurationSeconds: Math.round(Number(limits.minutes) * 60),
                  });
                }}
              >
                <div>
                  <label className="label" htmlFor="mb">
                    Max file size (MB)
                  </label>
                  <input
                    id="mb"
                    className="field"
                    inputMode="numeric"
                    value={limits.mb}
                    onChange={(e) => setLimits((p) => ({ ...p, mb: e.target.value.replace(/\D/g, '') }))}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="min">
                    Max duration (min)
                  </label>
                  <input
                    id="min"
                    className="field"
                    inputMode="numeric"
                    value={limits.minutes}
                    onChange={(e) => setLimits((p) => ({ ...p, minutes: e.target.value.replace(/\D/g, '') }))}
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? <Spinner /> : null} Apply
                </button>
              </form>
              <button
                type="button"
                className="mt-2 text-xs text-ink-dim underline"
                onClick={() => updateSettings({ maxFileSizeBytes: null, maxDurationSeconds: null })}
              >
                Reset to environment defaults ({formatBytes(o.settings.envMaxFileSizeBytes)} ·{' '}
                {Math.round(o.settings.envMaxDurationSeconds / 60)} min)
              </button>
            </section>
          </div>

          <section className="holo p-5">
            <SectionTitle eyebrow="Abuse control" title="API keys" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left text-sm [&_td]:px-2 [&_td]:align-middle [&_th]:px-2">
                <thead className="font-mono text-[11px] tracking-wider text-ink-dim uppercase">
                  <tr>
                    <th className="py-2">Key</th>
                    <th>Owner</th>
                    <th>Scopes</th>
                    <th>Request limit</th>
                    <th>Last used</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className="border-t border-white/[0.06]">
                      <td className="py-2">
                        <div className="text-white">{k.name}</div>
                        <code className="text-xs text-ink-dim">{k.displayPrefix}</code>
                      </td>
                      <td className="text-ink-muted">{k.ownerEmail}</td>
                      <td className="font-mono text-xs text-signal-bright">{k.scopes.join(', ')}</td>
                      <td className="py-2">
                        {k.status === 'active' ? (
                          <KeyLimitEditor keyId={k.id} value={k.rateLimitPerMinute} onSaved={load} onError={setError} />
                        ) : (
                          <span className="text-ink-dim">—</span>
                        )}
                      </td>
                      <td className="text-ink-dim">{timeAgo(k.lastUsedAt)}</td>
                      <td className="text-right">
                        {k.status === 'active' ? (
                          <button
                            type="button"
                            className="btn-danger !min-h-8 !px-2.5 !py-1 !text-xs"
                            onClick={async () => {
                              try {
                                await post(`/api/admin/keys/${k.id}/revoke`);
                                await load();
                              } catch (e) {
                                setError(toApiError(e));
                              }
                            }}
                          >
                            Revoke
                          </button>
                        ) : (
                          <span className="font-mono text-xs text-danger">revoked</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="holo p-5">
              <SectionTitle eyebrow="Tracing" title="Inspect a request ID" />
              <form
                className="flex gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    setInspect(await get(`/api/admin/requests/${encodeURIComponent(reqId.trim())}`));
                  } catch (err) {
                    setError(toApiError(err));
                  }
                }}
              >
                <input
                  className="field"
                  placeholder="req_…"
                  value={reqId}
                  onChange={(e) => setReqId(e.target.value)}
                  aria-label="Request ID"
                />
                <button type="submit" className="btn-primary">
                  Inspect
                </button>
              </form>
              {inspect != null && (
                <pre className="mt-3 max-h-72 overflow-auto rounded-xl bg-void p-3 text-[11px] text-ink-muted">
                  {JSON.stringify(inspect, null, 2)}
                </pre>
              )}
            </section>

            <section className="holo p-5">
              <SectionTitle
                eyebrow="Redacted"
                title="System logs"
                action={
                  <select
                    className="field !w-auto !min-h-9 !py-1"
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    aria-label="Log level"
                  >
                    <option value="">all</option>
                    <option value="info">info+</option>
                    <option value="warn">warn+</option>
                    <option value="error">error</option>
                  </select>
                }
              />
              <p className="mb-2 text-xs text-ink-dim">
                Secrets, tokens, cookies and API keys are redacted before anything is logged.
              </p>
              <pre className="max-h-72 overflow-auto rounded-xl bg-void p-3 text-[11px] leading-relaxed text-ink-muted">
                {logs.map((l) => `${l.ts.slice(11, 19)} ${l.level.toUpperCase().padEnd(5)} ${l.msg}`).join('\n') || 'No entries.'}
              </pre>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
