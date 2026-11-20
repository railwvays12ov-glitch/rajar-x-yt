import type { PlatformId } from '@shared/platforms';
import { useSession } from '../../lib/session';
import { Tilt } from '../../components/ui';

const ACCENT: Record<PlatformId, string> = {
  youtube: 'from-signal/40 to-magenta/20',
  instagram: 'from-magenta/35 to-signal/20',
  tiktok: 'from-cyan/35 to-magenta/20',
  x: 'from-white/25 to-signal/15',
  facebook: 'from-signal/35 to-cyan/20',
  other: 'from-white/15 to-white/5',
};

export function PlatformGrid({ active }: { active: PlatformId | null }) {
  const { status } = useSession();
  const platforms = status?.platforms ?? [];
  return (
    <section aria-labelledby="platforms-title">
      <div className="mb-3 flex items-end justify-between">
        <div>
          <div className="font-mono text-[11px] tracking-[0.2em] text-signal-bright uppercase">Signal map</div>
          <h2 id="platforms-title" className="font-display text-lg font-semibold text-white">
            Supported sources
          </h2>
        </div>
        <span className="hidden font-mono text-[11px] text-ink-dim sm:block">Public content only · abstract badges</span>
      </div>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {(platforms.length ? platforms : Array.from({ length: 6 }, () => null)).map((p, i) => (
          <li key={p?.id ?? i}>
            {p ? (
              <Tilt>
                <div
                  className={`holo holo-quiet h-full p-3.5 transition ${active === p.id ? 'shadow-[0_0_0_1px_rgba(34,225,255,.6),0_0_40px_-10px_rgba(34,225,255,.6)]' : ''} ${p.enabled ? '' : 'opacity-60'}`}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${ACCENT[p.id]} font-mono text-[11px] font-bold text-white`}
                    >
                      {p.glyph}
                    </span>
                    <span className={`chip !py-0.5 ${p.enabled ? 'border-ok/30 text-ok' : 'border-white/15 text-ink-dim'}`}>
                      {p.enabled ? 'online' : 'unavailable'}
                    </span>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-white">{p.name}</div>
                  <div className="mt-0.5 text-xs text-ink-dim">
                    {p.enabled
                      ? p.scope
                      : p.id === 'other'
                        ? 'Not enabled by this operator'
                        : 'Temporarily unavailable on this server'}
                  </div>
                  <div className="mt-2 font-mono text-[10px] tracking-wider text-cyan/80 uppercase">Public content only</div>
                </div>
              </Tilt>
            ) : (
              <div className="h-[124px] rounded-[1.25rem] shimmer" />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
