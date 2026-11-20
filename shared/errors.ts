/**
 * Stable, machine-readable error catalog shared by the API, the job system and the UI.
 * Messages are human-readable and never contain technical internals.
 */
export const ERROR_CATALOG = {
  INVALID_URL: {
    status: 400,
    message: "That doesn't look like a valid public media link.",
    nextAction: 'Paste a full https:// link to a single public post or video.',
  },
  UNSUPPORTED_PLATFORM: {
    status: 422,
    message: 'This source is not on the RAJAR X supported list.',
    nextAction: 'Use a link from one of the supported platforms shown on the dashboard.',
  },
  PLAYLIST_UNSUPPORTED: {
    status: 422,
    message: 'Playlists, channels and feeds are not processed as a batch.',
    nextAction: 'Open the single video or post you are authorized to use and paste that link.',
  },
  LIVE_UNSUPPORTED: {
    status: 422,
    message: 'Live streams and premieres cannot be processed.',
    nextAction: 'Wait until the stream has ended and a public replay is available.',
  },
  MEDIA_UNAVAILABLE: {
    status: 404,
    message: 'This media is unavailable, removed, or not yet published.',
    nextAction: 'Check that the link opens publicly in a private browser window.',
  },
  MEDIA_RESTRICTED: {
    status: 403,
    message: 'This media cannot be processed because it is restricted or unavailable.',
    nextAction: 'Only public media you own or are authorized to use can be processed.',
  },
  MEDIA_PRIVATE: {
    status: 403,
    message: 'This media is private. RAJAR X never processes private content.',
    nextAction: 'If this is your content, make it public or export it from the platform directly.',
  },
  LOGIN_REQUIRED: {
    status: 403,
    message: 'This media requires a login or membership to view.',
    nextAction: 'RAJAR X does not sign in to platforms. Use the platform’s own export tools.',
  },
  PLATFORM_BOT_CHECK: {
    status: 503,
    message: 'The platform blocked this server’s network with a bot check. The media itself may be public.',
    nextAction: 'Try again later. If it keeps happening, the server operator should run RAJAR X from a different network.',
  },
  DRM_PROTECTED: {
    status: 403,
    message: 'This media is DRM-protected and cannot be processed.',
    nextAction: 'Use the official app or purchase channel provided by the rights holder.',
  },
  AGE_RESTRICTED: {
    status: 403,
    message: 'This media is age-restricted and is blocked by RAJAR X policy.',
    nextAction: 'Age-gated content is not processed. Choose a different, unrestricted item.',
  },
  GEO_RESTRICTED: {
    status: 403,
    message: 'This media is not available in the server’s region.',
    nextAction: 'RAJAR X does not bypass regional restrictions.',
  },
  RATE_LIMITED: {
    status: 429,
    message: 'Too many requests. Slow down for a moment.',
    nextAction: 'Wait for the rate-limit window to reset, then try again.',
  },
  QUOTA_EXCEEDED: {
    status: 429,
    message: 'You have reached your processing quota.',
    nextAction: 'Wait for your quota to reset, or let an active job finish first.',
  },
  PROCESSING_TIMEOUT: {
    status: 504,
    message: 'Processing took too long and was stopped.',
    nextAction: 'Try a lower quality or a shorter piece of media.',
  },
  PROCESSING_FAILED: {
    status: 500,
    message: 'Processing failed before a file could be produced.',
    nextAction: 'Retry once. If it fails again, try a different format.',
  },
  PROCESSING_CANCELLED: {
    status: 409,
    message: 'This job was cancelled.',
    nextAction: 'Start a new job when you are ready.',
  },
  FFMPEG_UNAVAILABLE: {
    status: 503,
    message: 'The media converter is not available on this server.',
    nextAction: 'An administrator needs to install FFmpeg. Metadata analysis may still work.',
  },
  YTDLP_UNAVAILABLE: {
    status: 503,
    message: 'The media engine is not available on this server.',
    nextAction: 'An administrator needs to install yt-dlp and set YTDLP_BIN.',
  },
  FILE_TOO_LARGE: {
    status: 413,
    message: 'The output would exceed this server’s file-size limit.',
    nextAction: 'Choose a lower quality or audio-only output.',
  },
  DURATION_TOO_LONG: {
    status: 413,
    message: 'This media is longer than this server’s duration limit.',
    nextAction: 'Choose shorter media, or ask an administrator about the limit.',
  },
  STORAGE_UNAVAILABLE: {
    status: 507,
    message: 'Temporary storage is unavailable right now.',
    nextAction: 'Try again in a few minutes.',
  },
  NETWORK_FAILURE: {
    status: 502,
    message: 'The source could not be reached.',
    nextAction: 'Check the link and try again shortly.',
  },
  API_KEY_INVALID: {
    status: 401,
    message: 'The API key is missing or invalid.',
    nextAction: 'Send a valid key as "Authorization: Bearer rjar_live_…".',
  },
  API_KEY_REVOKED: {
    status: 401,
    message: 'This API key has been revoked.',
    nextAction: 'Create a new key in the RAJAR X API Keys section.',
  },
  API_KEY_LIMIT: {
    status: 409,
    message: 'You have reached the maximum number of active API keys.',
    nextAction: 'Revoke a key you no longer use, then create a new one.',
  },
  SCOPE_MISSING: {
    status: 403,
    message: 'This API key does not have the scope required for this endpoint.',
    nextAction: 'Create a key that includes the required scope.',
  },
  UNAUTHENTICATED: {
    status: 401,
    message: 'Please sign in to continue.',
    nextAction: 'Sign in or create a RAJAR X account.',
  },
  INVALID_CREDENTIALS: {
    status: 401,
    message: 'Email or password is incorrect.',
    nextAction: 'Check your details and try again.',
  },
  EMAIL_TAKEN: {
    status: 409,
    message: 'An account with this email already exists.',
    nextAction: 'Sign in instead, or use a different email.',
  },
  FORBIDDEN: {
    status: 403,
    message: 'You do not have permission to do that.',
    nextAction: 'Ask an owner or administrator if you need access.',
  },
  CSRF_FAILED: {
    status: 403,
    message: 'Your session security check failed.',
    nextAction: 'Reload the page and try again.',
  },
  VALIDATION_FAILED: {
    status: 400,
    message: 'Some of the submitted values are not valid.',
    nextAction: 'Review the highlighted fields and try again.',
  },
  NOT_FOUND: {
    status: 404,
    message: 'We could not find that.',
    nextAction: 'Check the address or ID and try again.',
  },
  JOB_NOT_READY: {
    status: 409,
    message: 'This job has no finished file yet.',
    nextAction: 'Wait until the job status is "ready".',
  },
  JOB_EXPIRED: {
    status: 410,
    message: 'This file has expired and was deleted from temporary storage.',
    nextAction: 'Start a new job to process the media again.',
  },
  FORMAT_UNAVAILABLE: {
    status: 422,
    message: 'The selected format or quality is not available for this media.',
    nextAction: 'Pick one of the options listed for this media.',
  },
  SERVER_MAINTENANCE: {
    status: 503,
    message: 'Processing is temporarily paused for maintenance.',
    nextAction: 'Metadata analysis may still work. Try processing again later.',
  },
  ANONYMOUS_DISABLED: {
    status: 401,
    message: 'This feature needs a RAJAR X account.',
    nextAction: 'Sign in to analyze, process and use API features.',
  },
  INTERNAL_ERROR: {
    status: 500,
    message: 'Something went wrong on our side.',
    nextAction: 'Try again. If it keeps happening, share the request ID with support.',
  },
} as const satisfies Record<string, { status: number; message: string; nextAction: string }>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value in ERROR_CATALOG;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  nextAction: string;
  details?: Record<string, unknown>;
}

export interface ApiEnvelope<T> {
  success: boolean;
  requestId: string;
  data: T | null;
  error: ApiErrorBody | null;
}
