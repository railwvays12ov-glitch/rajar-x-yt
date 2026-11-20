import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

/** AES-256-GCM for small server-side secrets (e.g. webhook signing secrets). */
export class SecretBox {
  private readonly key: Buffer;

  constructor(masterSecret: string) {
    this.key = createHash('sha256').update(`rajar-x:secretbox:${masterSecret}`).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
  }

  open(sealed: string): string {
    const [iv, tag, enc] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv!);
    decipher.setAuthTag(tag!);
    return Buffer.concat([decipher.update(enc!), decipher.final()]).toString('utf8');
  }
}

export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** Salted IP hash for audit logs — lets admins correlate abuse without storing raw IPs. */
export function hashIp(ip: string | undefined, salt: string): string | null {
  if (!ip) return null;
  return createHmac('sha256', salt).update(ip).digest('hex').slice(0, 24);
}
