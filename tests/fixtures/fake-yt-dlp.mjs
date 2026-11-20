#!/usr/bin/env node
/**
 * Test double for yt-dlp. Mimics the CLI surface RAJAR X uses (version, --dump-single-json,
 * downloads with -o/-f/-x) and produces REAL media via FFmpeg so the full pipeline is exercised.
 * The behaviour is selected by the video id in the URL.
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
if (args.includes('--version')) {
  console.log('2026.11.01-fake');
  process.exit(0);
}

const sep = args.indexOf('--');
const url = sep >= 0 ? args[sep + 1] : '';
if (sep < 0 || !url) {
  console.error('ERROR: URL must follow --');
  process.exit(2);
}
// Hard guarantees the wrapper must uphold.
for (const forbidden of ['--cookies', '--allow-unplayable-formats', '--exec', '--username', '--password']) {
  if (args.includes(forbidden)) {
    console.error(`ERROR: forbidden flag ${forbidden}`);
    process.exit(3);
  }
}
if (!args.includes('--ignore-config')) {
  console.error('ERROR: --ignore-config missing');
  process.exit(3);
}

const id = new URL(url).searchParams.get('v') ?? url.split('/').pop();
const fail = (msg) => {
  console.error(`ERROR: [youtube] ${id}: ${msg}`);
  process.exit(1);
};

const fmt = (o) => ({ protocol: 'https', has_drm: false, ...o });
const baseInfo = {
  id,
  title: 'RAJAR X Test Clip: Neon / Orbit <1080p>',
  uploader: 'RAJAR Test Channel',
  duration: 2,
  availability: 'public',
  age_limit: 0,
  live_status: 'not_live',
  thumbnail: 'https://i.ytimg.com/vi/test/hqdefault.jpg',
  subtitles: { en: [{ ext: 'vtt' }] },
  formats: [
    fmt({ format_id: 'sb0', ext: 'mhtml', vcodec: 'none', acodec: 'none', protocol: 'mhtml', format_note: 'storyboard' }),
    fmt({ format_id: '140', ext: 'm4a', vcodec: 'none', acodec: 'mp4a.40.2', abr: 129, filesize: 40_000 }),
    fmt({ format_id: '251', ext: 'webm', vcodec: 'none', acodec: 'opus', abr: 140, filesize: 42_000 }),
    fmt({ format_id: '136', ext: 'mp4', vcodec: 'avc1.4d401f', acodec: 'none', height: 720, fps: 30, filesize: 400_000 }),
    fmt({ format_id: '137', ext: 'mp4', vcodec: 'avc1.640028', acodec: 'none', height: 1080, fps: 30, filesize: 900_000 }),
    fmt({ format_id: '248', ext: 'webm', vcodec: 'vp9', acodec: 'none', height: 1080, fps: 30, filesize: 800_000 }),
  ],
};

const scenarios = {
  okVideo1234: () => baseInfo,
  flakyVid123: () => baseInfo,
  bigVideo123: () => ({ ...baseInfo, formats: baseInfo.formats.map((f) => (f.filesize ? { ...f, filesize: f.filesize * 10_000 } : f)) }),
  privVideo12: () => fail("Private video. Sign in if you've been granted access to this video"),
  loginVideo1: () => fail("Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies for the authentication."),
  memberVid12: () => fail('Join this channel to get access to members-only content like this video.'),
  geoVideo123: () => fail('The uploader has not made this video available in your country'),
  goneVideo12: () => fail('Video unavailable. This video has been removed by the uploader'),
  netFail1234: () => fail('Unable to download webpage: <urlopen error timed out>'),
  drmVideo123: () => ({ ...baseInfo, formats: baseInfo.formats.map((f) => ({ ...f, has_drm: true })) }),
  ageVideo123: () => ({ ...baseInfo, age_limit: 18 }),
  liveVideo12: () => ({ ...baseInfo, live_status: 'is_live', is_live: true }),
  longVideo12: () => ({ ...baseInfo, duration: 99_999 }),
  privAvail12: () => ({ ...baseInfo, availability: 'needs_auth' }),
  playlist123: () => ({ _type: 'playlist', title: 'A playlist', entries: [] }),
};

const scenario = scenarios[id];
if (!scenario) fail('Video unavailable');
const info = scenario();

if (args.includes('--dump-single-json')) {
  process.stdout.write(JSON.stringify(info));
  process.exit(0);
}

// ---- download mode ----
if (id === 'netFail1234' || id === 'flakyVid123') fail('Unable to download webpage: timed out');
const out = args[args.indexOf('-o') + 1];
const ffmpeg = 'ffmpeg';
const maxSize = Number(args[args.indexOf('--max-filesize') + 1]);
if (id === 'bigVideo123' && maxSize < 1e9) {
  console.log('[download] File is larger than max-filesize (9000000000 bytes > ' + maxSize + ' bytes). Aborting.');
  process.exit(0);
}

const progress = () => {
  for (const pct of [10, 45, 80, 100]) console.log(`RXP|${pct * 1000}|100000|NA`);
};

let ext;
let ffArgs;
if (args.includes('--write-thumbnail')) {
  ext = 'jpg';
  ffArgs = ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=1', '-frames:v', '1'];
} else if (args.includes('-x')) {
  ext = args[args.indexOf('--audio-format') + 1];
  progress();
  console.log('[ExtractAudio] Destination: media.' + ext);
  ffArgs = ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', ...(ext === 'mp3' ? ['-c:a', 'libmp3lame'] : ext === 'm4a' ? ['-c:a', 'aac'] : ['-c:a', 'pcm_s16le'])];
} else {
  ext = args[args.indexOf('--merge-output-format') + 1] ?? 'mp4';
  progress();
  progress(); // second stream (audio)
  console.log('[Merger] Merging formats into "media.' + ext + '"');
  const codecs = ext === 'webm' ? ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-c:a', 'libopus'] : ['-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac'];
  ffArgs = ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1', ...codecs, '-shortest'];
}

const target = out.replace('%(ext)s', ext);
const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...ffArgs, target], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error('ERROR: Postprocessing: ' + (r.stderr || 'ffmpeg failed'));
  process.exit(1);
}
process.exit(0);
