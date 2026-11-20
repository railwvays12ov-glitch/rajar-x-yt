import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MemoryStore } from '../server/db/memoryStore.js';
import { AppError } from '../server/http/appError.js';
import { logger } from '../server/logger.js';
import {
  KEY_PATTERN,
  extractBearer,
  generateApiKey,
  hashApiKey,
  hasScope,
  maskKey,
  sanitizeScopes,
} from '../server/security/apiKeys.js';
import { hashPassword, verifyPassword } from '../server/security/passwords.js';
import { MemoryRateStore, RateLimiter } from '../server/security/rateLimit.js';
import { ApiKeyService } from '../server/services/apiKeyService.js';
import { AuthService } from '../server/services/authService.js';

const PEPPER = 'pepper-pepper-pepper-pepper-pepper-123';

async function setup(maxKeysPerUser = 3) {
  const store = new MemoryStore();
  const auth = new AuthService(store, { ownerEmail: 'owner@rajar.test', sessionTtlMs: 3600_000 });
  const keys = new ApiKeyService({ store, pepper: PEPPER, maxKeysPerUser, adminScopeEnabled: true });
  const user = await auth.register({ email: 'user@rajar.test', password: 'correct horse battery', displayName: 'U' });
  const owner = await auth.register({ email: 'owner@rajar.test', password: 'correct horse battery', displayName: 'O' });
  return { store, auth, keys, user, owner };
}

describe('API key generation and hashing', () => {
  it('generates prefixed, high-entropy, unique keys', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const k = generateApiKey(PEPPER);
      assert.match(k.raw, KEY_PATTERN);
      assert.ok(k.raw.startsWith('rjar_live_'));
      assert.ok(!seen.has(k.raw));
      seen.add(k.raw);
    }
  });

  it('hashes one-way with the pepper and masks for display', () => {
    const k = generateApiKey(PEPPER);
    assert.equal(k.hash, hashApiKey(k.raw, PEPPER));
    assert.notEqual(k.hash, hashApiKey(k.raw, 'other-pepper'));
    assert.match(k.hash, /^[0-9a-f]{64}$/);
    assert.ok(!k.hash.includes(k.raw.slice(10)));
    assert.equal(k.displayPrefix, maskKey(k.raw));
    assert.match(k.displayPrefix, /^rjar_live_[0-9A-Za-z]{4}…[0-9A-Za-z]{4}$/);
  });

  it('parses bearer headers strictly', () => {
    assert.equal(extractBearer('Bearer rjar_live_abc'), 'rjar_live_abc');
    assert.equal(extractBearer('bearer   tok'), 'tok');
    assert.equal(extractBearer('Basic abc'), null);
    assert.equal(extractBearer(undefined), null);
  });
});

