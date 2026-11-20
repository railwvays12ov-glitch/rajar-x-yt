import { useEffect, useRef } from 'react';
import { isLowEndDevice, useReducedMotion } from '../../lib/hooks';

/** Moving grid + scanlines + (capable devices only) a light particle field. */
export function Backdrop() {
  const reduced = useReducedMotion();
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_70%_-10%,rgba(139,92,246,.18),transparent_60%),radial-gradient(900px_500px_at_-10%_110%,rgba(34,225,255,.08),transparent_60%),radial-gradient(700px_400px_at_110%_80%,rgba(255,79,216,.06),transparent_60%)]" />
      <div className={`grid-bg absolute inset-0 ${reduced ? '' : 'animate-grid'}`} />
      <div className="scanlines absolute inset-0 opacity-60" />
      {!reduced && !isLowEndDevice() && <Particles />}
    </div>
  );
}

function Particles() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const pts = Array.from({ length: 42 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.18,
      vy: (Math.random() - 0.5) * 0.18,
      r: Math.random() * 1.4 + 0.4,
      c: Math.random() < 0.7 ? '169,139,255' : Math.random() < 0.6 ? '34,225,255' : '255,79,216',
    }));
    let raf = 0;
    const frame = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x = (p.x + p.vx + w) % w;
        p.y = (p.y + p.vy + h) % h;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.c},.55)`;
        ctx.fill();
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i]!;
          const b = pts[j]!;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 120) {
            ctx.strokeStyle = `rgba(139,92,246,${0.08 * (1 - d / 120)})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    const onVis = () => {
      cancelAnimationFrame(raf);
      if (document.visibilityState === 'visible') raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
