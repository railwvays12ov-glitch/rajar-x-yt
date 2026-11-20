import { useCallback, useEffect, useState } from 'react';
import type { JobStatus, JobView } from '@shared/types';
import type { PlatformId } from '@shared/platforms';
import { del, get, post, toApiError, type ApiError } from '../../lib/api';
import { QUALITY_LABEL, formatBytes, shortUrl, timeAgo } from '../../lib/format';
import { usePolling } from '../../lib/hooks';
import { Icon, Spinner } from '../../components/Icon';
import { EmptyState, ErrorCallout, Skeleton, StatusChip } from '../../components/ui';
import { Link } from '../../lib/router';

export const JOBS_CHANGED = 'rajarx:jobs-changed';
export const notifyJobsChanged = () => window.dispatchEvent(new Event(JOBS_CHANGED));

const PLATFORM_GLYPH: Record<string, string> = {
  youtube: 'YT',
  instagram: 'IG',
  tiktok: 'TT',
  x: 'X',
  facebook: 'FB',
  other: '··',
};

export function ActivityList({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<JobView[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [platform, setPlatform] = useState<PlatformId | ''>('');
  const [status, setStatus] = useState<JobStatus | ''>('');
  const [loadingMore, setLoadingMore] = useState(false);
  const limit = compact ? 6 : 15;

  const query = useCallback(
    (c?: string | null) => {
      const p = new URLSearchParams({ limit: String(limit) });
      if (platform) p.set('platform', platform);
      if (status) p.set('status', status);
      if (c) p.set('cursor', c);
      return `/api/jobs?${p}`;
    },
    [limit, platform, status],
  );

  const load = useCallback(async () => {
    try {
      const r = await get<{ items: JobView[]; nextCursor: string | null }>(query());
      setItems(r.items);
      setCursor(r.nextCursor);
      setError(null);
    } catch (e) {
      setError(toApiError(e));
    }
  }, [query]);

  useEffect(() => {
    void load();
    window.addEventListener(JOBS_CHANGED, load);
    return () => window.removeEventListener(JOBS_CHANGED, load);
  }, [load]);

  const running = !!items?.some((j) => j.status === 'queued' || j.status === 'active');
  usePolling(load, 2500, running);

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const r = await get<{ items: JobView[]; nextCursor: string | null }>(query(cursor));
      setItems((prev) => [...(prev ?? []), ...r.items]);
      setCursor(r.nextCursor);
    } catch (e) {
      setError(toApiError(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      notifyJobsChanged();
    } catch (e) {
      setError(toApiError(e));
    }
  };

  return (
    <div>
      {!compact && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            className="field !w-auto"
            aria-label="Filter by platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as PlatformId | '')}
          >
            <option value="">All platforms</option>
            {['youtube', 'instagram', 'tiktok', 'x', 'facebook', 'other'].map((p) => (
              <option key={p} value={p}>
                {p === 'x' ? 'X' : p[0]!.toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
          <select
            className="field !w-auto"
            aria-label="Filter by status"
            value={status}
            onChange={(e) => setStatus(e.target.value as JobStatus | '')}
          >
            <option value="">All statuses</option>
            {['queued', 'active', 'ready', 'completed', 'blocked', 'failed', 'cancelled', 'expired'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="flex-1" />
          {!!items?.length && (
            <button type="button" className="btn-ghost" onClick={() => act(() => del('/api/jobs'))}>
              <Icon name="trash" size={15} /> Clear finished
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-3">
          <ErrorCallout error={error} compact={compact} onRetry={load} />
        </div>
      )}

      {items === null ? (
        <div className="space-y-2">
          {Array.from({ length: compact ? 3 : 5 }, (_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="activity"
          title="No activity yet"
          body="Jobs you start appear here with their status and request ID. Finished files are deleted automatically after the retention window."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((j) => (
            <li key={j.id} className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 transition hover:border-white/15">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-obsidian-900 font-mono text-[10px] font-bold text-ink-muted">
                  {PLATFORM_GLYPH[j.platform]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-sm font-medium text-white" title={j.title ?? undefined}>
                      {j.title ?? shortUrl(j.sourceUrl)}
                    </div>
                    <StatusChip status={j.status} />
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink-dim">
                    <span>{j.format.toUpperCase()}</span>
                    <span>{QUALITY_LABEL[j.quality] ?? j.quality}</span>
                    {j.outputSizeBytes != null && <span>{formatBytes(j.outputSizeBytes)}</span>}
                    <span>{timeAgo(j.createdAt)}</span>
                  </div>
                  {!compact && (
                    <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[11px] text-ink-dim">
                      <span className="truncate">{shortUrl(j.sourceUrl, 56)}</span>
                      <span>req · {j.requestId}</span>
                    </div>
                  )}
                  {(j.status === 'active' || j.status === 'queued') && (
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className="progress-scan h-full rounded-full bg-gradient-to-r from-signal to-cyan transition-all"
                        style={{ width: `${Math.max(4, j.progress * 100)}%` }}
                      />
                    </div>
                  )}
                  {j.errorMessage && (j.status === 'failed' || j.status === 'blocked') && (
                    <p className="mt-1.5 text-xs text-ink-muted">{j.errorMessage}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {j.status === 'ready' && (
                      <a
                        className="btn-primary !min-h-8 !px-3 !py-1 !text-xs"
                        href={`/api/jobs/${j.id}/file`}
                        download
                        onClick={() => window.setTimeout(notifyJobsChanged, 1500)}
                      >
                        <Icon name="download" size={14} /> Save file
                      </a>
                    )}
                    {(j.status === 'queued' || j.status === 'active') && (
                      <button
                        type="button"
                        className="btn-ghost !min-h-8 !px-3 !py-1 !text-xs"
                        onClick={() => act(() => post(`/api/jobs/${j.id}/cancel`))}
                      >
                        <Icon name="stop" size={13} /> Cancel
                      </button>
                    )}
                    {['failed', 'cancelled', 'expired', 'completed'].includes(j.status) && (
                      <button
                        type="button"
                        className="btn-ghost !min-h-8 !px-3 !py-1 !text-xs"
                        onClick={() => act(() => post(`/api/jobs/${j.id}/retry`))}
                      >
                        <Icon name="refresh" size={13} /> Retry
                      </button>
                    )}
                    {!['queued', 'active'].includes(j.status) && (
                      <button
                        type="button"
                        className="btn-ghost !min-h-8 !px-3 !py-1 !text-xs"
                        aria-label="Clear from activity"
                        onClick={() => act(() => del(`/api/jobs/${j.id}`))}
                      >
                        <Icon name="x" size={13} /> Clear
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {compact && items && items.length > 0 && (
        <Link
          href="/activity"
          className="mt-3 flex items-center justify-center gap-1 rounded-lg py-2 text-sm text-signal-bright hover:bg-white/5"
        >
          Full activity <Icon name="chevron" size={15} />
        </Link>
      )}
      {!compact && cursor && (
        <button type="button" className="btn-ghost mt-3 w-full" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? <Spinner /> : null} Load more
        </button>
      )}
    </div>
  );
}
