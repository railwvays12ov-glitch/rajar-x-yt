import type { AnalysisResult } from '@shared/types';
import { formatBytes, formatDuration } from '../../lib/format';
import { Icon } from '../../components/Icon';

export function MediaPreview({ a }: { a: AnalysisResult }) {
  const best = a.estimatedSizes.best;
  return (
    <article className="holo overflow-hidden animate-rise" aria-label="Media details">
      <div className="grid gap-0 sm:grid-cols-[240px_minmax(0,1fr)]">
        <div className="relative aspect-video bg-obsidian-900 sm:aspect-auto sm:h-full">
          {a.thumbnailUrl ? (
            <img
              src={a.thumbnailUrl}
              alt=""
              referrerPolicy="no-referrer"
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-ink-dim">
              <Icon name="image" size={28} />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-obsidian-950/80 via-transparent to-transparent" />
          {a.durationSeconds != null && (
            <span className="absolute right-2 bottom-2 rounded-md bg-void/80 px-1.5 py-0.5 font-mono text-[11px] text-white">
              {formatDuration(a.durationSeconds)}
            </span>
          )}
        </div>
        <div className="min-w-0 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip border-signal/40 bg-signal/10 text-signal-bright">{a.platformName}</span>
            <span className="chip border-ok/30 bg-ok/10 text-ok">
              <Icon name="shield" size={12} /> Policy check passed
            </span>
          </div>
          <h3 className="mt-2 line-clamp-2 font-display text-lg leading-snug font-semibold text-white">{a.title}</h3>
          {a.uploader && <p className="mt-0.5 truncate text-sm text-ink-muted">{a.uploader}</p>}
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 font-mono text-[12px] sm:grid-cols-4">
            <div>
              <dt className="text-ink-dim">Duration</dt>
              <dd className="text-ink">{formatDuration(a.durationSeconds)}</dd>
            </div>
            <div>
              <dt className="text-ink-dim">Top quality</dt>
              <dd className="text-ink">{a.availableHeights[0] ? `${a.availableHeights[0]}p` : a.hasAudio ? 'Audio' : '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-dim">Streams</dt>
              <dd className="text-ink">
                {a.hasVideo ? 'Video' : ''}
                {a.hasVideo && a.hasAudio ? ' + ' : ''}
                {a.hasAudio ? 'Audio' : ''}
              </dd>
            </div>
            <div>
              <dt className="text-ink-dim">Approx. size</dt>
              <dd className="text-ink">{best ? `~${formatBytes(best)}` : 'Unknown'}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-dim">{a.safeUse.notice}</p>
        </div>
      </div>
    </article>
  );
}
