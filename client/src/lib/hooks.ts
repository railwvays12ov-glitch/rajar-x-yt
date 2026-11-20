import { useEffect, useRef, useState } from 'react';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Low-end heuristic: few cores, little memory, or Save-Data → skip heavy effects. */
export function isLowEndDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return (
    (nav.hardwareConcurrency ?? 8) <= 4 ||
    (nav.deviceMemory ?? 8) <= 4 ||
    !!nav.connection?.saveData ||
    window.matchMedia('(max-width: 640px)').matches
  );
}

/** Polls `fn` every `ms` while `active` and the tab is visible. */
export function usePolling(fn: () => void | Promise<void>, ms: number, active: boolean) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let t: number;
    const tick = async () => {
      if (document.visibilityState === 'visible') await ref.current();
      if (!stopped) t = window.setTimeout(tick, ms);
    };
    t = window.setTimeout(tick, ms);
    return () => {
      stopped = true;
      window.clearTimeout(t);
    };
  }, [ms, active]);
}

export function useDocumentTitle(title: string, description?: string) {
  useEffect(() => {
    document.title = title === 'RAJAR X YT' ? title : `${title} · RAJAR X YT`;
    if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description);
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) {
      try {
        const base = new URL(canonical.href);
        canonical.href = `${base.origin}${window.location.pathname}`;
      } catch {
        /* placeholder in dev */
      }
    }
  }, [title, description]);
}
