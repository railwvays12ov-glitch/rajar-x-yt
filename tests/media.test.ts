import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ERROR_CATALOG, ERROR_CODES } from '../shared/errors.js';
import { processOptionsSchema } from '../shared/types.js';
import { parseSize, loadConfig } from '../server/config.js';
import { analyzeArgs, baseArgs, downloadArgs, videoFormatSelector } from '../server/media/args.js';
import { mapFfmpegResult, mapYtdlpResult, mapYtdlpText } from '../server/media/errorMap.js';
import { buildOutputFilename, contentDisposition, sanitizeFilename } from '../server/media/filename.js';
import { estimateSizes, evaluatePolicy, optionAvailable, summarizeFormats } from '../server/media/metadata.js';
import type { RunResult } from '../server/media/runProcess.js';

const rr = (o: Partial<RunResult>): RunResult => ({
  code: 1,
  stdout: '',
  stderr: '',
  timedOut: false,
  aborted: false,
  truncated: false,
  spawnError: null,
  ...o,
});

describe('Filename sanitization', () => {
  it('removes traversal, separators, control and bidi characters', () => {
    assert.equal(sanitizeFilename('../../etc/passwd'), 'etc passwd');
    assert.equal(sanitizeFilename('a\u0000b‮c<d>|e'), 'abc d e');
    assert.equal(sanitizeFilename('   ...hidden'), 'hidden');
    assert.equal(sanitizeFilename('CON'), 'rajar-x-media');
    assert.equal(sanitizeFilename(''), 'rajar-x-media');
    assert.equal(sanitizeFilename('x'.repeat(500)).length, 120);
  });

  it('builds output names and safe Content-Disposition', () => {
    assert.equal(buildOutputFilename('My: Clip / 2026', '1080p mp4', 'mp4'), 'My Clip 2026 [1080p mp4].mp4');
    const cd = contentDisposition('Ünïcode "clip".mp4');
    assert.match(cd, /^attachment; filename="_n_code _clip_.mp4"; filename\*=UTF-8''/);
    assert.ok(!cd.includes('\n'));
  });
});

