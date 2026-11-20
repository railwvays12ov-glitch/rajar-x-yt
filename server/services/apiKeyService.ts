import { KEY_RATE_LIMIT_OPTIONS, type ApiKeyView, type ApiScope, type UserRole } from '../../shared/types.js';

const isAdminRole = (role: UserRole) => role === 'admin' || role === 'owner';
import type { ApiKeyRow, Store } from '../db/store.js';
import { AppError } from '../http/appError.js';
import { extractBearer, generateApiKey, hashApiKey, looksLikeKey, sanitizeScopes } from '../security/apiKeys.js';

export function toKeyView(k: ApiKeyRow): ApiKeyView {
  // Deliberately omits keyHash: list endpoints expose only the safe display prefix.
  return {
    id: k.id,
    name: k.name,
    displayPrefix: k.displayPrefix,
    scopes: k.scopes,
    rateLimitPerMinute: k.rateLimitPerMinute,
    status: k.revokedAt ? 'revoked' : 'active',
    createdAt: k.createdAt.toISOString(),
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    revokedAt: k.revokedAt?.toISOString() ?? null,
  };
}

export interface ApiKeyServiceDeps {
  store: Store;
  pepper: string;
  maxKeysPerUser: number;
  adminScopeEnabled: boolean;
}

export class ApiKeyService {
  constructor(private readonly deps: ApiKeyServiceDeps) {}

  async create(
    user: { id: string; role: UserRole },
    input: { name: string; scopes: ApiScope[]; rateLimitPerMinute: number | null },
  ): Promise<{ key: ApiKeyView; rawKey: string }> {
    const active = await this.deps.store.countApiKeys({ userId: user.id, status: 'active' });
    if (active >= this.deps.maxKeysPerUser) throw new AppError('API_KEY_LIMIT');

    // Normal users pick a preset limit; only owner/admin may set custom or unlimited (null) limits.
    if (!isAdminRole(user.role) && !(KEY_RATE_LIMIT_OPTIONS as readonly (number | null)[]).includes(input.rateLimitPerMinute)) {
      throw new AppError('FORBIDDEN', { reason: 'custom-limit-admin-only' });
    }
    const scopes = sanitizeScopes(input.scopes, user.role, this.deps.adminScopeEnabled);
    if (input.scopes.includes('admin') && !scopes.includes('admin')) throw new AppError('FORBIDDEN');
    if (!scopes.length) throw new AppError('VALIDATION_FAILED', { field: 'scopes' });

    return this.issue(user.id, input.name, scopes, input.rateLimitPerMinute);
  }

  /** Generates and stores a key whose name, scopes and limit are already validated. */
  private async issue(userId: string, name: string, scopes: ApiScope[], rateLimitPerMinute: number | null) {
    const generated = generateApiKey(this.deps.pepper);
    const row = await this.deps.store.createApiKey({
      userId,
      name,
      keyHash: generated.hash,
      displayPrefix: generated.displayPrefix,
      scopes,
      rateLimitPerMinute,
    });
    return { key: toKeyView(row), rawKey: generated.raw };
  }

  async list(userId: string): Promise<ApiKeyView[]> {
    return (await this.deps.store.listApiKeys(userId)).map(toKeyView);
  }

  async revoke(actor: { id: string; role: UserRole }, keyId: string, reason = 'user_revoked') {
    const key = await this.deps.store.findApiKeyById(keyId);
    if (!key || (key.userId !== actor.id && !isAdminRole(actor.role))) throw new AppError('NOT_FOUND');
    const row = await this.deps.store.revokeApiKey(keyId, reason, new Date());
    return toKeyView(row!);
  }

  /** Admin control: set a key's per-minute limit, or null for unlimited (also lifts daily job quotas). */
  async setLimit(actor: { id: string; role: UserRole }, keyId: string, rateLimitPerMinute: number | null) {
    if (!isAdminRole(actor.role)) throw new AppError('FORBIDDEN');
    const key = await this.deps.store.findApiKeyById(keyId);
    if (!key) throw new AppError('NOT_FOUND');
    if (key.revokedAt) throw new AppError('API_KEY_REVOKED');
    const row = await this.deps.store.updateApiKeyLimit(keyId, rateLimitPerMinute);
    return toKeyView(row!);
  }

  /** Revokes the old key and issues a new one with identical name, scopes and limit. */
  async regenerate(user: { id: string; role: UserRole }, keyId: string) {
    const key = await this.deps.store.findApiKeyById(keyId);
    if (!key || key.userId !== user.id) throw new AppError('NOT_FOUND');
    if (key.revokedAt) throw new AppError('API_KEY_REVOKED');
    await this.deps.store.revokeApiKey(keyId, 'regenerated', new Date());
    // Same name, scopes and limit — including a custom/unlimited limit an admin set on the old key.
    const scopes = sanitizeScopes(key.scopes, user.role, this.deps.adminScopeEnabled);
    return this.issue(user.id, key.name, scopes.length ? scopes : ['analyze'], key.rateLimitPerMinute);
  }

  /** Resolves a Bearer header to an active key. Constant-shape errors; raw key never retained. */
  async authenticate(authorizationHeader: string | undefined): Promise<ApiKeyRow> {
    const token = extractBearer(authorizationHeader);
    if (!token || !looksLikeKey(token)) throw new AppError('API_KEY_INVALID');
    const key = await this.deps.store.findApiKeyByHash(hashApiKey(token, this.deps.pepper));
    if (!key) throw new AppError('API_KEY_INVALID');
    if (key.revokedAt) throw new AppError('API_KEY_REVOKED');
    const owner = await this.deps.store.findUserById(key.userId);
    if (!owner || owner.disabled) throw new AppError('API_KEY_REVOKED');
    // Admin scope is only honoured while the owner still holds an admin role.
    if (key.scopes.includes('admin') && owner.role === 'user') {
      key.scopes = key.scopes.filter((s) => s !== 'admin');
    }
    void this.deps.store.touchApiKey(key.id, new Date()).catch(() => {});
    return key;
  }
}
