import { PLATFORMS, hostMatchesDomain, type PlatformDefinition } from '@shared/platforms';

export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

export function formatDuration(s: number | null | undefined): string {
  if (s == null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function shortUrl(url: string, max = 42): string {
  try {
    const u = new URL(url);
    const s = `${u.hostname.replace(/^www\./, '')}${u.pathname}${u.search}`;
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  } catch {
    return url.slice(0, max);
  }
}

export type ClientUrlCheck =
  | { state: 'empty' }
  | { state: 'invalid'; reason: string }
  | { state: 'unsupported'; host: string }
  | { state: 'ok'; platform: PlatformDefinition; host: string };

/** Fast client-side pre-check. The server repeats (and extends) every check. */
export function checkUrl(raw: string): ClientUrlCheck {
  const v = raw.trim();
  if (!v) return { state: 'empty' };
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { state: 'invalid', reason: 'Paste a full link starting with https://' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { state: 'invalid', reason: 'Only web links are supported.' };
  if (u.username || u.password) return { state: 'invalid', reason: 'Links with embedded credentials are not allowed.' };
  const host = u.hostname.toLowerCase();
  const platform = PLATFORMS.find((p) => p.domains.some((d) => hostMatchesDomain(host, d)));
  if (!platform) return { state: 'unsupported', host };
  return { state: 'ok', platform, host };
}

export const QUALITY_LABEL: Record<string, string> = {
  best: 'Best available',
  '2160': '2160p · 4K',
  '1440': '1440p · QHD',
  '1080': '1080p · FHD',
  '720': '720p · HD',
  '480': '480p · SD',
  audio: 'Audio only',
};
