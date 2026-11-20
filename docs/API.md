# RAJAR X API v1

The integration API uses the same validation, restrictions and safe-use policy as the dashboard. **Analyze first. Process only what you’re allowed to use.** The same reference is available in the app at `/docs`.

## Authentication

```http
Authorization: Bearer $RAJAR_X_API_KEY
```

- Keys look like `rjar_live_` followed by 40 base62 characters. They are created in **API Keys**, shown **once**, and stored only as an HMAC-SHA-256 hash with a server-side pepper.
- Load keys from an environment variable. Never commit them, paste them in screenshots, or ship them to browsers.
- Cookies never authenticate `/api/v1`, and bearer keys never authenticate the dashboard routes.
- Link-style clients may pass the key as `?key=` or `?api_key=` instead of the header. The server removes it from the request and redacts it from logs and audit entries, but URLs can leak through browser history and proxies — prefer the header.

## Scopes

| Scope | Grants |
|---|---|
| `analyze` *(default)* | `POST /api/v1/analyze` |
| `activity` *(default)* | `GET /api/v1/activity`, `GET /api/v1/jobs/:id` |
| `process` | `POST /api/v1/process`, `GET /api/v1/jobs/:id`, `POST /api/v1/jobs/:id/cancel`, `GET /api/v1/jobs/:id/file` |
| `webhooks` | `GET/PUT /api/v1/webhook` |
| `admin` | `GET /api/v1/admin/overview`. Owner/admin accounts only, and only when `ADMIN_SCOPE_ENABLED=true`. Never granted to normal users. |

## Rate limits and quotas

- Per key: 30, 60, 120 or 300 requests/minute (chosen at creation). Admins can set any custom value (`PUT /api/admin/keys/:id/limit` with `{"rateLimitPerMinute": 5000}`) or make a key unlimited (`{"rateLimitPerMinute": null}`). Unlimited keys skip per-key, per-IP media and daily job limits; jobs still queue behind `MEDIA_CONCURRENCY` workers.
- Per IP on media endpoints: `RATE_LIMIT_MAX_REQUESTS` per `RATE_LIMIT_WINDOW_SECONDS`.
- Per account: `USER_DAILY_JOB_QUOTA` jobs per rolling 24 h and `USER_MAX_ACTIVE_JOBS` concurrent jobs.
- Limited calls return `429` with `RATE_LIMITED` or `QUOTA_EXCEEDED` and a `Retry-After` header.

## Endpoints

| Method | Path | Scope | Notes |
|---|---|---|---|
| POST | `/api/v1/analyze` | analyze | Body `{ "url": string }`. Returns metadata, formats, size estimates and safe-use status. Never downloads. |
| GET | `/api/v1/analyze?url=…` | analyze | Same, for link-style clients. |
| POST | `/api/v1/process` | process | Body `{ "url", "options", "rightsConfirmed": true }`. Returns a job (`202`). |
| GET | `/api/v1/jobs/:id` | process or activity | Status, progress, error code, output name and size, expiry. |
| POST | `/api/v1/jobs/:id/cancel` | process | Cancels a `queued` or `active` job. |
| GET | `/api/v1/jobs/:id/file` | process | One-time download while the job is `ready`. The file is deleted from the server once fully sent (job becomes `completed`). |
| GET | `/api/v1/activity` | activity | Query: `platform`, `status`, `limit` (≤50), `cursor`. |
| GET | `/api/v1/key-info` | any | The calling key's name, masked prefix, scopes and limit. |
| GET / PUT | `/api/v1/webhook` | webhooks | Body `{ "url": string or null, "events": [...], "rotateSecret"?: boolean }`. |
| GET | `/api/v1/admin/overview` | admin | System totals and health. |

### Process options

```json
{
  "mediaType": "video | audio | thumbnail",
  "container": "mp4 | webm",
  "audioFormat": "mp3 | m4a | wav",
  "quality": "best | 2160 | 1440 | 1080 | 720 | 480",
  "audioMode": "original | highest | normalized",
  "audioBitrate": "auto | 128 | 192 | 256 | 320",
  "embedMetadata": true,
  "embedThumbnail": false,
  "subtitleLang": null
}
```

A quality is accepted only if the source actually offers it, so RAJAR X never labels an upscale. `subtitleLang` must be one of the uploader-published languages that analysis returned. Auto-generated captions are never used.

### Job lifecycle

`queued → active → ready → completed → expired`. `completed` means the file was downloaded and has already been deleted. A job can also end as `blocked` (policy or restriction), `failed` (no file produced) or `cancelled`. A job is `ready` only after the processor has written a real file. Files are deleted after `MEDIA_RETENTION_MINUTES`.

## Response envelope

```json
{ "success": true,  "requestId": "req_…", "data": { }, "error": null }
{ "success": false, "requestId": "req_…", "data": null,
  "error": { "code": "MEDIA_RESTRICTED", "message": "…", "nextAction": "…" } }
```

Log the `requestId`. Admins can trace a request with it in the control center.

## Error codes

`INVALID_URL`, `UNSUPPORTED_PLATFORM`, `PLAYLIST_UNSUPPORTED`, `LIVE_UNSUPPORTED`, `MEDIA_UNAVAILABLE`, `MEDIA_RESTRICTED`, `MEDIA_PRIVATE`, `LOGIN_REQUIRED`, `PLATFORM_BOT_CHECK`, `DRM_PROTECTED`, `AGE_RESTRICTED`, `GEO_RESTRICTED`, `RATE_LIMITED`, `QUOTA_EXCEEDED`, `PROCESSING_TIMEOUT`, `PROCESSING_FAILED`, `PROCESSING_CANCELLED`, `FFMPEG_UNAVAILABLE`, `YTDLP_UNAVAILABLE`, `FILE_TOO_LARGE`, `DURATION_TOO_LONG`, `STORAGE_UNAVAILABLE`, `NETWORK_FAILURE`, `API_KEY_INVALID`, `API_KEY_REVOKED`, `API_KEY_LIMIT`, `SCOPE_MISSING`, `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `EMAIL_TAKEN`, `FORBIDDEN`, `CSRF_FAILED`, `VALIDATION_FAILED`, `NOT_FOUND`, `JOB_NOT_READY`, `JOB_EXPIRED`, `FORMAT_UNAVAILABLE`, `SERVER_MAINTENANCE`, `ANONYMOUS_DISABLED`, `INTERNAL_ERROR`.

The messages and next actions are defined in `shared/errors.ts`, and the in-app docs page renders them.

## Webhooks

Events: `job.queued`, `job.ready`, `job.failed`, `job.blocked`, `job.cancelled`.

Each delivery is an HTTPS `POST` with these headers:

```
X-RajarX-Event: job.ready
X-RajarX-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
```

Destinations must be HTTPS on port 443 and must resolve to public addresses. Deliveries time out after 5 s and retry up to 3 times. Verify the signature and reject timestamps older than 5 minutes.

## Examples

```bash
curl -sS -X POST "$RAJAR_X_BASE_URL/api/v1/analyze" \
  -H "Authorization: Bearer $RAJAR_X_API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/watch?v=VIDEO_ID"}'
```

The in-app docs have JavaScript and Python examples. `examples/whatsapp-md-bot/` has a complete WhatsApp MD bot.
