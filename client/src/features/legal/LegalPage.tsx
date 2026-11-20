import { useDocumentTitle } from '../../lib/hooks';

export function TermsPage() {
  useDocumentTitle('Terms of use');
  return (
    <article className="prose-doc mx-auto max-w-3xl">
      <div className="font-mono text-[11px] tracking-[0.2em] text-signal-bright uppercase">Legal</div>
      <h1 className="font-display text-3xl font-bold tracking-tight text-white">Terms of use</h1>
      <p>
        These terms describe how RAJAR X YT may be used. Operators deploying this software should review them with their own legal
        counsel and replace contact details.
      </p>

      <h2>Permitted use</h2>
      <ul>
        <li>
          You may only analyze or process media that you own, that you have explicit permission to process, or that you are
          otherwise legally allowed to download and use.
        </li>
        <li>
          Public URL does not automatically mean unrestricted use. Copyright, licences and each platform’s terms of service still
          apply.
        </li>
        <li>You are solely responsible for how you use any output, including redistribution.</li>
      </ul>

      <h2>What RAJAR X will never do</h2>
      <ul>
        <li>
          Bypass DRM, paywalls, private-account restrictions, login walls, age gates, geo-blocks, rate limits or any other access
          control.
        </li>
        <li>Sign in to third-party platforms on your behalf or accept uploaded cookies.</li>
        <li>
          Process private, members-only, live, playlist/batch or otherwise restricted media. Such requests fail safely with a
          clear error.
        </li>
      </ul>

      <h2>Acceptable API use</h2>
      <ul>
        <li>API keys are personal. Keep them secret and revoke them if exposed.</li>
        <li>
          Automations and bots must restrict access to authorized users, respect rate limits, and must not be used for spam, mass
          messaging, account takeover or unauthorized scraping.
        </li>
        <li>Operators may revoke keys, suspend accounts or pause processing to prevent abuse.</li>
      </ul>

      <h2 id="copyright">Copyright notice</h2>
      <p>
        RAJAR X YT does not host a media library. Processed files are temporary and deleted automatically after a short retention
        window. If you believe content was processed in violation of your rights, contact the operator with the request ID, the
        source URL and proof of ownership; the operator can trace and act on the request.
      </p>

      <h2 id="platforms">Platform disclaimer</h2>
      <p>
        RAJAR X YT is not affiliated with YouTube, Instagram, TikTok, Facebook, X, or other third-party platforms. Platform names
        identify compatibility only; all trademarks belong to their owners. RAJAR X uses its own abstract badges and does not use
        platform logos.
      </p>

      <h2 id="support">Contact &amp; support</h2>
      <p>
        For support, abuse reports or rights requests, contact the operator of this deployment. Include the request ID shown with
        any error so the request can be traced without sharing secrets.
      </p>

      <h2>No warranty</h2>
      <p>The service is provided “as is”. Availability depends on third-party platforms and may change at any time.</p>
    </article>
  );
}

export function PrivacyPage() {
  useDocumentTitle('Privacy');
  return (
    <article className="prose-doc mx-auto max-w-3xl">
      <div className="font-mono text-[11px] tracking-[0.2em] text-signal-bright uppercase">Legal</div>
      <h1 className="font-display text-3xl font-bold tracking-tight text-white">Privacy notice</h1>
      <h2>What we store</h2>
      <ul>
        <li>Account: email, display name, role and a scrypt password hash.</li>
        <li>Sessions: a SHA-256 hash of your session token, expiry and a truncated user agent.</li>
        <li>API keys: name, scopes, limits, timestamps, a masked prefix and a keyed one-way hash. Raw keys are never stored.</li>
        <li>That is all that is written to the server’s disk — account data only.</li>
      </ul>
      <h2>What we do not store</h2>
      <ul>
        <li>
          No processed media — each file is deleted right after its one-time download, or after the retention window if it is
          never downloaded.
        </li>
        <li>
          No activity history or audit trail on disk — job history and request traces live in memory only and disappear when the
          server restarts.
        </li>
        <li>No third-party cookies, platform credentials or advertising trackers.</li>
        <li>No raw API keys, passwords, session tokens or authorization headers in logs.</li>
      </ul>
      <h2>Cookies</h2>
      <p>
        RAJAR X uses strictly necessary cookies only: a session cookie (HTTP-only), a CSRF token, and an anonymous session
        identifier used to apply guest limits.
      </p>
      <h2>Thumbnails</h2>
      <p>Preview thumbnails load directly from the platform’s image CDN with no referrer sent.</p>
    </article>
  );
}

export function NotFoundPage() {
  useDocumentTitle('Not found');
  return (
    <div className="py-20 text-center">
      <div className="font-mono text-6xl font-bold text-gradient">404</div>
      <p className="mt-3 text-ink-muted">This route is off the map.</p>
      <a href="/" className="btn-primary mt-6">
        Back to the command center
      </a>
    </div>
  );
}