describe('yt-dlp error mapping', () => {
  const cases: [string, string][] = [
    ["ERROR: [youtube] x: Private video. Sign in if you've been granted access", 'MEDIA_PRIVATE'],
    ['ERROR: [youtube] x: Sign in to confirm your age. This video may be inappropriate for some users.', 'AGE_RESTRICTED'],
    ['ERROR: [youtube] x: The uploader has not made this video available in your country', 'GEO_RESTRICTED'],
    ['ERROR: [youtube] x: This video is DRM protected', 'DRM_PROTECTED'],
    ['ERROR: [youtube] x: Join this channel to get access to members-only content', 'LOGIN_REQUIRED'],
    ["ERROR: [youtube] x: Sign in to confirm you're not a bot. Use --cookies-from-browser", 'PLATFORM_BOT_CHECK'],
    ['ERROR: [youtube] x: Sign in to confirm you’re not a bot. This helps protect our community.', 'PLATFORM_BOT_CHECK'],
    ['ERROR: [instagram] x: Requested content is not available, rate-limit reached or login required', 'LOGIN_REQUIRED'],
    ['ERROR: [youtube] x: Video unavailable. This video has been removed by the uploader', 'MEDIA_UNAVAILABLE'],
    ['ERROR: Unsupported URL: https://example.com', 'UNSUPPORTED_PLATFORM'],
    ['ERROR: Unable to download webpage: <urlopen error timed out>', 'NETWORK_FAILURE'],
    ['ERROR: [youtube] x: This live event will begin in 3 hours', 'LIVE_UNSUPPORTED'],
    ['ERROR: [youtube] x: Requested format is not available', 'FORMAT_UNAVAILABLE'],
    ['ERROR: HTTP Error 429: Too Many Requests', 'RATE_LIMITED'],
    ['ERROR: something nobody anticipated', 'PROCESSING_FAILED'],
  ];
  for (const [text, code] of cases) {
    it(`maps → ${code}`, () => assert.equal(mapYtdlpResult(rr({ stderr: `WARNING: noise\n${text}` })), code));
  }

  it('maps process-level failures', () => {
    const enoent = Object.assign(new Error('x'), { code: 'ENOENT' });
    assert.equal(mapYtdlpResult(rr({ spawnError: enoent })), 'YTDLP_UNAVAILABLE');
    assert.equal(mapYtdlpResult(rr({ timedOut: true })), 'PROCESSING_TIMEOUT');
    assert.equal(mapYtdlpResult(rr({ aborted: true })), 'PROCESSING_CANCELLED');
    assert.equal(mapYtdlpResult(rr({ code: 0 })), null);
    assert.equal(mapYtdlpText('ERROR: ffmpeg not found. Please install'), 'FFMPEG_UNAVAILABLE');
  });

  it('maps FFmpeg failures', () => {
    const enoent = Object.assign(new Error('x'), { code: 'ENOENT' });
    assert.equal(mapFfmpegResult(rr({ spawnError: enoent })), 'FFMPEG_UNAVAILABLE');
    assert.equal(mapFfmpegResult(rr({ stderr: 'av_interleaved_write_frame(): No space left on device' })), 'STORAGE_UNAVAILABLE');
    assert.equal(mapFfmpegResult(rr({ stderr: 'Invalid data found when processing input' })), 'PROCESSING_FAILED');
    assert.equal(mapFfmpegResult(rr({ timedOut: true })), 'PROCESSING_TIMEOUT');
    assert.equal(mapFfmpegResult(rr({ code: 0 })), null);
  });

  it('every error code has a friendly message and next action', () => {
    for (const code of ERROR_CODES) {
      const e = ERROR_CATALOG[code];
      assert.ok(e.message.length > 10 && e.nextAction.length > 10, code);
      assert.ok(!/stack|exception|errno|\/tmp|yt-dlp:/i.test(e.message), `${code} leaks internals`);
    }
  });
});

describe('Metadata policy', () => {
  const base = {
    title: 't',
    duration: 60,
    availability: 'public',
    formats: [{ format_id: '18', ext: 'mp4', vcodec: 'avc1', acodec: 'mp4a', height: 360 }],
  };
  it('allows normal public media', () => assert.equal(evaluatePolicy(base, 7200), null));
  it('blocks private / auth availability', () => {
    assert.equal(evaluatePolicy({ ...base, availability: 'private' }, 7200), 'MEDIA_PRIVATE');
    assert.equal(evaluatePolicy({ ...base, availability: 'needs_auth' }, 7200), 'LOGIN_REQUIRED');
    assert.equal(evaluatePolicy({ ...base, availability: 'premium_only' }, 7200), 'LOGIN_REQUIRED');
  });
  it('blocks age-restricted, live, playlist and DRM media', () => {
    assert.equal(evaluatePolicy({ ...base, age_limit: 18 }, 7200), 'AGE_RESTRICTED');
    assert.equal(evaluatePolicy({ ...base, live_status: 'is_live' }, 7200), 'LIVE_UNSUPPORTED');
    assert.equal(evaluatePolicy({ ...base, _type: 'playlist' }, 7200), 'PLAYLIST_UNSUPPORTED');
    assert.equal(evaluatePolicy({ ...base, formats: base.formats.map((f) => ({ ...f, has_drm: true })) }, 7200), 'DRM_PROTECTED');
  });
  it('enforces the duration limit', () => assert.equal(evaluatePolicy({ ...base, duration: 7201 }, 7200), 'DURATION_TOO_LONG'));

  it('summarizes formats, drops storyboards/DRM, estimates sizes and availability', () => {
    const f = summarizeFormats([
      { format_id: 'sb', ext: 'mhtml', protocol: 'mhtml', vcodec: 'none', acodec: 'none' },
      { format_id: 'drm', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 2160, has_drm: true },
      { format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128, filesize: 100 },
      { format_id: '137', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 1080, filesize: 1000 },
      { format_id: '136', ext: 'mp4', vcodec: 'avc1', acodec: 'none', height: 720, filesize: 500 },
    ]);
    assert.deepEqual(
      f.map((x) => x.id),
      ['140', '137', '136'],
    );
    const s = estimateSizes(f);
    assert.equal(s.best, 1100);
    assert.equal(s['720'], 600);
    assert.equal(s.audio, 100);
    const opts = processOptionsSchema.parse({ mediaType: 'video', quality: '2160' });
    assert.equal(optionAvailable(opts, [1080, 720], true, true), false, 'never label an upscale');
    assert.equal(optionAvailable({ ...opts, quality: '1080' }, [1080, 720], true, true), true);
    assert.equal(optionAvailable({ ...opts, mediaType: 'audio' }, [], true, false), true);
  });
});

