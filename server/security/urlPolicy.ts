import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import type { ErrorCode } from '../../shared/errors.js';
import { OTHER_PLATFORM, PLATFORMS, hostMatchesDomain, type PlatformDefinition } from '../../shared/platforms.js';
import { AppError } from '../http/appError.js';
import { isBlockedIp } from './ip.js';

export interface UrlPolicyOptions {
  extraAllowedDomains: string[];
  disabledPlatforms: string[];
}

export interface ValidatedUrl {
  url: string;
  host: string;
  platform: PlatformDefinition;
}

const MAX_URL_LENGTH = 2048;
// Query params that carry auth or session state and must never be forwarded.
const SECRET_PARAMS = /^(token|access_token|auth|key|sig|signature|session|oe|oh|_nc_sid|efg)$/i;
// Tracking params stripped to produce a canonical link.
const TRACKING_PARAMS = /^(utm_[a-z]+|si|feature|igsh|igshid|fbclid|gclid|is_from_webapp|sender_device|ref|ref_src)$/i;
// YouTube params that turn a single video into a batch.
const BATCH_PARAMS = /^(list|index|start_radio)$/i;

function reject(code: ErrorCode, reason: string): never {
  throw new AppError(code, { reason });
}

export function detectPlatform(host: string, opts: UrlPolicyOptions): PlatformDefinition | null {
  const platform = PLATFORMS.find((p) => p.domains.some((d) => hostMatchesDomain(host, d)));
  if (platform) return opts.disabledPlatforms.includes(platform.id) ? null : platform;
  if (opts.extraAllowedDomains.some((d) => hostMatchesDomain(host, d))) {
    return opts.disabledPlatforms.includes('other') ? null : OTHER_PLATFORM;
  }
  return null;
}

/**
 * Synchronous structural validation. Shared by the client (via the API) and server.
 * Throws AppError with a stable code; never returns a partially-trusted URL.
 */
export function validateUrlSyntax(raw: string, opts: UrlPolicyOptions): ValidatedUrl {
  const input = raw.trim();
  if (!input || input.length > MAX_URL_LENGTH) reject('INVALID_URL', 'length');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s<>"`\\]/.test(input)) reject('INVALID_URL', 'characters');

  let u: URL;
  try {
    u = new URL(input);
  } catch {
    reject('INVALID_URL', 'parse');
  }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') reject('INVALID_URL', 'protocol');
  if (u.username || u.password) reject('INVALID_URL', 'credentials');
  if (u.port && u.port !== '443' && u.port !== '80') reject('INVALID_URL', 'port');

  const host = domainToASCII(u.hostname.replace(/\.$/, '').toLowerCase());
  if (!host) reject('INVALID_URL', 'host');
  if (isIP(host.replace(/^\[|\]$/g, ''))) reject('INVALID_URL', 'ip-literal');
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.internal') || host === 'localhost') {
    reject('INVALID_URL', 'non-public-host');
  }

  const platform = detectPlatform(host, opts);
  if (!platform) reject('UNSUPPORTED_PLATFORM', 'domain-not-allowed');

  for (const blocked of platform.blockedPaths) {
    if (blocked.pattern.test(u.pathname)) reject(blocked.code, 'path');
  }

  for (const key of [...u.searchParams.keys()]) {
    if (SECRET_PARAMS.test(key)) reject('LOGIN_REQUIRED', 'signed-or-authenticated-url');
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
    if (platform.id === 'youtube' && BATCH_PARAMS.test(key)) u.searchParams.delete(key);
  }

  if (platform.id === 'youtube') {
    const isWatch = u.pathname === '/watch' && u.searchParams.get('v');
    const isShort = /^\/(shorts|live|embed)\/[\w-]{6,}/.test(u.pathname);
    const isShortLink = hostMatchesDomain(host, 'youtu.be') && /^\/[\w-]{6,}$/.test(u.pathname);
    if (!isWatch && !isShort && !isShortLink) reject('PLAYLIST_UNSUPPORTED', 'not-single-video');
  }

  u.protocol = 'https:';
  u.port = '';
  u.hash = '';
  u.hostname = host;
  return { url: u.toString(), host, platform };
}

export type Resolver = (host: string) => Promise<{ address: string }[]>;

const defaultResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * SSRF guard: resolves the host and rejects if ANY resolved address is non-public.
 * Called at analysis time and again immediately before each yt-dlp spawn to narrow
 * the DNS-rebinding window. Combined with the domain allow-list, yt-dlp can only
 * talk to well-known public platform hosts.
 */
export async function assertPublicHost(host: string, resolver: Resolver = defaultResolver): Promise<void> {
  let records: { address: string }[];
  try {
    records = await resolver(host);
  } catch {
    reject('NETWORK_FAILURE', 'dns');
  }
  if (!records.length) reject('NETWORK_FAILURE', 'dns-empty');
  if (records.some((r) => isBlockedIp(r.address))) reject('INVALID_URL', 'private-address');
}

export async function validateUrl(raw: string, opts: UrlPolicyOptions, resolver?: Resolver): Promise<ValidatedUrl> {
  const v = validateUrlSyntax(raw, opts);
  await assertPublicHost(v.host, resolver);
  return v;
}

export function shortenUrl(url: string, max = 48): string {
  try {
    const u = new URL(url);
    const s = `${u.hostname.replace(/^www\./, '')}${u.pathname}${u.search}`;
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  } catch {
    return url.slice(0, max);
  }
}
