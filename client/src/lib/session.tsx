import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { MeResponse, SystemStatus } from '@shared/types';
import { get, post, setCsrfToken } from './api';

interface SessionState {
  me: MeResponse | null;
  status: SystemStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  logout: () => Promise<void>;
  isAdmin: boolean;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const m = await get<MeResponse>('/api/auth/me');
      setCsrfToken(m.csrfToken);
      setMe(m);
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await get<SystemStatus>('/api/status'));
    } catch {
      setStatus(null);
    }
  }, []);

  const logout = useCallback(async () => {
    await post('/api/auth/logout').catch(() => {});
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void refresh();
    void refreshStatus();
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refreshStatus();
    }, 30_000);
    return () => window.clearInterval(t);
  }, [refresh, refreshStatus]);

  const isAdmin = me?.user?.role === 'admin' || me?.user?.role === 'owner';
  return (
    <SessionContext.Provider value={{ me, status, loading, refresh, refreshStatus, logout, isAdmin }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession outside SessionProvider');
  return ctx;
}
