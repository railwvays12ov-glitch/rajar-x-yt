import { useEffect, useRef, useState } from 'react';
import type { AnalysisResult } from '@shared/types';
import { api, toApiError, type ApiError } from '../../lib/api';
import { checkUrl } from '../../lib/format';
import { useDocumentTitle } from '../../lib/hooks';
import { Link } from '../../lib/router';
import { useSession } from '../../lib/session';
import { Icon, Spinner } from '../../components/Icon';
import { ErrorCallout, SafeUseNotice } from '../../components/ui';
import { OrbitalCore } from '../../components/visual/OrbitalCore';
import { MediaPreview } from './MediaPreview';
import { PlatformGrid } from './PlatformGrid';
import { ProcessPanel } from './ProcessPanel';

type Phase = 'idle' | 'analyzing' | 'done' | 'error';

export function DownloadPage() {
  useDocumentTitle(
    'RAJAR X YT',
    'Process media you own or are authorized to use with a fast, transparent, creator-first workflow.',
  );
  const { me, status } = useSession();
  const [url, setUrl] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [coreSize] = useState(() => (window.innerWidth < 640 ? 250 : window.innerWidth < 1280 ? 300 : 340));
  const check = checkUrl(url);
  const detected = check.state === 'ok' ? check.platform : null;
  const anonBlocked = !!me && !me.user && !me.anonymous.analyzeAllowed;
  const engineDown = status?.components.ytdlp.status === 'down';

  // Keyboard: "/" or Ctrl/⌘+K focuses the analyzer, Esc clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName);
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const analyze = async () => {
    if (check.state !== 'ok' || phase === 'analyzing') return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setPhase('analyzing');
    setError(null);
    setAnalysis(null);
    try {
      const r = await api<AnalysisResult>('POST', '/api/analyze', { url }, { signal: ctrl.signal });
      setAnalysis(r.data);
      setPhase('done');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(toApiError(e));
      setPhase('error');
    }
  };

  const clear = () => {
    abortRef.current?.abort();
    setUrl('');
    setPhase('idle');
    setAnalysis(null);
    setError(null);
    setPasteNote(null);
    inputRef.current?.focus();
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text.trim().slice(0, 2048));
      setPasteNote(null);
      inputRef.current?.focus();
    } catch {
      setPasteNote('Clipboard access was blocked — paste with Ctrl+V / ⌘V instead.');
    }
  };

  const coreState = phase === 'analyzing' ? 'scanning' : phase === 'done' ? 'locked' : phase === 'error' ? 'blocked' : 'idle';
  const hint =
    check.state === 'invalid'
      ? check.reason
      : check.state === 'unsupported'
        ? `${check.host} is not on the supported list.`
        : detected
          ? `${detected.name} detected · ${detected.scope.toLowerCase()}`
          : 'YouTube, Instagram, TikTok, X and Facebook public links';

  return (
    <div className="space-y-8">
      {/* Hero / analyzer stage */}
      <section className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="min-w-0 animate-rise">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3 py-1 font-mono text-[11px] tracking-[0.18em] text-signal-bright uppercase">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_10px_#22e1ff]" /> Authorized media command center
          </div>
          <h1 className="font-display text-[2.1rem] leading-[1.05] font-bold tracking-[-0.03em] text-white sm:text-5xl xl:text-[3.4rem]">
            Drop a link. Let <span className="text-gradient whitespace-nowrap">RAJAR X</span> map the safe route.
          </h1>
          <p className="mt-4 max-w-xl text-base text-ink-muted sm:text-lg">
            Process media you own or are authorized to use with a fast, transparent, creator-first workflow.
          </p>

          <form
            className="mt-6"
            onSubmit={(e) => {
              e.preventDefault();
              void analyze();
            }}
            noValidate
          >
            <label htmlFor="url" className="label">
              Step 1 · Paste a public media link
            </label>
            <div
              className={`holo flex flex-col gap-2 p-2 sm:flex-row sm:items-center ${
                check.state === 'invalid' || check.state === 'unsupported'
                  ? 'shadow-[0_0_0_1px_rgba(255,85,119,.5)]'
                  : detected
                    ? 'shadow-[0_0_0_1px_rgba(34,225,255,.45),0_0_40px_-12px_rgba(34,225,255,.6)]'
                    : ''
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-2 pl-2">
                <span
                  className={`flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg font-mono text-[10px] font-bold ${detected ? 'bg-cyan/15 text-cyan' : 'bg-white/5 text-ink-dim'}`}
                >
                  {detected ? detected.glyph : <Icon name="external" size={15} />}
                </span>
                <input
                  ref={inputRef}
                  id="url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://www.youtube.com/watch?v=…"
                  value={url}
                  maxLength={2048}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (phase !== 'analyzing') {
                      setPhase('idle');
                      setError(null);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') clear();
                  }}
                  aria-describedby="url-hint"
                  aria-invalid={check.state === 'invalid' || check.state === 'unsupported'}
                  className="h-11 min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-ink-dim"
                />
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost flex-1 sm:flex-none" onClick={paste} aria-label="Paste from clipboard">
                  <Icon name="paste" size={16} /> <span className="sm:hidden lg:inline">Paste</span>
                </button>
                {url && (
                  <button type="button" className="btn-ghost" onClick={clear} aria-label="Clear link">
                    <Icon name="x" size={16} />
                  </button>
                )}
                <button
                  type="submit"
                  className="btn-primary flex-[2] sm:flex-none"
                  disabled={check.state !== 'ok' || phase === 'analyzing' || anonBlocked || engineDown}
                >
                  {phase === 'analyzing' ? <Spinner /> : <Icon name="bolt" size={16} />}
                  {phase === 'analyzing' ? 'Analyzing…' : 'Analyze'}
                </button>
              </div>
            </div>
            <div id="url-hint" className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <span
                className={
                  check.state === 'invalid' || check.state === 'unsupported'
                    ? 'text-danger'
                    : detected
                      ? 'text-cyan'
                      : 'text-ink-dim'
                }
              >
                {hint}
              </span>
              <span className="hidden items-center gap-1.5 text-ink-dim sm:flex">
                <span className="kbd">/</span> focus <span className="kbd">Enter</span> analyze <span className="kbd">Esc</span>{' '}
                clear
              </span>
            </div>
            {pasteNote && <p className="mt-1 text-xs text-warn">{pasteNote}</p>}
            {anonBlocked && (
              <p className="mt-2 text-sm text-warn">
                Analysis requires an account on this server.{' '}
                <Link href="/login" className="underline">
                  Sign in
                </Link>
              </p>
            )}
            {engineDown && (
              <p className="mt-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
                Setup warning: the yt-dlp engine is not installed on this server, so analysis is unavailable. An administrator
                must install it and set <code>YTDLP_BIN</code>.
              </p>
            )}
          </form>
        </div>

        <div className="flex justify-center lg:justify-end">
          <OrbitalCore state={coreState} activePlatform={detected?.id ?? null} size={coreSize} />
        </div>
      </section>

      {/* Analysis states */}
      <div aria-live="polite" className="space-y-4">
        {phase === 'analyzing' && (
          <div className="holo flex items-center gap-4 p-5">
            <Spinner size={22} />
            <div>
              <div className="font-semibold text-white">Mapping the safe route…</div>
              <div className="text-sm text-ink-muted">
                Validating the link, checking it resolves publicly, then reading metadata only. Nothing is downloaded yet.
              </div>
            </div>
          </div>
        )}
        {phase === 'error' && error && <ErrorCallout error={error} onRetry={analyze} />}
        {phase === 'done' && analysis && (
          <>
            <MediaPreview a={analysis} />
            <ProcessPanel analysis={analysis} />
          </>
        )}
      </div>

      <SafeUseNotice />
      <PlatformGrid active={detected?.id ?? null} />

      <section className="grid gap-3 sm:grid-cols-3">
        {[
          {
            t: 'Analyze first',
            b: 'Metadata is read before anything else. Restricted, private and DRM media stop here.',
            i: 'shield' as const,
          },
          { t: 'Your keys, hashed', b: 'Your API keys are shown once and never stored in plaintext.', i: 'key' as const },
          {
            t: 'Nothing kept',
            b: 'Processed files live in temporary storage and are deleted automatically.',
            i: 'trash' as const,
          },
        ].map((f) => (
          <div key={f.t} className="holo holo-quiet p-4">
            <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-signal/15 text-signal-bright">
              <Icon name={f.i} />
            </span>
            <div className="font-semibold text-white">{f.t}</div>
            <p className="mt-1 text-sm text-ink-muted">{f.b}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
