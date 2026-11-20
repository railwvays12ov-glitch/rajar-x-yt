/**
 * Platform registry. Names are used descriptively only — RAJAR X YT is not affiliated
 * with any of these services and renders abstract badges, never their logos.
 */
export type PlatformId = 'youtube' | 'instagram' | 'tiktok' | 'x' | 'facebook' | 'other';

export interface PlatformDefinition {
  id: PlatformId;
  name: string;
  /** Short abstract badge glyph shown in the UI (not a platform logo). */
  glyph: string;
  /** Registrable domains (suffix-matched on label boundaries). */
  domains: string[];
  /** Path patterns that indicate private, login-walled or non-single-item content. */
  blockedPaths: { pattern: RegExp; code: 'MEDIA_PRIVATE' | 'LOGIN_REQUIRED' | 'PLAYLIST_UNSUPPORTED' }[];
  scope: string;
}

export const PLATFORMS: PlatformDefinition[] = [
  {
    id: 'youtube',
    name: 'YouTube',
    glyph: 'YT',
    domains: ['youtube.com', 'youtu.be', 'youtube-nocookie.com'],
    blockedPaths: [
      { pattern: /^\/(playlist|feed|channel|c|user)(\/|$)/i, code: 'PLAYLIST_UNSUPPORTED' },
      { pattern: /^\/@[^/]+\/?(videos|shorts|streams|playlists)?\/?$/i, code: 'PLAYLIST_UNSUPPORTED' },
      { pattern: /^\/(account|signin|premium|paid_memberships)(\/|$)/i, code: 'LOGIN_REQUIRED' },
    ],
    scope: 'Public videos and Shorts',
  },
  {
    id: 'instagram',
    name: 'Instagram',
    glyph: 'IG',
    domains: ['instagram.com'],
    blockedPaths: [
      { pattern: /^\/(stories|direct|accounts|explore)(\/|$)/i, code: 'LOGIN_REQUIRED' },
      { pattern: /^\/[^/]+\/?$/i, code: 'PLAYLIST_UNSUPPORTED' },
    ],
    scope: 'Public posts and reels',
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    glyph: 'TT',
    domains: ['tiktok.com'],
    blockedPaths: [
      { pattern: /^\/(messages|login|live)(\/|$)/i, code: 'LOGIN_REQUIRED' },
      { pattern: /^\/@[^/]+\/?$/i, code: 'PLAYLIST_UNSUPPORTED' },
    ],
    scope: 'Public videos',
  },
  {
    id: 'x',
    name: 'X',
    glyph: 'X',
    domains: ['x.com', 'twitter.com'],
    blockedPaths: [
      { pattern: /^\/(messages|i\/bookmarks|settings|login)(\/|$)/i, code: 'LOGIN_REQUIRED' },
      { pattern: /^\/[^/]+\/?$/i, code: 'PLAYLIST_UNSUPPORTED' },
    ],
    scope: 'Public posts with media',
  },
  {
    id: 'facebook',
    name: 'Facebook',
    glyph: 'FB',
    domains: ['facebook.com', 'fb.watch'],
    blockedPaths: [{ pattern: /^\/(groups|messages|stories|login|marketplace)(\/|$)/i, code: 'LOGIN_REQUIRED' }],
    scope: 'Public videos and reels',
  },
];

export const OTHER_PLATFORM: PlatformDefinition = {
  id: 'other',
  name: 'Other public sources',
  glyph: '··',
  domains: [],
  blockedPaths: [],
  scope: 'Operator-approved public sources only',
};

export function platformById(id: PlatformId): PlatformDefinition {
  return PLATFORMS.find((p) => p.id === id) ?? OTHER_PLATFORM;
}

export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, '');
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}
