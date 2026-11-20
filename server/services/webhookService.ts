import { isIP } from 'node:net';
import type { WebhookEvent } from '../../shared/types.js';
import type { Store } from '../db/store.js';
import { AppError } from '../http/appError.js';
import { logger } from '../logger.js';
import { isBlockedIp } from '../security/ip.js';
import { randomToken } from '../security/passwords.js';
import { SecretBox, signWebhook } from '../security/secretBox.js';
import { assertPublicHost, type Resolver } from '../security/urlPolicy.js';

export async function validateWebhookUrl(raw: string, resolver?: Resolver): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new AppError('VALIDATION_FAILED', { field: 'url' });
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) {
    throw new AppError('VALIDATION_FAILED', { field: 'url', reason: 'https-443-only' });
  }
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new AppError('VALIDATION_FAILED', { field: 'url', reason: 'private-address' });
  } else {
    await assertPublicHost(host, resolver).catch(() => {
      throw new AppError('VALIDATION_FAILED', { field: 'url', reason: 'unresolvable-or-private' });
    });
  }
  u.hash = '';
  return u.toString();
}

/**
 * Signed webhook delivery: header `X-RajarX-Signature: t=<unix>,v1=<hex hmac>` over
 * "<t>.<body>". Destination is SSRF-checked at configuration time and again on delivery.
 */
export class WebhookService {
  private readonly box: SecretBox;

  constructor(
    private readonly store: Store,
    masterSecret: string,
    private readonly resolver?: Resolver,
  ) {
    this.box = new SecretBox(masterSecret);
  }

  async get(userId: string) {
    const w = await this.store.getWebhook(userId);
    return { url: w?.url ?? null, events: w?.events ?? [], hasSecret: !!w?.secretEnc };
  }

  /** Saves config. Returns a new signing secret (shown once) when one is created or rotated. */
  async configure(userId: string, url: string | null, events: WebhookEvent[], rotate = false) {
    const existing = await this.store.getWebhook(userId);
    const cleanUrl = url ? await validateWebhookUrl(url, this.resolver) : null;
    let secret: string | null = null;
    let secretEnc = existing?.secretEnc ?? null;
    if (cleanUrl && (!secretEnc || rotate)) {
      secret = `whsec_${randomToken(24)}`;
      secretEnc = this.box.seal(secret);
    }
    await this.store.upsertWebhook({ userId, url: cleanUrl, events, secretEnc, updatedAt: new Date() });
    return { url: cleanUrl, events, secret };
  }

  emit(userId: string | null, event: WebhookEvent, data: Record<string, unknown>) {
    if (!userId) return;
    void this.deliver(userId, event, data).catch((err) => logger.warn('Webhook delivery failed', { event, err }));
  }

  private async deliver(userId: string, event: WebhookEvent, data: Record<string, unknown>) {
    const w = await this.store.getWebhook(userId);
    if (!w?.url || !w.secretEnc || !w.events.includes(event)) return;
    await validateWebhookUrl(w.url, this.resolver);
    const secret = this.box.open(w.secretEnc);
    const body = JSON.stringify({ event, createdAt: new Date().toISOString(), data });

    for (let attempt = 0; attempt < 3; attempt++) {
      const t = Math.floor(Date.now() / 1000);
      try {
        const res = await fetch(w.url, {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(5000),
          headers: {
            'content-type': 'application/json',
            'user-agent': 'RAJAR-X-Webhooks/1.0',
            'x-rajarx-event': event,
            'x-rajarx-signature': `t=${t},v1=${signWebhook(secret, t, body)}`,
          },
          body,
        });
        if (res.status >= 200 && res.status < 300) return;
        if (res.status >= 400 && res.status < 500 && res.status !== 429) return; // receiver rejected; don't hammer
      } catch {
        /* retry */
      }
      await new Promise((r) => setTimeout(r, 1000 * 4 ** attempt));
    }
    logger.warn('Webhook gave up after retries', { event, userId });
  }
}