describe('yt-dlp argument construction', () => {
  it('always passes the URL after "--" and never enables cookies/config', () => {
    const evil = 'https://www.youtube.com/watch?v=--exec=rm';
    const a = analyzeArgs(evil);
    assert.equal(a[a.length - 2], '--');
    assert.equal(a[a.length - 1], evil);
    for (const flag of ['--ignore-config', '--no-cookies', '--no-playlist']) assert.ok(baseArgs().includes(flag));
    const d = downloadArgs({
      url: evil,
      outputTemplate: '/tmp/x/media.%(ext)s',
      options: processOptionsSchema.parse({ mediaType: 'video', quality: '720', subtitleLang: 'en' }),
      maxFileSizeBytes: 1000,
      ffmpegBin: 'ffmpeg',
      allowedSubtitleLangs: [],
    });
    assert.equal(d[d.length - 1], evil);
    assert.ok(!d.includes('--write-subs'), 'subtitles only when the uploader published them');
    assert.ok(
      !d.some(
        (x) =>
          /cookies(?!-from-browser$)|^--cookies$|allow-unplayable/.test(x) &&
          x !== '--no-cookies' &&
          x !== '--no-cookies-from-browser',
      ),
    );
  });

  it('builds enumerated format selectors only', () => {
    assert.equal(
      videoFormatSelector(processOptionsSchema.parse({ mediaType: 'video', quality: '1080' })),
      'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]',
    );
    assert.match(videoFormatSelector(processOptionsSchema.parse({ mediaType: 'video', container: 'webm' })), /ext=webm/);
    assert.throws(() => processOptionsSchema.parse({ mediaType: 'video', quality: '1080; rm -rf /' }));
    assert.throws(() => processOptionsSchema.parse({ mediaType: 'video', subtitleLang: '--exec' }));
  });
});

describe('Configuration', () => {
  it('parses size and duration limits', () => {
    assert.equal(parseSize('500M'), 500 * 1024 ** 2);
    assert.equal(parseSize('2G'), 2 * 1024 ** 3);
    assert.equal(parseSize('1024'), 1024);
    assert.throws(() => parseSize('lots'));
  });

  it('generates and persists secrets when missing, and rejects weak explicit secrets', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rx-secrets-'));
    const a = loadConfig({ NODE_ENV: 'production', DATA_DIR: dir } as NodeJS.ProcessEnv);
    const b = loadConfig({ NODE_ENV: 'production', DATA_DIR: dir } as NodeJS.ProcessEnv);
    assert.ok(a.sessionSecret.length >= 32 && a.apiKeyPepper.length >= 32);
    assert.equal(a.apiKeyPepper, b.apiKeyPepper, 'pepper survives restarts so API keys keep working');
    assert.equal((statSync(path.join(dir, 'secrets.json')).mode & 0o777).toString(8), '600');
    assert.throws(
      () =>
        loadConfig({
          NODE_ENV: 'production',
          SESSION_SECRET: 'short',
          API_KEY_PEPPER: 'short',
          DATABASE_URL: 'postgres://x',
        } as NodeJS.ProcessEnv),
      /32 characters/,
    );
  });
});
