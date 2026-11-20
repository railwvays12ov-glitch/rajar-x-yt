import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Cooldown, SAFE_USE_NOTICE, createBot, extractSingleUrl } from './bot-core.mjs';
import { RajarClient } from './rajarClient.mjs';

test('extracts exactly one URL', () => {
  assert.equal(extractSingleUrl('look https://youtu.be/abcdefghijk'), 'https://youtu.be/abcdefghijk');
  assert.equal(extractSingleUrl('two https://a.com/x https://b.com/y'), null);
  assert.equal(extractSingleUrl('none'), null);
});

test('cooldown', () => {
  const c = new Cooldown(60);
  assert.equal(c.allow('a', 0), true);
  assert.equal(c.allow('a', 1000), false);
  assert.equal(c.allow('a', 61_000), true);
});

test('ignores unknown senders and only delivers successful jobs', async () => {
  const replies = [];
  const files = [];
  const client = {
    analyze: async () => ({
      title: 'T',
      sourceUrl: 'https://youtu.be/abcdefghijk',
      durationSeconds: 61,
      platformName: 'YouTube',
      availableHeights: [720],
    }),
    process: async () => ({ id: 'job_1', requestId: 'req_1' }),
    waitForJob: async () => ({ id: 'job_1', status: 'ready', requestId: 'req_1', outputSizeBytes: 10, outputFilename: 'a.mp3' }),
    downloadFile: async () => ({ buffer: Buffer.from('x'), mimetype: 'audio/mpeg' }),
  };
  const bot = createBot({
    client,
    allowedUsers: new Set(['ok@s.whatsapp.net']),
    allowedGroups: new Set(),
    maxFileBytes: 100,
    log: {},
  });
  const io = { reply: async (t) => replies.push(t), sendFile: async (...a) => files.push(a) };

  await bot({ sender: 'stranger@s.whatsapp.net', group: null, text: 'https://youtu.be/abcdefghijk', ...io });
  assert.equal(replies.length, 0, 'strangers are ignored');

  await bot({ sender: 'ok@s.whatsapp.net', group: null, text: 'https://youtu.be/abcdefghijk', ...io });
  assert.ok(replies[0].includes(SAFE_USE_NOTICE));
  await bot({ sender: 'ok@s.whatsapp.net', group: null, text: 'audio', ...io });
  assert.equal(files.length, 1);
  assert.equal(files[0][1], 'a.mp3');
});

test('client rejects malformed keys and never exposes the key', () => {
  assert.throws(() => new RajarClient({ baseUrl: 'https://x.example', apiKey: 'nope' }));
  const c = new RajarClient({ baseUrl: 'https://x.example', apiKey: 'rjar_live_' + 'A'.repeat(40) });
  assert.ok(!JSON.stringify(c).includes('rjar_live_'));
});
