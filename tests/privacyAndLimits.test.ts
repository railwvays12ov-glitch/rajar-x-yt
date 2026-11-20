import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { processOptionsSchema } from '../shared/types.js';
import { AccountsOnlyStore } from '../server/db/accountsOnlyStore.js';
import { FileStore } from '../server/db/fileStore.js';
import { MemoryStore } from '../server/db/memoryStore.js';
import { AppError } from '../server/http/appError.js';
import { ApiKeyService } from '../server/services/apiKeyService.js';
import { AuthService } from '../server/services/authService.js';
import './helpers.js';

describe('Only account data is stored on disk', () => {
  it('persists users and keys but never jobs or audit entries', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'rx-db-')), 'database.json');
    const store = new AccountsOnlyStore(new FileStore(file));
    const user = await store.createUser({ email: 'a@rajar.test', displayName: 'A', passwordHash: 'x', role: 'user' });
    await store.createApiKey({
      userId: user.id,
      name: 'k',
      keyHash: 'h'.repeat(64),
      displayPrefix: 'p',
      scopes: ['analyze'],
      rateLimitPerMinute: null,
    });
    await store.createJob({
      id: 'job_secret',
      requestId: 'req_x',
      userId: user.id,
      anonId: null,
      apiKeyId: null,
      sourceUrl: 'https://www.youtube.com/watch?v=private-history',
      platform: 'youtube',
      title: 'history title',
      durationSeconds: 1,
      mediaType: 'audio',
      format: 'mp3',
      quality: 'audio',
      options: processOptionsSchema.parse({ mediaType: 'audio' }),
      status: 'queued',
      progress: 0,
      attempts: 0,
      errorCode: null,
      errorMessage: null,
      outputRef: null,
      outputFilename: null,
      outputSizeBytes: null,
      logs: [],
      startedAt: null,
      completedAt: null,
      expiresAt: null,
      hiddenAt: null,
    });
    await store.addAudit({
      requestId: 'req_x',
      userId: user.id,
      apiKeyId: null,
      action: 'analyze',
      ipHash: 'ip',
      httpStatus: 200,
      errorCode: null,
      meta: {},
    });
    assert.ok(await store.getJob('job_secret'), 'activity works while running');
    await store.close();

    const disk = readFileSync(file, 'utf8');
    const data = JSON.parse(disk);
    assert.equal(data.users.length, 1);
    assert.equal(data.keys.length, 1);
    assert.equal(data.keys[0].rateLimitPerMinute, null);
    assert.deepEqual(data.jobs, []);
    assert.deepEqual(data.audit, []);
    assert.ok(!disk.includes('private-history') && !disk.includes('history title') && !disk.includes('req_x'));

    // Reload: account survives restart, activity does not.
    const reopened = new AccountsOnlyStore(new FileStore(file));
    assert.equal(await reopened.countUsers(), 1);
    assert.equal(await reopened.getJob('job_secret'), null);
    await reopened.close();
  });
});

describe('Admin-controlled key limits', () => {
  async function setup() {
    const store = new MemoryStore();
    const auth = new AuthService(store, { ownerEmail: 'owner@rajar.test', sessionTtlMs: 3600_000 });
    const keys = new ApiKeyService({ store, pepper: 'p'.repeat(40), maxKeysPerUser: 5, adminScopeEnabled: false });
    const user = await auth.register({ email: 'u@rajar.test', password: 'correct horse battery', displayName: 'U' });
    const owner = await auth.register({ email: 'owner@rajar.test', password: 'correct horse battery', displayName: 'O' });
    return { keys, user, owner };
  }

  it('normal users can only pick preset limits', async () => {
    const { keys, user } = await setup();
    await assert.rejects(
      keys.create(user, { name: 'x', scopes: ['analyze'], rateLimitPerMinute: null }),
      (e: AppError) => e.code === 'FORBIDDEN',
    );
    await assert.rejects(
      keys.create(user, { name: 'x', scopes: ['analyze'], rateLimitPerMinute: 999 }),
      (e: AppError) => e.code === 'FORBIDDEN',
    );
    assert.equal(
      (await keys.create(user, { name: 'x', scopes: ['analyze'], rateLimitPerMinute: 60 })).key.rateLimitPerMinute,
      60,
    );
  });

  it('admins can create unlimited/custom keys and change any key’s limit', async () => {
    const { keys, user, owner } = await setup();
    assert.equal(
      (await keys.create(owner, { name: 'ops', scopes: ['analyze'], rateLimitPerMinute: null })).key.rateLimitPerMinute,
      null,
    );
    assert.equal(
      (await keys.create(owner, { name: 'big', scopes: ['analyze'], rateLimitPerMinute: 5000 })).key.rateLimitPerMinute,
      5000,
    );

    const k = await keys.create(user, { name: 'bot', scopes: ['analyze'], rateLimitPerMinute: 30 });
    await assert.rejects(keys.setLimit(user, k.key.id, null), (e: AppError) => e.code === 'FORBIDDEN');
    assert.equal((await keys.setLimit(owner, k.key.id, null)).rateLimitPerMinute, null);
    assert.equal((await keys.setLimit(owner, k.key.id, 777)).rateLimitPerMinute, 777);

    await keys.setLimit(owner, k.key.id, null);
    const regenerated = await keys.regenerate(user, k.key.id);
    assert.equal(regenerated.key.rateLimitPerMinute, null, 'regenerate keeps the admin-set limit');
  });
});
