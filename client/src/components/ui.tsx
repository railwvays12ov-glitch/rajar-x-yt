import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { JobStatus } from '@shared/types';
import type { ApiError } from '../lib/api';
import { useReducedMotion } from '../lib/hooks';
import { Icon, type IconName } from './Icon';

export function Card({
  children,
  className = '',
  quiet = false,
  as: As = 'section',
}: {
  children: ReactNode;
  className?: string;
  quiet?: boolean;
  as?: 'section' | 'div' | 'article';
}) {
  return <As className={`holo ${quiet ? 'holo-quiet' : ''} ${className}`}>{children}</As>;
}

/** Subtle pointer tilt for mouse users only; static for touch, keyboard and reduced motion. */
export function Tilt({ children, className = '', max = 5 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  return (
    <div
      ref={ref}
      className={`transition-transform duration-300 ease-out ${className}`}
      style={{ transformStyle: 'preserve-3d' }}
      onPointerMove={(e) => {
        if (reduced || e.pointerType !== 'mouse' || !ref.current) return;
        const r = ref.current.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5;
        const y = (e.clientY - r.top) / r.height - 0.5;
        ref.current.style.transform = `perspective(900px) rotateX(${(-y * max).toFixed(2)}deg) rotateY(${(x * max).toFixed(2)}deg)`;
      }}
      onPointerLeave={() => {
        if (ref.current) ref.current.style.transform = '';
      }}
    >
      {children}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        {eyebrow && <div className="mb-1 font-mono text-[11px] tracking-[0.2em] text-signal-bright uppercase">{eyebrow}</div>}
        <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
      </div>
      {action}
    </div>
  );
}

const STATUS_STYLE: Record<JobStatus | 'analyzing', { label: string; cls: string; dot: string }> = {
  analyzing: { label: 'Analyzing', cls: 'border-cyan/40 bg-cyan/10 text-cyan', dot: 'bg-cyan animate-pulse' },
  queued: { label: 'Queued', cls: 'border-white/20 bg-white/5 text-ink-muted', dot: 'bg-ink-muted animate-pulse' },
  active: { label: 'Processing', cls: 'border-signal/50 bg-signal/15 text-signal-bright', dot: 'bg-signal-bright animate-pulse' },
  ready: { label: 'Ready', cls: 'border-ok/40 bg-ok/10 text-ok', dot: 'bg-ok' },
  completed: { label: 'Completed', cls: 'border-ok/30 bg-ok/5 text-ok/90', dot: 'bg-ok/80' },
  blocked: { label: 'Blocked', cls: 'border-warn/40 bg-warn/10 text-warn', dot: 'bg-warn' },
  failed: { label: 'Failed', cls: 'border-danger/40 bg-danger/10 text-danger', dot: 'bg-danger' },
  cancelled: { label: 'Cancelled', cls: 'border-white/15 bg-white/5 text-ink-dim', dot: 'bg-ink-dim' },
  expired: { label: 'Expired', cls: 'border-white/10 bg-white/[0.03] text-ink-dim', dot: 'bg-ink-dim/60' },
};

export function StatusChip({ status }: { status: JobStatus | 'analyzing' }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`chip ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function ErrorCallout({ error, onRetry, compact = false }: { error: ApiError; onRetry?: () => void; compact?: boolean }) {
  const restricted = [
    'MEDIA_PRIVATE',
    'LOGIN_REQUIRED',
    'PLATFORM_BOT_CHECK',
    'DRM_PROTECTED',
    'AGE_RESTRICTED',
    'GEO_RESTRICTED',
    'MEDIA_RESTRICTED',
    'LIVE_UNSUPPORTED',
  ].includes(error.code);
  return (
    <div
      role="alert"
      className={`rounded-2xl border p-4 ${restricted ? 'border-warn/35 bg-warn/[0.07]' : 'border-danger/35 bg-danger/[0.07]'} animate-rise`}
    >
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 ${restricted ? 'text-warn' : 'text-danger'}`}>
          <Icon name={restricted ? 'lock' : 'alert'} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white">{error.message}</div>
          {!compact && <p className="mt-1 text-sm text-ink-muted">{error.nextAction}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-ink-dim">
            <span>code · {error.code}</span>
            {error.requestId && <span>request · {error.requestId}</span>}
          </div>
        </div>
        {onRetry && (
          <button type="button" className="btn-ghost shrink-0 !min-h-9 !px-3 !py-1.5" onClick={onRetry}>
            <Icon name="refresh" size={15} /> Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-signal/30 bg-signal/10 text-signal-bright">
        <Icon name={icon} size={22} />
      </span>
      <div className="font-display font-semibold text-white">{title}</div>
      <p className="mt-1 max-w-sm text-sm text-ink-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: IconName; disabled?: boolean; hint?: string }[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-white/10 bg-obsidian-950/70 p-1"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={o.disabled}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-2 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-35 ${
              on
                ? 'bg-signal/20 text-white shadow-[inset_0_0_0_1px_rgba(169,139,255,.55)]'
                : 'text-ink-muted hover:bg-white/5 hover:text-ink'
            }`}
          >
            {o.icon && <Icon name={o.icon} size={15} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-xl px-1 ${disabled ? 'cursor-not-allowed opacity-45' : ''}`}
    >
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink-dim">{hint}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="h-6 w-11 rounded-full border border-white/15 bg-white/5 transition peer-checked:border-signal/60 peer-checked:bg-signal/40 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan" />
        <span className="absolute top-1 left-1 h-4 w-4 rounded-full bg-ink-muted transition peer-checked:translate-x-5 peer-checked:bg-white" />
      </span>
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  dismissible = true,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  dismissible?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input,button,select,textarea')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus();
    };
  }, [open, onClose, dismissible]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-void/80 backdrop-blur-sm"
        onClick={() => dismissible && onClose()}
        tabIndex={-1}
      />
      <div
        ref={ref}
        className="holo relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 sm:rounded-b-[1.25rem] sm:p-6 animate-rise"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-white">{title}</h2>
          {dismissible && (
            <button
              type="button"
              className="rounded-lg p-2 text-ink-muted hover:bg-white/5 hover:text-white"
              onClick={onClose}
              aria-label="Close"
            >
              <Icon name="x" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost !min-h-9 !px-3 !py-1.5"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch {
          /* clipboard blocked — user can select manually */
        }
      }}
    >
      <Icon name={copied ? 'check' : 'copy'} size={15} />
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
}

export function SafeUseNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-cyan/20 bg-cyan/[0.05] p-3.5 text-sm">
      <span className="mt-0.5 text-cyan">
        <Icon name="shield" />
      </span>
      <div className="text-ink-muted">
        <span className="font-semibold text-white">Analyze first. Process only what you’re allowed to use.</span>{' '}
        {!compact &&
          'Public URL does not automatically mean unrestricted use. You are responsible for copyright, platform terms and permissions. Private, login-walled, DRM, age-restricted and geo-blocked media are never processed.'}
      </div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`shimmer rounded-lg ${className}`} />;
}
