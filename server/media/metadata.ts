import type { ErrorCode } from '../../shared/errors.js';
import type { FormatSummary, ProcessOptions, Quality } from '../../shared/types.js';

/** Subset of the yt-dlp info dict we rely on. Everything is optional and untrusted. */
export interface YtdlpFormat {
  format_id?: string;
  ext?: string;
  vcodec?: string | null;
  acodec?: string | null;
  height?: number | null;
  fps?: number | null;
  abr?: number | null;
  tbr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  has_drm?: boolean | 'maybe';
  protocol?: string;
  format_note?: string;
}

export interface YtdlpInfo {
  _type?: string;
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  thumbnails?: { url?: string; preference?: number; width?: number }[];
  availability?: string | null;
  age_limit?: number;
  live_status?: string | null;
  is_live?: boolean;
  was_live?: boolean;
  formats?: YtdlpFormat[];
  subtitles?: Record<string, unknown>;
  extractor_key?: string;
  webpage_url?: string;
}

const BLOCKED_AVAILABILITY: Record<string, ErrorCode> = {
  private: 'MEDIA_PRIVATE',
  premium_only: 'LOGIN_REQUIRED',
  subscriber_only: 'LOGIN_REQUIRED',
  needs_auth: 'LOGIN_REQUIRED',
};

/** Policy gate applied to every metadata result before anything is offered for processing. */
export function evaluatePolicy(info: YtdlpInfo, maxDurationSeconds: number): ErrorCode | null {
  if (info._type === 'playlist' || info._type === 'multi_video') return 'PLAYLIST_UNSUPPORTED';
  if (info.availability && BLOCKED_AVAILABILITY[info.availability]) return BLOCKED_AVAILABILITY[info.availability]!;
  if ((info.age_limit ?? 0) >= 18) return 'AGE_RESTRICTED';
  if (info.is_live || ['is_live', 'is_upcoming', 'post_live'].includes(info.live_status ?? '')) {
    return 'LIVE_UNSUPPORTED';
  }
  const formats = info.formats ?? [];
  if (formats.length && formats.every((f) => f.has_drm === true || f.has_drm === 'maybe')) return 'DRM_PROTECTED';
  if (!usableFormats(formats).length && formats.length) return 'MEDIA_RESTRICTED';
  if (typeof info.duration === 'number' && info.duration > maxDurationSeconds) return 'DURATION_TOO_LONG';
  return null;
}

export function usableFormats(formats: YtdlpFormat[]): YtdlpFormat[] {
  return formats.filter(
    (f) =>
      !f.has_drm &&
      f.format_id &&
      f.protocol !== 'mhtml' &&
      !/storyboard/i.test(f.format_note ?? '') &&
      !(f.vcodec === 'none' && f.acodec === 'none'),
  );
}

const size = (f: YtdlpFormat) => f.filesize ?? f.filesize_approx ?? null;

export function summarizeFormats(formats: YtdlpFormat[]): FormatSummary[] {
  return usableFormats(formats)
    .map((f): FormatSummary => {
      const hasV = !!f.vcodec && f.vcodec !== 'none';
      const hasA = !!f.acodec && f.acodec !== 'none';
      return {
        id: String(f.format_id).slice(0, 32),
        kind: hasV && hasA ? 'muxed' : hasV ? 'video' : 'audio',
        ext: String(f.ext ?? '').slice(0, 8),
        height: typeof f.height === 'number' ? f.height : null,
        fps: typeof f.fps === 'number' ? Math.round(f.fps) : null,
        abr: typeof f.abr === 'number' ? Math.round(f.abr) : null,
        vcodec: hasV ? String(f.vcodec).split('.')[0]!.slice(0, 16) : null,
        acodec: hasA ? String(f.acodec).split('.')[0]!.slice(0, 16) : null,
        filesize: size(f),
      };
    })
    .slice(0, 80);
}

export const QUALITY_HEIGHTS: Record<Exclude<Quality, 'best' | 'audio'>, number> = {
  '2160': 2160,
  '1440': 1440,
  '1080': 1080,
  '720': 720,
  '480': 480,
};

/** Best-effort output size estimates per quality (video stream + best audio). */
export function estimateSizes(formats: FormatSummary[]): Partial<Record<Quality, number | null>> {
  const audio = formats.filter((f) => f.kind === 'audio').sort((a, b) => (b.abr ?? 0) - (a.abr ?? 0))[0];
  const audioSize = audio?.filesize ?? null;
  const out: Partial<Record<Quality, number | null>> = { audio: audioSize };

  const pick = (maxH: number) =>
    formats
      .filter((f) => (f.kind === 'video' || f.kind === 'muxed') && (f.height ?? 0) <= maxH)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0) || (b.filesize ?? 0) - (a.filesize ?? 0))[0];

  const est = (f: FormatSummary | undefined) => {
    if (!f?.filesize) return null;
    return f.kind === 'muxed' ? f.filesize : f.filesize + (audioSize ?? 0);
  };

  out.best = est(pick(Infinity));
  for (const [q, h] of Object.entries(QUALITY_HEIGHTS)) out[q as Quality] = est(pick(h));
  return out;
}

export function availableHeights(formats: FormatSummary[]): number[] {
  return [...new Set(formats.filter((f) => f.height && f.kind !== 'audio').map((f) => f.height!))].sort((a, b) => b - a);
}

export function pickThumbnail(info: YtdlpInfo): string | null {
  const candidates = [info.thumbnail, ...(info.thumbnails ?? []).map((t) => t.url)].filter(
    (u): u is string => typeof u === 'string' && /^https:\/\//.test(u),
  );
  return candidates[0] ?? null;
}

/** True when the selected option can actually be produced from what the source offers. */
export function optionAvailable(options: ProcessOptions, heights: number[], hasAudio: boolean, hasVideo: boolean): boolean {
  if (options.mediaType === 'audio') return hasAudio;
  if (options.mediaType === 'thumbnail') return true;
  if (!hasVideo) return false;
  if (options.quality === 'best' || options.quality === 'audio') return true;
  const want = QUALITY_HEIGHTS[options.quality];
  // Never label an upscale: the source must reach this rung (±10% for odd encodes)
  // and offer something at or below it for the height<=N selector to pick.
  return heights.some((h) => h >= want * 0.9) && heights.some((h) => h <= want * 1.1);
}
