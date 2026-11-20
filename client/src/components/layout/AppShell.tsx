import { useEffect, useState, type ReactNode } from 'react';
import { ActivityList } from '../../features/activity/ActivityList';
import { Link, usePath } from '../../lib/router';
import { useSession } from '../../lib/session';
import { Emblem, Wordmark } from '../brand/Logo';
import { Icon, type IconName } from '../Icon';
import { Backdrop } from '../visual/Backdrop';
import { Footer } from './Footer';
import { ComponentList, StatusIndicator } from './StatusIndicator';

export const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Download', icon: 'download' },
  { href: '/keys', label: 'API Keys', icon: 'key' },
  { href: '/activity', label: 'Activity', icon: 'activity' },
  { href: '/docs', label: 'Docs', icon: 'book' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

function ProfileArea({ compact = false }: { compact?: boolean }) {
  const { me, logout, loading } = useSession();
  if (loading) return <span className="h-9 w-9 rounded-full shimmer" />;
  if (!me?.user) {
    return (
      <Link href="/login" className="btn-ghost !min-h-9 !px-3 !py-1.5 whitespace-nowrap">
        <Icon name="user" size={16} /> {!compact && 'Sign in'}
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Link
        href="/settings"
        className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pr-3 pl-1 hover:border-white/20"
        title={me.user.email}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-signal to-cyan font-display text-xs font-bold text-white">
          {me.user.displayName.slice(0, 1).toUpperCase()}
        </span>
        {!compact && <span className="max-w-28 truncate text-sm text-ink">{me.user.displayName}</span>}
        {me.user.role !== 'user' && <span className="chip !px-1.5 !py-0 border-magenta/40 text-magenta">{me.user.role}</span>}
      </Link>
      {!compact && (
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-lg p-2 text-ink-dim hover:bg-white/5 hover:text-white"
          aria-label="Sign out"
          title="Sign out"
        >
          <Icon name="logout" size={17} />
        </button>
      )}
    </div>
  );
}

function SidePanel() {
  const { status } = useSession();
  return (
    <div className="space-y-4">
      <section className="holo holo-quiet p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-[11px] tracking-[0.2em] text-ink-dim uppercase">System status</h2>
          <StatusIndicator compact />
        </div>
        {status ? <ComponentList components={status.components} /> : <div className="h-40 shimmer rounded-xl" />}
        {status && (
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-ink-dim">
            Limits · {Math.round(status.limits.maxFileSizeBytes / 1048576)} MB ·{' '}
            {Math.round(status.limits.maxDurationSeconds / 60)} min · files kept {status.limits.retentionMinutes} min
          </p>
        )}
      </section>
      <section className="holo holo-quiet p-4">
        <h2 className="mb-3 font-mono text-[11px] tracking-[0.2em] text-ink-dim uppercase">Recent activity</h2>
        <ActivityList compact />
      </section>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePath();
  const { isAdmin } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const nav = isAdmin ? [...NAV, { href: '/admin', label: 'Admin', icon: 'server' as IconName }] : NAV;
  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));

  useEffect(() => {
    setMenuOpen(false);
    setPanelOpen(false);
  }, [path]);

  return (
    <div className="relative min-h-dvh">
      <Backdrop />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-signal focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      {/* Desktop brand rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[92px] flex-col items-center border-r border-white/[0.06] bg-obsidian-950/70 py-5 backdrop-blur-xl lg:flex">
        <Link href="/" aria-label="RAJAR X YT home">
          <Emblem size={48} intro />
        </Link>
        <div className="mt-2 font-mono text-[9px] tracking-[0.3em] text-ink-dim">RX·YT</div>
        <nav className="mt-8 flex flex-1 flex-col gap-1.5" aria-label="Primary">
          {nav.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? 'page' : undefined}
              className={`group relative flex w-[72px] flex-col items-center gap-1 rounded-xl py-2.5 text-[10.5px] font-medium transition ${
                isActive(n.href) ? 'bg-signal/15 text-white' : 'text-ink-dim hover:bg-white/5 hover:text-ink'
              }`}
            >
              {isActive(n.href) && (
                <span className="absolute top-2 bottom-2 -left-[10px] w-[3px] rounded-full bg-gradient-to-b from-signal to-cyan shadow-[0_0_12px_rgba(139,92,246,.9)]" />
              )}
              <Icon name={n.icon} size={20} />
              {n.label}
            </Link>
          ))}
        </nav>
        <StatusIndicator compact />
      </aside>

      <div className="lg:pl-[92px]">
        {/* Header */}
        <header className="sticky top-0 z-20 border-b border-white/[0.06] bg-void/70 backdrop-blur-xl">
          <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-3 px-4 sm:px-6">
            <Link href="/" className="shrink-0" aria-label="RAJAR X YT home">
              <span className="lg:hidden">
                <Wordmark compact intro />
              </span>
              <span className="hidden lg:inline">
                <Wordmark />
              </span>
            </Link>
            <div className="hidden lg:block">
              <StatusIndicator />
            </div>
            <nav className="ml-2 hidden items-center gap-0.5 md:flex lg:hidden" aria-label="Primary">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  aria-current={isActive(n.href) ? 'page' : undefined}
                  className={`rounded-lg px-2.5 py-1.5 text-sm whitespace-nowrap ${isActive(n.href) ? 'bg-signal/15 text-white' : 'text-ink-muted hover:text-white'}`}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="flex-1" />
            <button
              type="button"
              className="hidden rounded-lg border border-white/10 p-2 text-ink-muted hover:text-white md:inline-flex xl:hidden"
              onClick={() => setPanelOpen((v) => !v)}
              aria-expanded={panelOpen}
              aria-controls="side-panel"
              aria-label="Toggle status and activity panel"
            >
              <Icon name="panel" />
            </button>
            <span className="lg:hidden">
              <StatusIndicator compact />
            </span>
            <ProfileArea compact={false} />
            <button
              type="button"
              className="rounded-lg border border-white/10 p-2 text-ink-muted md:hidden"
              onClick={() => setMenuOpen(true)}
              aria-label="Open menu"
              aria-expanded={menuOpen}
            >
              <Icon name="menu" />
            </button>
          </div>
        </header>

        <div className="mx-auto grid max-w-[1500px] gap-6 px-4 pt-6 pb-10 sm:px-6 xl:grid-cols-[minmax(0,1fr)_340px]">
          <main id="main" className="min-w-0">
            {children}
          </main>
          <aside className="hidden xl:block" aria-label="Status and activity">
            <div className="sticky top-24">
              <SidePanel />
            </div>
          </aside>
        </div>

        <Footer />
      </div>

      {/* Tablet / small-desktop collapsible panel */}
      {panelOpen && (
        <div className="fixed inset-0 z-40 xl:hidden" id="side-panel">
          <button
            type="button"
            className="absolute inset-0 bg-void/70 backdrop-blur-sm"
            aria-label="Close panel"
            onClick={() => setPanelOpen(false)}
          />
          <div className="absolute inset-y-0 right-0 w-[min(380px,92vw)] overflow-y-auto border-l border-white/10 bg-obsidian-950 p-4 animate-rise">
            <SidePanel />
          </div>
        </div>
      )}

      {/* Mobile menu sheet */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            type="button"
            className="absolute inset-0 bg-void/80 backdrop-blur-sm"
            aria-label="Close menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute inset-x-0 top-0 rounded-b-3xl border-b border-white/10 bg-obsidian-950 p-5 animate-rise">
            <div className="mb-4 flex items-center justify-between">
              <Wordmark />
              <button
                type="button"
                className="rounded-lg p-2 text-ink-muted"
                onClick={() => setMenuOpen(false)}
                aria-label="Close menu"
              >
                <Icon name="x" />
              </button>
            </div>
            <StatusIndicator />
            <nav className="mt-4 grid grid-cols-2 gap-2" aria-label="Mobile">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 text-sm ${isActive(n.href) ? 'border-signal/50 bg-signal/15 text-white' : 'border-white/10 text-ink-muted'}`}
                >
                  <Icon name={n.icon} /> {n.label}
                </Link>
              ))}
            </nav>
            <div className="mt-4 flex gap-4 text-xs text-ink-dim">
              <Link href="/terms">Terms</Link>
              <Link href="/privacy">Privacy</Link>
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom navigation */}
      <nav
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-obsidian-950/90 backdrop-blur-xl md:hidden"
        aria-label="Bottom"
      >
        <div className="grid grid-cols-5">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(n.href) ? 'page' : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10.5px] ${isActive(n.href) ? 'text-white' : 'text-ink-dim'}`}
            >
              <span className={`rounded-lg px-3 py-1 ${isActive(n.href) ? 'bg-signal/20 text-signal-bright' : ''}`}>
                <Icon name={n.icon} size={19} />
              </span>
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
