import { createContext, useContext, useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from 'react';

/** Minimal History-API router — the app has a handful of flat routes. */
const RouteContext = createContext<string>('/');

export function navigate(to: string, replace = false) {
  if (to === window.location.pathname + window.location.search) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo({ top: 0 });
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return <RouteContext.Provider value={path}>{children}</RouteContext.Provider>;
}

export const usePath = () => useContext(RouteContext);

export function Link({ href, children, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || /^https?:/.test(href)) return;
        e.preventDefault();
        navigate(href);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
