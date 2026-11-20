import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { API_SCOPES, type ApiScope, type UserRole } from '../../shared/types.js';

export const KEY_PREFIX = 'rjar_live_';
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SECRET_LENGTH = 40; // ~238 bits of entropy
export const KEY_PATTERN = /^rjar_live_[0-9A-Za-z]{40}$/;

/** Unbiased base62 via rejection sampling. */
function randomBase62(length: number): string {
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) out += BASE62[byte % 62];
      if (out.length === length) break;
    }
  }
  return out;
}

export interface GeneratedKey {
  /** Shown to the user exactly once. Never persisted, never logged. */
  raw: string;
  hash: string;
  displayPrefix: string;
}

/** Keyed one-way hash: HMAC-SHA-256 with a server-side pepper (stronger than bare SHA-256). */
export function hashApiKey(raw: string, pepper: string): string {
  return createHmac('sha256', pepper).update(raw, 'utf8').digest('hex');
}

export function maskKey(raw: string): string {
  const secret = raw.slice(KEY_PREFIX.length);
  return `${KEY_PREFIX}${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

export function generateApiKey(pepper: string): GeneratedKey {
  const raw = KEY_PREFIX + randomBase62(SECRET_LENGTH);
  return { raw, hash: hashApiKey(raw, pepper), displayPrefix: maskKey(raw) };
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return m ? m[1]! : null;
}

export function looksLikeKey(token: string): boolean {
  return KEY_PATTERN.test(token);
}

/**
 * Normalizes requested scopes. `admin` is only kept when the platform enables it
 * AND the account is owner/admin. Normal users can never receive it.
 */
export function sanitizeScopes(requested: ApiScope[], role: UserRole, adminScopeEnabled: boolean): ApiScope[] {
  const unique = [...new Set(requested)].filter((s) => (API_SCOPES as readonly string[]).includes(s));
  return unique.filter((s) => s !== 'admin' || (adminScopeEnabled && (role === 'admin' || role === 'owner')));
}

export function hasScope(granted: readonly ApiScope[], required: ApiScope): boolean {
  return granted.includes(required);
}
