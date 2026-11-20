import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../server/config.js';
import { logger } from '../server/logger.js';
import type { Resolver } from '../server/security/urlPolicy.js';

logger.setSilent(true);

export const FAKE_YTDLP = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/fake-yt-dlp.mjs');

/** Deterministic DNS: everything resolves publicly except hosts used to simulate rebinding. */
export const fakeResolver: Resolver = async (host) => {
  if (host.startsWith('rebind.')) return [{ address: '93.184.216.34' }, { address: '127.0.0.1' }];
  if (host.startsWith('internal.')) return [{ address: '10.0.0.5' }];
  if (host.startsWith('mapped.')) return [{ address: '::ffff:192.168.1.1' }];
  return [{ address: '142.250.72.14' }];
};

export function testConfig(env: Record<string, string> = {}) {
  const tempDir = mkdtempSync(path.join(tmpdir(), 'rajar-x-test-'));
  return loadConfig({
    NODE_ENV: 'test',
    PUBLIC_BASE_URL: 'http://localhost:5173',
    YTDLP_BIN: FAKE_YTDLP,
    FFMPEG_BIN: 'ffmpeg',
    MEDIA_TEMP_DIR: tempDir,
    MEDIA_RETENTION_MINUTES: '30',
    API_KEY_PEPPER: 'test-pepper-test-pepper-test-pepper-0001',
    SESSION_SECRET: 'test-session-secret-test-session-secret-01',
    OWNER_EMAIL: 'owner@rajar.test',
    RATE_LIMIT_MAX_REQUESTS: '1000',
    ...env,
  } as NodeJS.ProcessEnv);
}

export const yt = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
