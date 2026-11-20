import type { ComponentHealth } from '@shared/types';
import { useSession } from '../../lib/session';

export function StatusIndicator({ compact = false }: { compact?: boolean }) {
  const { status } = useSession();
  const s = status?.status ?? 'unknown';
  const map = {
    operational: { label: 'All systems go', dot: 'bg-ok', ring: 'shadow-[0_0_12px_rgba(52,245,164,.8)]', text: 'text-ok' },
    degraded: { label: 'Setup needed', dot: 'bg-warn', ring: 'shadow-[0_0_12px_rgba(255,194,75,.8)]', text: 'text-warn' },
    maintenance: { label: 'Maintenance', dot: 'bg-warn', ring: 'shadow-[0_0_12px_rgba(255,194,75,.8)]', text: 'text-warn' },
    unknown: { label: 'Connecting…', dot: 'bg-ink-dim animate-pulse', ring: '', text: 'text-ink-dim' },
  }[s];
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5"
      role="status"
      aria-label={`System status: ${map.label}`}
    >
      <span className={`h-2 w-2 rounded-full ${map.dot} ${map.ring}`} />
      {!compact && <span className={`font-mono text-[11px] tracking-wider uppercase ${map.text}`}>{map.label}</span>}
    </span>
  );
}

const LABELS: Record<string, string> = {
  ytdlp: 'yt-dlp engine',
  ffmpeg: 'FFmpeg',
  database: 'Database',
  redis: 'Queue / Redis',
  storage: 'Temp storage',
};

export function ComponentList({ components }: { components: Record<string, ComponentHealth> }) {
  return (
    <ul className="space-y-1.5">
      {Object.entries(components).map(([k, c]) => (
        <li key={k} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.02] px-3 py-2 text-sm">
          <span className="text-ink-muted">{LABELS[k] ?? k}</span>
          <span className="flex items-center gap-2 font-mono text-[11px]">
            {c.version && <span className="text-ink-dim">{c.version}</span>}
            <span
              className={`chip !py-0.5 ${
                c.status === 'up'
                  ? 'border-ok/30 text-ok'
                  : c.status === 'down'
                    ? 'border-danger/40 text-danger'
                    : 'border-white/10 text-ink-dim'
              }`}
            >
              {c.status}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
