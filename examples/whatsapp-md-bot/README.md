# RAJAR X — WhatsApp MD bot (reference)

A small, safe reference bot that lets **allow-listed** WhatsApp users analyze a public link and request an authorized output through the RAJAR X API.

```bash
cp .env.example .env        # fill RAJAR_X_BASE_URL, RAJAR_X_API_KEY, BOT_ALLOWED_USERS
npm install
node --env-file=.env baileys.mjs
npm test                    # unit tests for the bot logic (no WhatsApp connection needed)
```

Flow: user sends one public URL → sender permission check → `POST /api/v1/analyze` → bot replies with title, duration, qualities and a safe-use notice → user replies `audio`, `m4a`, `480`, `720` or `thumb` → `POST /api/v1/process` → poll → file is sent **only if** the job is `ready` and within `BOT_MAX_FILE_BYTES`.

Safety built in: allow-listed users/groups only (others are ignored), one URL per message, per-sender cooldown, request timeouts, exponential backoff, response validation, file-size cap, request-ID-only logging. The API key is read from `RAJAR_X_API_KEY` and is never written to source, logs or messages. There are no broadcast, mass-messaging or auto-join features — do not add them.

`bot-core.mjs` is transport-agnostic; `baileys.mjs` is one adapter. Baileys' API changes between releases, so check its docs if an import has moved.
