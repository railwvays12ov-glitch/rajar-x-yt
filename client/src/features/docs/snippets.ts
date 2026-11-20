/** Code samples for the API docs. Keys are always read from environment variables. */
export const snippets = (base: string) => ({
  curlAnalyze: `curl -sS -X POST ${base}/api/v1/analyze \\
  -H "Authorization: Bearer $RAJAR_X_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://www.youtube.com/watch?v=VIDEO_ID"}'`,

  curlProcess: `curl -sS -X POST ${base}/api/v1/process \\
  -H "Authorization: Bearer $RAJAR_X_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://www.youtube.com/watch?v=VIDEO_ID",
    "rightsConfirmed": true,
    "options": { "mediaType": "audio", "audioFormat": "mp3", "audioMode": "normalized" }
  }'

# Poll until status is "ready", then fetch the file:
curl -sS ${base}/api/v1/jobs/JOB_ID -H "Authorization: Bearer $RAJAR_X_API_KEY"
curl -sS -OJ ${base}/api/v1/jobs/JOB_ID/file -H "Authorization: Bearer $RAJAR_X_API_KEY"`,

  js: `// Node 18+ — key comes from the environment, never from source code.
const BASE = '${base}';
const KEY = process.env.RAJAR_X_API_KEY;

async function rajar(path, body) {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: \`Bearer \${KEY}\`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json();
  if (!json.success) throw Object.assign(new Error(json.error.message), json.error, { requestId: json.requestId });
  return json.data;
}

const media = await rajar('/api/v1/analyze', { url: 'https://www.youtube.com/watch?v=VIDEO_ID' });
console.log(media.title, media.durationSeconds, media.availableHeights);

const job = await rajar('/api/v1/process', {
  url: media.sourceUrl,
  rightsConfirmed: true,
  options: { mediaType: 'video', container: 'mp4', quality: '720' },
});
let state = job;
while (['queued', 'active'].includes(state.status)) {
  await new Promise((r) => setTimeout(r, 2000));
  state = await rajar(\`/api/v1/jobs/\${job.id}\`);
}
console.log(state.status, state.errorCode ?? '');`,

  python: `import os, time, requests

BASE = "${base}"
HEADERS = {"Authorization": f"Bearer {os.environ['RAJAR_X_API_KEY']}"}

def rajar(method, path, **kw):
    r = requests.request(method, BASE + path, headers=HEADERS, timeout=15, **kw)
    body = r.json()
    if not body["success"]:
        err = body["error"]
        raise RuntimeError(f"{err['code']}: {err['message']} (request {body['requestId']})")
    return body["data"]

media = rajar("POST", "/api/v1/analyze", json={"url": "https://www.youtube.com/watch?v=VIDEO_ID"})
job = rajar("POST", "/api/v1/process", json={
    "url": media["sourceUrl"],
    "rightsConfirmed": True,
    "options": {"mediaType": "audio", "audioFormat": "m4a"},
})
while job["status"] in ("queued", "active"):
    time.sleep(2)
    job = rajar("GET", f"/api/v1/jobs/{job['id']}")

if job["status"] == "ready":
    with requests.get(f"{BASE}/api/v1/jobs/{job['id']}/file", headers=HEADERS, stream=True, timeout=60) as f:
        f.raise_for_status()
        with open(job["outputFilename"], "wb") as out:
            for chunk in f.iter_content(1 << 16):
                out.write(chunk)`,

  whatsapp: `// examples/whatsapp-md-bot — excerpt. Full source ships with the project.
import { RajarClient } from './rajarClient.js';

const rajar = new RajarClient({
  baseUrl: process.env.RAJAR_X_BASE_URL,
  apiKey: process.env.RAJAR_X_API_KEY,      // never hard-code keys
  timeoutMs: 15_000,
  maxRetries: 3,                            // exponential backoff on 429/5xx/network
});

const ALLOWED_USERS = new Set((process.env.BOT_ALLOWED_USERS ?? '').split(',').filter(Boolean));
const ALLOWED_GROUPS = new Set((process.env.BOT_ALLOWED_GROUPS ?? '').split(',').filter(Boolean));
const MAX_BYTES = Number(process.env.BOT_MAX_FILE_BYTES ?? 64 * 1024 * 1024);
const NOTICE = '⚖️ Only process media you own or are authorized to use. Public ≠ unrestricted.';

export async function onMessage({ sender, group, text, reply, sendFile }) {
  // 1. Permission check — unknown users/groups are ignored, never processed.
  if (!ALLOWED_USERS.has(sender) && !(group && ALLOWED_GROUPS.has(group))) return;
  // 2. Per-sender cooldown to prevent abuse.
  if (!cooldown.allow(sender)) return reply('⏳ Slow down — try again in a minute.');

  const url = extractSingleUrl(text);
  if (!url) return;

  const media = await rajar.analyze(url);                       // 3. analyze
  await reply(\`🎬 \${media.title}\\n⏱ \${fmt(media.durationSeconds)}\\n\` +
    \`Reply "audio" or "720" to process.\\n\${NOTICE}\`);       // 4. show details + notice

  const choice = await waitForChoice(sender);                    // 5. user selects
  const job = await rajar.process(media.sourceUrl, toOptions(choice));  // 6. process
  const done = await rajar.waitForJob(job.id);
  if (done.status !== 'ready') return reply(\`❌ \${done.errorMessage} (ref \${done.requestId})\`);
  if ((done.outputSizeBytes ?? 0) > MAX_BYTES) return reply('📦 File is larger than this bot allows.');

  await sendFile(await rajar.downloadFile(job.id), done.outputFilename, NOTICE); // 7. only on success
  console.log('[rajar] delivered', { requestId: done.requestId });  // 8. log request ID, never the key
}`,

  webhookVerify: `import crypto from 'node:crypto';

// Header: X-RajarX-Signature: t=1700000000,v1=<hex>
export function verifyRajarSignature(rawBody, header, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.v1 ?? '', 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}`,

  success: `{
  "success": true,
  "requestId": "req_3f9KcW1sPq2LmZ7a",
  "data": { "...": "..." },
  "error": null
}`,

  failure: `{
  "success": false,
  "requestId": "req_3f9KcW1sPq2LmZ7a",
  "data": null,
  "error": {
    "code": "MEDIA_RESTRICTED",
    "message": "This media cannot be processed because it is restricted or unavailable.",
    "nextAction": "Only public media you own or are authorized to use can be processed."
  }
}`,
});
