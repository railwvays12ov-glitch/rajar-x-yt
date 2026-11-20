import type { ComponentType } from 'react';
import { AppShell } from './components/layout/AppShell';
import { ActivityList } from './features/activity/ActivityList';
import { AdminPage } from './features/admin/AdminPage';
import { AuthPage } from './features/auth/AuthPage';
import { DocsPage } from './features/docs/DocsPage';
import { DownloadPage } from './features/download/DownloadPage';
import { KeysPage } from './features/keys/KeysPage';
import { NotFoundPage, PrivacyPage, TermsPage } from './features/legal/LegalPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { useDocumentTitle } from './lib/hooks';
import { RouterProvider, usePath } from './lib/router';
import { SessionProvider } from './lib/session';

function ActivityPage() {
  useDocumentTitle('Activity');
  return (
    <div className="space-y-5">
      <header>
        <div className="font-mono text-[11px] tracking-[0.2em] text-signal-bright uppercase">Activity center</div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-white">Recent activity</h1>
        <p className="mt-1 text-ink-muted">
          Every job with its platform, format, status and request ID. Finished files are temporary and expire automatically.
        </p>
      </header>
      <section className="holo p-4 sm:p-5">
        <ActivityList />
      </section>
    </div>
  );
}

const ROUTES: Record<string, ComponentType> = {
  '/': DownloadPage,
  '/keys': KeysPage,
  '/activity': ActivityPage,
  '/docs': DocsPage,
  '/settings': SettingsPage,
  '/admin': AdminPage,
  '/login': AuthPage,
  '/terms': TermsPage,
  '/privacy': PrivacyPage,
};

function Routes() {
  const path = usePath().replace(/\/+$/, '') || '/';
  const Page = ROUTES[path] ?? NotFoundPage;
  return (
    <AppShell>
      <Page key={path} />
    </AppShell>
  );
}

export function App() {
  return (
    <RouterProvider>
      <SessionProvider>
        <Routes />
      </SessionProvider>
    </RouterProvider>
  );
}
