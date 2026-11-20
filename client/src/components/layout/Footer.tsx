import { Link } from '../../lib/router';
import { Wordmark } from '../brand/Logo';

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="mx-auto max-w-[1500px] border-t border-white/[0.06] px-4 pt-8 pb-28 sm:px-6 md:pb-10">
      <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md">
          <Wordmark />
          <p className="mt-3 text-sm text-ink-muted">Built for your content, your APIs, your rules.</p>
          <p className="mt-3 text-xs leading-relaxed text-ink-dim">
            RAJAR X YT is not affiliated with YouTube, Instagram, TikTok, Facebook, X, or other third-party platforms. Platform
            names are used only to describe compatibility. Public URL does not automatically mean unrestricted use.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-10 gap-y-2 text-sm sm:grid-cols-3" aria-label="Footer">
          <Link href="/terms" className="text-ink-muted hover:text-white">
            Terms of use
          </Link>
          <Link href="/privacy" className="text-ink-muted hover:text-white">
            Privacy
          </Link>
          <Link href="/terms#copyright" className="text-ink-muted hover:text-white">
            Copyright notice
          </Link>
          <Link href="/docs" className="text-ink-muted hover:text-white">
            API documentation
          </Link>
          <Link href="/terms#support" className="text-ink-muted hover:text-white">
            Contact &amp; support
          </Link>
          <Link href="/terms#platforms" className="text-ink-muted hover:text-white">
            Platform disclaimer
          </Link>
        </nav>
      </div>
      <div className="mt-8 flex flex-col gap-2 border-t border-white/[0.05] pt-4 font-mono text-[11px] text-ink-dim sm:flex-row sm:justify-between">
        <span>© {year} RAJAR X. All rights reserved.</span>
        <span>Your API keys are shown once and never stored in plaintext.</span>
      </div>
    </footer>
  );
}
