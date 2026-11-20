import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isBlockedIp } from '../server/security/ip.js';
import { assertPublicHost, validateUrl, validateUrlSyntax } from '../server/security/urlPolicy.js';
import { AppError } from '../server/http/appError.js';
import { fakeResolver } from './helpers.js';

const opts = { extraAllowedDomains: [], disabledPlatforms: [] };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : 'NON_APP_ERROR';
  }
  return 'NO_ERROR';
}

describe('URL validation', () => {
  it('accepts single public items on each platform', () => {
    const cases: [string, string][] = [
      ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
      ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
      ['https://m.youtube.com/shorts/abcdefGHIJK', 'youtube'],
      ['https://www.instagram.com/reel/C0abcdef/', 'instagram'],
      ['https://www.tiktok.com/@creator/video/7300000000000000000', 'tiktok'],
      ['https://x.com/creator/status/1800000000000000000', 'x'],
      ['https://twitter.com/creator/status/1800000000000000000', 'x'],
      ['https://www.facebook.com/watch/?v=1234567890', 'facebook'],
      ['https://fb.watch/abcDEF/', 'facebook'],
    ];
    for (const [url, platform] of cases) assert.equal(validateUrlSyntax(url, opts).platform.id, platform, url);
  });

  it('normalizes: https, strips tracking params, fragments and YouTube playlist params', () => {
    const v = validateUrlSyntax('http://WWW.YouTube.com/watch?v=dQw4w9WgXcQ&list=PL123&si=track&utm_source=x#t=1', opts);
    assert.equal(v.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('rejects malformed and suspicious input', () => {
    for (const bad of [
      'not a url',
      'javascript:alert(1)',
      'data:text/html,hi',
      'ftp://youtube.com/watch?v=x',
      'file:///etc/passwd',
      'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
      'https://127.0.0.1/watch?v=x',
      'https://[::1]/watch?v=x',
      'https://localhost/watch?v=x',
      'https://www.youtube.com/watch?v=a b',
      `https://www.youtube.com/watch?v=${'a'.repeat(2100)}`,
    ]) {
      assert.equal(
        codeOf(() => validateUrlSyntax(bad, opts)),
        'INVALID_URL',
        bad,
      );
    }
  });

  it('rejects unsupported and look-alike domains', () => {
    for (const bad of [
      'https://evil.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
      'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
      'https://www.yоutube.com/watch?v=dQw4w9WgXcQ', // Cyrillic "о" → punycode, not allow-listed
    ]) {
      assert.equal(
        codeOf(() => validateUrlSyntax(bad, opts)),
        'UNSUPPORTED_PLATFORM',
        bad,
      );
    }
  });

  it('rejects private, login-walled and batch URLs', () => {
    assert.equal(
      codeOf(() => validateUrlSyntax('https://www.instagram.com/stories/someone/123/', opts)),
      'LOGIN_REQUIRED',
    );
    assert.equal(
      codeOf(() => validateUrlSyntax('https://www.instagram.com/direct/inbox/', opts)),
      'LOGIN_REQUIRED',
    );
    assert.equal(
      codeOf(() => validateUrlSyntax('https://www.facebook.com/groups/123/posts/4', opts)),
      'LOGIN_REQUIRED',
    );
    assert.equal(
      codeOf(() => validateUrlSyntax('https://www.youtube.com/playlist?list=PL1', opts)),
      'PLAYLIST_UNSUPPORTED',
    );
    assert.equal(
      codeOf(() => validateUrlSyntax('https://www.youtube.com/@channel/videos', opts)),
      'PLAYLIST_UNSUPPORTED',
    );
    assert.equal(
      codeOf(() => validateUrlSyntax('https://www.tiktok.com/@creator', opts)),
      'PLAYLIST_UNSUPPORTED',
    );
    assert.equal(
      codeOf(() => validateUrlSyntax('https://www.facebook.com/watch/?v=1&oh=signedtoken&oe=123', opts)),
      'LOGIN_REQUIRED',
    );
  });

  it('honours disabled platforms and operator-approved extra domains', () => {
    assert.equal(
      codeOf(() => validateUrlSyntax('https://www.tiktok.com/@a/video/1', { ...opts, disabledPlatforms: ['tiktok'] })),
      'UNSUPPORTED_PLATFORM',
    );
    const v = validateUrlSyntax('https://media.example-public.org/clip/1', {
      ...opts,
      extraAllowedDomains: ['example-public.org'],
    });
    assert.equal(v.platform.id, 'other');
  });
});

describe('SSRF and private IP protection', () => {
  it('blocks private, loopback, link-local, CGNAT, multicast and reserved IPv4', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '198.18.0.1',
      '192.0.2.5',
    ]) {
      assert.equal(isBlockedIp(ip), true, ip);
    }
  });

  it('blocks private IPv6 and IPv4-mapped/NAT64 forms', () => {
    for (const ip of [
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '64:ff9b::10.0.0.1',
      '2001:db8::1',
      '[::1]',
      'fe80::1%eth0',
    ]) {
      assert.equal(isBlockedIp(ip), true, ip);
    }
  });

  it('allows public addresses and rejects garbage', () => {
    for (const ip of ['8.8.8.8', '142.250.72.14', '172.32.0.1', '2607:f8b0:4005:80a::200e', '::ffff:8.8.8.8']) {
      assert.equal(isBlockedIp(ip), false, ip);
    }
    assert.equal(isBlockedIp('not-an-ip'), true);
  });

  it('rejects hosts that resolve to any private address (DNS rebinding)', async () => {
    await assert.rejects(assertPublicHost('rebind.youtube.com', fakeResolver), (e: AppError) => e.code === 'INVALID_URL');
    await assert.rejects(assertPublicHost('internal.youtube.com', fakeResolver), (e: AppError) => e.code === 'INVALID_URL');
    await assert.rejects(assertPublicHost('mapped.youtube.com', fakeResolver), (e: AppError) => e.code === 'INVALID_URL');
    await assert.doesNotReject(assertPublicHost('www.youtube.com', fakeResolver));
  });

  it('runs syntax + DNS checks together', async () => {
    const v = await validateUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', opts, fakeResolver);
    assert.equal(v.platform.id, 'youtube');
    await assert.rejects(
      validateUrl('https://rebind.youtube.com/watch?v=dQw4w9WgXcQ', opts, fakeResolver),
      (e: AppError) => e.code === 'INVALID_URL',
    );
  });
});