describe('API key service', () => {
  it('never stores the raw key and verifies it', async () => {
    const { store, keys, user } = await setup();
    const { key, rawKey } = await keys.create(user, { name: 'bot', scopes: ['analyze', 'activity'], rateLimitPerMinute: 60 });
    const storedDump = JSON.stringify(await store.listApiKeys(null));
    assert.ok(!storedDump.includes(rawKey), 'raw key must not be persisted');
    assert.ok(!JSON.stringify(await keys.list(user.id)).includes(rawKey), 'list endpoint must not expose raw key');
    assert.ok(!('keyHash' in (await keys.list(user.id))[0]!), 'list view must not expose the hash');
    const verified = await keys.authenticate(`Bearer ${rawKey}`);
    assert.equal(verified.id, key.id);
  });

  it('rejects invalid and revoked keys with distinct codes', async () => {
    const { keys, user } = await setup();
    const { key, rawKey } = await keys.create(user, { name: 'bot', scopes: ['analyze'], rateLimitPerMinute: 60 });
    await assert.rejects(keys.authenticate('Bearer rjar_live_' + 'x'.repeat(40)), (e: AppError) => e.code === 'API_KEY_INVALID');
    await assert.rejects(keys.authenticate('Bearer nope'), (e: AppError) => e.code === 'API_KEY_INVALID');
    await assert.rejects(keys.authenticate(undefined), (e: AppError) => e.code === 'API_KEY_INVALID');
    await keys.revoke(user, key.id);
    await assert.rejects(keys.authenticate(`Bearer ${rawKey}`), (e: AppError) => e.code === 'API_KEY_REVOKED');
  });

  it('regenerate revokes the old key and keeps settings', async () => {
    const { keys, user } = await setup();
    const first = await keys.create(user, { name: 'ci', scopes: ['analyze', 'process'], rateLimitPerMinute: 120 });
    const second = await keys.regenerate(user, first.key.id);
    assert.notEqual(second.rawKey, first.rawKey);
    assert.deepEqual(second.key.scopes, ['analyze', 'process']);
    assert.equal(second.key.rateLimitPerMinute, 120);
    await assert.rejects(keys.authenticate(`Bearer ${first.rawKey}`), (e: AppError) => e.code === 'API_KEY_REVOKED');
    assert.equal((await keys.authenticate(`Bearer ${second.rawKey}`)).id, second.key.id);
  });

  it('enforces the per-user key limit', async () => {
    const { keys, user } = await setup(2);
    await keys.create(user, { name: 'a', scopes: ['analyze'], rateLimitPerMinute: 30 });
    await keys.create(user, { name: 'b', scopes: ['analyze'], rateLimitPerMinute: 30 });
    await assert.rejects(
      keys.create(user, { name: 'c', scopes: ['analyze'], rateLimitPerMinute: 30 }),
      (e: AppError) => e.code === 'API_KEY_LIMIT',
    );
  });

  it('never grants admin scope to normal users; owners may receive it when enabled', async () => {
    const { keys, user, owner } = await setup();
    await assert.rejects(
      keys.create(user, { name: 'x', scopes: ['analyze', 'admin'], rateLimitPerMinute: 30 }),
      (e: AppError) => e.code === 'FORBIDDEN',
    );
    const o = await keys.create(owner, { name: 'ops', scopes: ['admin', 'analyze'], rateLimitPerMinute: 30 });
    assert.ok(o.key.scopes.includes('admin'));
    assert.deepEqual(sanitizeScopes(['admin', 'analyze'], 'admin', false), ['analyze']);
    assert.deepEqual(sanitizeScopes(['admin', 'analyze', 'analyze'], 'user', true), ['analyze']);
  });

  it('scope checks', () => {
    assert.equal(hasScope(['analyze', 'activity'], 'process'), false);
    assert.equal(hasScope(['analyze', 'process'], 'process'), true);
  });

  it('raw keys are redacted from logs', async () => {
    const { keys, user } = await setup();
    const { rawKey } = await keys.create(user, { name: 'bot', scopes: ['analyze'], rateLimitPerMinute: 60 });
    logger.info(`debug ${rawKey}`, { authorization: `Bearer ${rawKey}`, nested: { note: rawKey }, apiKey: rawKey });
    const dump = JSON.stringify(logger.recent(5));
    assert.ok(!dump.includes(rawKey));
    assert.ok(dump.includes('[REDACTED]'));
  });
});

describe('Authentication', () => {
  it('hashes passwords with scrypt and verifies', async () => {
    const h = await hashPassword('a strong passphrase');
    assert.match(h, /^scrypt\$/);
    assert.equal(await verifyPassword('a strong passphrase', h), true);
    assert.equal(await verifyPassword('wrong', h), false);
  });

  it('assigns owner role only to OWNER_EMAIL and rejects duplicate emails', async () => {
    const { auth, user, owner } = await setup();
    assert.equal(user.role, 'user');
    assert.equal(owner.role, 'owner');
    await assert.rejects(
      auth.register({ email: 'user@rajar.test', password: 'whatever12345', displayName: 'x' }),
      (e: AppError) => e.code === 'EMAIL_TAKEN',
    );
  });

  it('sessions: login, resolve, logout; wrong password is generic', async () => {
    const { auth } = await setup();
    await assert.rejects(auth.login('user@rajar.test', 'nope'), (e: AppError) => e.code === 'INVALID_CREDENTIALS');
    await assert.rejects(auth.login('ghost@rajar.test', 'nope'), (e: AppError) => e.code === 'INVALID_CREDENTIALS');
    const u = await auth.login('user@rajar.test', 'correct horse battery');
    const { token } = await auth.createSession(u.id, 'test');
    const s = await auth.resolveSession(token);
    assert.equal(s?.user.id, u.id);
    await auth.logout(s!.sessionId);
    assert.equal(await auth.resolveSession(token), null);
  });
});

describe('Rate limiting', () => {
  it('allows up to the limit per window, then blocks, then resets', async () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(new MemoryRateStore(() => now));
    let limitedEvents = 0;
    limiter.onLimited = () => limitedEvents++;
    for (let i = 0; i < 3; i++) assert.equal((await limiter.check('b', 'ip:1', 3, 60_000)).allowed, true);
    assert.equal((await limiter.check('b', 'ip:1', 3, 60_000)).allowed, false);
    assert.equal((await limiter.check('b', 'ip:2', 3, 60_000)).allowed, true, 'separate identity');
    assert.equal(limitedEvents, 1);
    now += 60_001;
    assert.equal((await limiter.check('b', 'ip:1', 3, 60_000)).allowed, true, 'window reset');
  });
});
