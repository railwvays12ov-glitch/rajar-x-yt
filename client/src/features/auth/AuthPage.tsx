import { useState } from 'react';
import { post, toApiError, type ApiError } from '../../lib/api';
import { useDocumentTitle } from '../../lib/hooks';
import { Link, navigate } from '../../lib/router';
import { useSession } from '../../lib/session';
import { Emblem } from '../../components/brand/Logo';
import { Icon, Spinner } from '../../components/Icon';
import { ErrorCallout, Segmented } from '../../components/ui';

export function AuthPage() {
  useDocumentTitle('Sign in');
  const { refresh, me } = useSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  if (me?.user) {
    return (
      <div className="mx-auto max-w-md py-12 text-center">
        <p className="text-ink-muted">You’re signed in as {me.user.email}.</p>
        <Link href="/" className="btn-primary mt-4">
          Go to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-4xl items-center gap-8 py-6 md:grid-cols-2">
      <div className="hidden md:block">
        <Emblem size={84} intro />
        <h1 className="mt-5 font-display text-3xl font-bold tracking-tight text-white">Your content. Your APIs. Your rules.</h1>
        <ul className="mt-5 space-y-3 text-sm text-ink-muted">
          {[
            'Authorized processing jobs with live progress',
            'Personal API keys — shown once, stored only as hashes',
            'Activity history with request IDs',
            'Webhooks for your own automations',
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <span className="text-cyan">
                <Icon name="check" size={17} />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </div>

      <form
        className="holo space-y-4 p-5 sm:p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await post(
              mode === 'login' ? '/api/auth/login' : '/api/auth/register',
              mode === 'login' ? { email, password } : { email, password, displayName },
            );
            await refresh();
            navigate('/');
          } catch (err) {
            setError(toApiError(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Segmented
          label="Account mode"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setError(null);
          }}
          options={[
            { value: 'login', label: 'Sign in' },
            { value: 'register', label: 'Create account' },
          ]}
        />
        {mode === 'register' && (
          <div>
            <label htmlFor="name" className="label">
              Display name
            </label>
            <input
              id="name"
              className="field"
              autoComplete="nickname"
              required
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
        )}
        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input
            id="email"
            type="email"
            className="field"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            type="password"
            className="field"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 10 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'register' && (
            <p className="mt-1 text-xs text-ink-dim">At least 10 characters. Passwords are hashed with scrypt.</p>
          )}
        </div>
        {error && <ErrorCallout error={error} compact={error.code === 'INVALID_CREDENTIALS'} />}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? <Spinner /> : <Icon name="arrow" />} {mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <p className="text-center text-xs text-ink-dim">
          By continuing you agree to the{' '}
          <Link href="/terms" className="underline">
            Terms of use
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="underline">
            Privacy notice
          </Link>
          .
        </p>
      </form>
    </div>
  );
}
