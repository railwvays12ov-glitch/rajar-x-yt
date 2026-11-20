#!/usr/bin/env node
/**
 * Installs the media tools RAJAR X YT needs into ./bin, without root or apt:
 *   bin/yt-dlp   — official standalone build (falls back to the Python zipapp)
 *   bin/ffmpeg   — from the ffmpeg-static npm package
 *   bin/ffprobe  — from the ffprobe-static npm package
 * Runs automatically after `npm install` (postinstall). Never fails the install:
 * if a download is blocked the app still starts and shows "yt-dlp/FFmpeg unavailable".
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const bin = path.join(root, 'bin');
const TAG = '[media-tools]';
if (process.env.SKIP_MEDIA_TOOLS === '1') { console.log(`${TAG} skipped (SKIP_MEDIA_TOOLS=1)`); process.exit(0); }
mkdirSync(bin, { recursive: true });

function works(file, args = ['--version']) {
  try { execFileSync(file, args, { stdio: 'pipe', timeout: 60_000 }); return true; } catch { return false; }
}

async function download(url, target) {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const temp = `${target}.download`;
  writeFileSync(temp, Buffer.from(await response.arrayBuffer()));
  chmodSync(temp, 0o755);
  renameSync(temp, target);
}

async function installYtDlp() {
  const target = path.join(bin, 'yt-dlp');
  if (existsSync(target) && works(target) && Date.now() - statSync(target).mtimeMs < 3 * 86400_000) {
    console.log(`${TAG} yt-dlp already installed`);
    return;
  }
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';
  const candidates = process.arch === 'arm64' ? ['yt-dlp_linux_aarch64', 'yt-dlp'] : ['yt-dlp_linux', 'yt-dlp'];
  for (const asset of process.platform === 'linux' ? candidates : ['yt-dlp']) {
    try {
      await download(`${base}/${asset}`, target);
      if (works(target)) { console.log(`${TAG} yt-dlp installed (${asset})`); return; }
      console.warn(`${TAG} ${asset} downloaded but does not run here, trying next build`);
    } catch (err) {
      console.warn(`${TAG} could not download ${asset}: ${err.message}`);
    }
  }
  console.warn(`${TAG} yt-dlp NOT installed — analysis/processing stays disabled until it is available.`);
}

function installFromPackage(name, file) {
  try {
    let source = require(name);
    if (source && typeof source === 'object') source = source.path;
    if (!source || !existsSync(source)) throw new Error('binary missing');
    const target = path.join(bin, file);
    copyFileSync(source, target);
    chmodSync(target, 0o755);
    console.log(`${TAG} ${file} installed (${name})`);
  } catch (err) {
    console.warn(`${TAG} ${file} not installed from ${name}: ${err.message}`);
  }
}

await installYtDlp();
installFromPackage('ffmpeg-static', 'ffmpeg');
installFromPackage('ffprobe-static', 'ffprobe');
