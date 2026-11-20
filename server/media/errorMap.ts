import type { ErrorCode } from '../../shared/errors.js';
import type { RunResult } from './runProcess.js';

/**
 * Maps raw yt-dlp output to stable error codes. Order matters: the most specific
 * restriction wins. Raw stderr is never shown to users.
 */
const YTDLP_RULES: [RegExp, ErrorCode][] = [
  [/drm|widevine|playready|fairplay/i, 'DRM_PROTECTED'],
  [/private video|this video is private|is private|private account|account is private/i, 'MEDIA_PRIVATE'],
  [/age[- ]?restricted|confirm your age|inappropriate for some users|age verification|age_limit/i, 'AGE_RESTRICTED'],
  [/available in your (country|region|location)|geo[- ]?restrict|blocked it in your country/i, 'GEO_RESTRICTED'],
  [/not a bot|confirm you.re not a robot|unusual traffic|automated queries/i, 'PLATFORM_BOT_CHECK'],
  [
    /members[- ]only|join this channel|premium members|requires payment|purchase|rental|subscriber[s]?[- ]only/i,
    'LOGIN_REQUIRED',
  ],
  [
    /sign in|log ?in|login required|authentication|use --cookies|cookies-from-browser|account credentials|rate-limit reached.*login|requires authorization/i,
    'LOGIN_REQUIRED',
  ],
  [/is live|live event|premieres in|will begin in|live stream|is_upcoming|post_live/i, 'LIVE_UNSUPPORTED'],
  [/ffmpeg not found|ffprobe and ffmpeg not found|ffmpeg is not installed/i, 'FFMPEG_UNAVAILABLE'],
  [/file is larger than max-filesize|max-filesize/i, 'FILE_TOO_LARGE'],
  [/requested format is not available|no video formats found|format is not available/i, 'FORMAT_UNAVAILABLE'],
  [/unsupported url|no suitable extractor/i, 'UNSUPPORTED_PLATFORM'],
  [/http error 429|too many requests/i, 'RATE_LIMITED'],
  [
    /video unavailable|has been removed|no longer available|does not exist|not found|http error 404|http error 410|copyright claim|terminated|content isn.t available|removed by the uploader/i,
    'MEDIA_UNAVAILABLE',
  ],
  [/no space left on device|disk quota/i, 'STORAGE_UNAVAILABLE'],
  [
    /unable to download|timed out|timeout|connection (reset|refused|aborted)|name resolution|network is unreachable|ssl|getaddrinfo|http error 5\d\d|remote end closed/i,
    'NETWORK_FAILURE',
  ],
];

export function mapYtdlpText(text: string): ErrorCode {
  for (const [re, code] of YTDLP_RULES) if (re.test(text)) return code;
  return 'PROCESSING_FAILED';
}

export function mapYtdlpResult(r: RunResult): ErrorCode | null {
  if (r.spawnError)
    return r.spawnError.code === 'ENOENT' || r.spawnError.code === 'EACCES' ? 'YTDLP_UNAVAILABLE' : 'PROCESSING_FAILED';
  if (r.aborted) return 'PROCESSING_CANCELLED';
  if (r.timedOut) return 'PROCESSING_TIMEOUT';
  if (r.truncated) return 'PROCESSING_FAILED';
  if (r.code === 0) return null;
  // yt-dlp prints the decisive reason on lines starting with "ERROR:".
  const errorLines = r.stderr
    .split('\n')
    .filter((l) => /^ERROR:/i.test(l.trim()))
    .join('\n');
  return mapYtdlpText(errorLines || r.stderr);
}

const FFMPEG_RULES: [RegExp, ErrorCode][] = [
  [/no space left on device|disk quota/i, 'STORAGE_UNAVAILABLE'],
  [/invalid data found|could not find codec|unknown encoder|decoder .* not found|moov atom not found/i, 'PROCESSING_FAILED'],
  [/permission denied/i, 'STORAGE_UNAVAILABLE'],
];

export function mapFfmpegResult(r: RunResult): ErrorCode | null {
  if (r.spawnError)
    return r.spawnError.code === 'ENOENT' || r.spawnError.code === 'EACCES' ? 'FFMPEG_UNAVAILABLE' : 'PROCESSING_FAILED';
  if (r.aborted) return 'PROCESSING_CANCELLED';
  if (r.timedOut) return 'PROCESSING_TIMEOUT';
  if (r.code === 0) return null;
  for (const [re, code] of FFMPEG_RULES) if (re.test(r.stderr)) return code;
  return 'PROCESSING_FAILED';
}

/** Errors worth an automatic retry (transient). Restrictions are never retried. */
export const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['NETWORK_FAILURE', 'PROCESSING_FAILED']);

/** Errors that mean the content itself is off-limits → job status "blocked", not "failed". */
export const BLOCKING: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'MEDIA_PRIVATE',
  'MEDIA_RESTRICTED',
  'LOGIN_REQUIRED',
  'DRM_PROTECTED',
  'AGE_RESTRICTED',
  'GEO_RESTRICTED',
  'LIVE_UNSUPPORTED',
  'PLAYLIST_UNSUPPORTED',
  'UNSUPPORTED_PLATFORM',
  'DURATION_TOO_LONG',
  'FILE_TOO_LARGE',
]);
