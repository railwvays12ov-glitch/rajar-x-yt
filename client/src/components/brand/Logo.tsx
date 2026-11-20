import { useId } from 'react';

/**
 * RX emblem: geometric R glyph wrapped by two crossing orbits that form the
 * "X-shaped orbital slash", with a cyan signal node. Pure SVG — scales cleanly.
 */
export function Emblem({ size = 40, intro = false, className = '' }: { size?: number; intro?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`${intro ? 'logo-intro' : ''} ${className}`}
      role="img"
      aria-label="RAJAR X emblem"
    >
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a98bff" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#22e1ff" />
        </linearGradient>
        <radialGradient id={`c-${id}`} cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#2a1f52" />
          <stop offset="1" stopColor="#0b0914" />
        </radialGradient>
        <filter id={`f-${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="16" fill={`url(#c-${id})`} stroke="rgba(169,139,255,.35)" />
      <g filter={`url(#f-${id})`} fill="none" strokeLinecap="round">
        <ellipse
          className="orbit-a"
          cx="32"
          cy="32"
          rx="26"
          ry="8.5"
          transform="rotate(42 32 32)"
          stroke={`url(#g-${id})`}
          strokeWidth="2"
        />
        <ellipse
          className="orbit-b"
          cx="32"
          cy="32"
          rx="26"
          ry="8.5"
          transform="rotate(-42 32 32)"
          stroke={`url(#g-${id})`}
          strokeWidth="2"
          strokeOpacity=".7"
        />
        <path
          className="glyph"
          d="M24 44V20h9.5a7 7 0 0 1 0 14H24m9 0 7.5 10"
          stroke="#fff"
          strokeWidth="4.2"
          strokeLinejoin="round"
        />
      </g>
      <circle cx="51.3" cy="14.6" r="2.6" fill="#22e1ff" />
    </svg>
  );
}

/** Small "YT" signal badge (abstract — deliberately not any platform's logo). */
export function SignalBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-cyan/40 bg-cyan/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-[0.18em] text-cyan ${className}`}
    >
      <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true">
        <rect x="0" y="6" width="2" height="4" fill="currentColor" />
        <rect x="4" y="3" width="2" height="7" fill="currentColor" />
        <rect x="8" y="0" width="2" height="10" fill="currentColor" />
      </svg>
      YT
    </span>
  );
}

export function Wordmark({ compact = false, intro = false }: { compact?: boolean; intro?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${intro ? 'wordmark-intro' : ''}`}>
      <Emblem size={compact ? 34 : 40} intro={intro} />
      <span className="flex items-baseline gap-1.5 font-display leading-none">
        <span className="text-[19px] font-bold tracking-[-0.02em] text-white">RAJAR</span>
        <span className="relative text-[21px] font-bold text-gradient">
          X
          <span className="absolute -inset-x-0.5 top-1/2 h-[2px] -rotate-[28deg] bg-gradient-to-r from-transparent via-cyan to-transparent opacity-80" />
        </span>
        {!compact && <SignalBadge className="ml-1 -translate-y-0.5" />}
      </span>
    </span>
  );
}
