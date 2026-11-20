/**
 * Transport-agnostic bot logic. Wire it to any WhatsApp MD library (see baileys.mjs).
 * Safety properties:
 *  - only allow-listed senders / groups are served; everyone else is ignored silently
 *  - one URL per message, public http(s) links only; no batch / auto-processing of arbitrary links
 *  - per-sender cooldown and one pending request at a time
 *  - every reply carries a safe-use notice; results are sent only when processing succeeded
 *  - logs contain request IDs only — never API keys or message contents
 */
export const SAFE_USE_NOTICE =
  '⚖️ Only process media you own or are authorized to use. A public link does not mean unrestricted use.';

const URL_RE = /https?:\/\/[^\s<>"']{4,2048}/gi;

export function extractSingleUrl(text) {
  const matches = String(text ?? '').match(URL_RE) ?? [];
  return matches.length === 1 ? matches[0] : null;
}

export function formatDuration(s) {
  if (s == null) return 'unknown';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export class Cooldown {
  constructor(seconds) {
    this.ms = seconds * 1000;
    this.last = new Map();
  }
  allow(id, now = Date.now()) {
    const prev = this.last.get(id);
    if (prev !== undefined && now - prev < this.ms) return false;
    this.last.set(id, now);
    if (this.last.size > 10_000) this.last.clear();
    return true;
  }
}

const CHOICES = {
  audio: { mediaType: 'audio', audioFormat: 'mp3' },
  mp3: { mediaType: 'audio', audioFormat: 'mp3' },
  m4a: { mediaType: 'audio', audioFormat: 'm4a' },
  480: { mediaType: 'video', container: 'mp4', quality: '480' },
  720: { mediaType: 'video', container: 'mp4', quality: '720' },
  thumb: { mediaType: 'thumbnail' },
};

export function createBot({ client, allowedUsers, allowedGroups, maxFileBytes, cooldownSeconds = 60, log = console }) {
  const cooldown = new Cooldown(cooldownSeconds);
  const pending = new Map(); // sender → { media, expires }

  // Direct messages: the sender must be allow-listed.
  // Groups: the group must be allow-listed, and if a user list exists the sender must be on it too.
  const permitted = (sender, group) =>
    group ? allowedGroups.has(group) && (allowedUsers.size === 0 || allowedUsers.has(sender)) : allowedUsers.has(sender);

  return async function onMessage({ sender, group, text, reply, sendFile }) {
    if (!permitted(sender, group)) return; // unknown users/groups: ignored, never processed

    const choice = String(text ?? '')
      .trim()
      .toLowerCase();
    const waiting = pending.get(sender);
    if (waiting && Date.now() < waiting.expires && CHOICES[choice]) {
      pending.delete(sender);
      try {
        const job = await client.process(waiting.media.sourceUrl, CHOICES[choice]);
        await reply(`⚙️ Processing… (ref ${job.requestId})`);
        const done = await client.waitForJob(job.id);
        if (done.status !== 'ready') {
          return reply(`❌ ${done.errorMessage ?? 'Processing did not complete.'} (ref ${done.requestId})\n${SAFE_USE_NOTICE}`);
        }
        if ((done.outputSizeBytes ?? 0) > maxFileBytes) return reply('📦 The file is larger than this bot is allowed to send.');
        const file = await client.downloadFile(done.id, maxFileBytes);
        await sendFile(file.buffer, done.outputFilename ?? 'rajar-x-media', file.mimetype, SAFE_USE_NOTICE);
        log.info?.('[rajar-bot] delivered', { requestId: done.requestId });
      } catch (err) {
        log.warn?.('[rajar-bot] process failed', { code: err.code, requestId: err.requestId });
        await reply(`❌ ${err.message}${err.requestId ? ` (ref ${err.requestId})` : ''}`);
      }
      return;
    }

    const url = extractSingleUrl(text);
    if (!url) return;
    if (!cooldown.allow(sender)) return reply('⏳ Please wait a minute before sending another link.');

    try {
      const media = await client.analyze(url);
      pending.set(sender, { media, expires: Date.now() + 5 * 60_000 });
      const heights =
        (media.availableHeights ?? [])
          .slice(0, 3)
          .map((h) => `${h}p`)
          .join(', ') || 'audio only';
      await reply(
        `🎬 *${media.title}*\n⏱ ${formatDuration(media.durationSeconds)} · ${media.platformName}\n📐 ${heights}\n\n` +
          `Reply with: *audio*, *m4a*, *480*, *720* or *thumb* (within 5 min).\n${SAFE_USE_NOTICE}`,
      );
    } catch (err) {
      log.warn?.('[rajar-bot] analyze failed', { code: err.code, requestId: err.requestId });
      await reply(`🚫 ${err.message}${err.requestId ? ` (ref ${err.requestId})` : ''}`);
    }
  };
}
