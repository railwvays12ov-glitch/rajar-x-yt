import type { PlatformId } from '@shared/platforms';
import { Emblem } from '../brand/Logo';

const NODES: { id: PlatformId; glyph: string; angle: number }[] = [
  { id: 'youtube', glyph: 'YT', angle: -90 },
  { id: 'instagram', glyph: 'IG', angle: -18 },
  { id: 'tiktok', glyph: 'TT', angle: 54 },
  { id: 'x', glyph: 'X', angle: 126 },
  { id: 'facebook', glyph: 'FB', angle: 198 },
];

/**
 * Animated 3D-inspired orbital core: CSS 3D rings around the RX emblem with
 * platform signal nodes. State drives speed/colour: idle, scanning, locked, blocked.
 */
export function OrbitalCore({
  state = 'idle',
  activePlatform = null,
  size = 340,
}: {
  state?: 'idle' | 'scanning' | 'locked' | 'blocked';
  activePlatform?: PlatformId | null;
  size?: number;
}) {
  const tone = state === 'blocked' ? 'var(--color-danger)' : state === 'locked' ? 'var(--color-ok)' : 'var(--color-signal)';
  return (
    <div
      className={`orbital relative select-none ${state === 'scanning' ? 'orbital-fast' : ''}`}
      style={{ width: size, height: size, ['--tone' as string]: tone }}
      aria-hidden="true"
    >
      <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle,var(--tone)_0%,transparent_65%)] opacity-40 animate-pulse-glow" />
      <div className="orbital-stage absolute inset-0">
        <div className="ring ring-a" />
        <div className="ring ring-b" />
        <div className="ring ring-c" />
      </div>

      {/* Signal-node orbit (2D) with counter-rotating labels */}
      <div className="node-orbit absolute inset-[4%]">
        {NODES.map((n) => {
          const active = activePlatform === n.id;
          return (
            <div
              key={n.id}
              className="absolute top-1/2 left-1/2 h-0 w-0"
              style={{ transform: `rotate(${n.angle}deg) translateX(${size * 0.46}px)` }}
            >
              <div style={{ transform: `rotate(${-n.angle}deg)` }}>
                <div className="node-counter">
                  <span
                    className={`flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border font-mono text-[10px] font-bold transition-all duration-500 ${
                      active
                        ? 'scale-125 border-cyan bg-cyan/20 text-white shadow-[0_0_24px_rgba(34,225,255,.8)]'
                        : 'border-white/15 bg-obsidian-900/90 text-ink-dim'
                    }`}
                  >
                    {n.glyph}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="absolute inset-0 flex items-center justify-center">
        <div className="relative">
          <div className="absolute -inset-6 rounded-full border border-white/5" />
          <Emblem size={Math.round(size * 0.3)} />
          {state === 'scanning' && (
            <div className="absolute -inset-8 overflow-hidden rounded-full">
              <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-cyan/30 to-transparent animate-scan" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
