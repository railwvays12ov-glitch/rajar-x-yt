/**
 * Regenerates PNG favicons, app icons and the social preview from SVG sources.
 * Usage: npx --yes sharp-cli is NOT required — run `node scripts/generate-brand-assets.mjs`
 * after `npm i -D sharp`. Output goes to client/public/.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'client/public');
const favicon = readFileSync(path.join(pub, 'favicon.svg'));

for (const [name, size] of [
  ['favicon-32.png', 32],
  ['apple-touch-icon.png', 180],
  ['icon-192.png', 192],
  ['icon-512.png', 512],
]) {
  await sharp(favicon, { density: 600 }).resize(size, size).png().toFile(path.join(pub, name));
}

const emblem = favicon
  .toString()
  .replace('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">', '')
  .replace('</svg>', '');
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="bg" cx=".72" cy=".2" r=".9"><stop offset="0" stop-color="#2a1660"/><stop offset=".55" stop-color="#0b0914"/><stop offset="1" stop-color="#040308"/></radialGradient>
    <linearGradient id="t" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#a98bff"/><stop offset="1" stop-color="#22e1ff"/></linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#8b5cf6" stroke-opacity=".12"/></pattern>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#grid)"/>
  <g transform="translate(930 300)">
    <circle r="200" fill="none" stroke="#8b5cf6" stroke-opacity=".25" stroke-dasharray="4 10"/>
    <ellipse rx="230" ry="64" transform="rotate(-18)" fill="none" stroke="#a98bff" stroke-opacity=".55" stroke-width="2"/>
    <ellipse rx="190" ry="52" transform="rotate(38)" fill="none" stroke="#22e1ff" stroke-opacity=".45" stroke-width="2"/>
    <g transform="translate(-96 -96) scale(3)">${emblem}</g>
  </g>
  <text x="80" y="250" font-family="DejaVu Sans, Arial, sans-serif" font-size="96" font-weight="700" fill="#ffffff" letter-spacing="-2">RAJAR <tspan fill="url(#t)">X</tspan></text>
  <rect x="80" y="282" width="92" height="40" rx="8" fill="#22e1ff" fill-opacity=".12" stroke="#22e1ff" stroke-opacity=".6"/>
  <text x="126" y="310" text-anchor="middle" font-family="DejaVu Sans Mono, monospace" font-size="22" font-weight="700" fill="#22e1ff" letter-spacing="4">YT</text>
  <text x="80" y="398" font-family="DejaVu Sans, Arial, sans-serif" font-size="36" fill="#ece9ff">Drop a link.</text>
  <text x="80" y="444" font-family="DejaVu Sans, Arial, sans-serif" font-size="36" fill="#ece9ff">Let RAJAR X map the safe route.</text>
  <text x="80" y="498" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#a7a1c8">Analyze first. Process only what you’re allowed to use.</text>
  <text x="80" y="560" font-family="DejaVu Sans Mono, monospace" font-size="18" fill="#6f6990">Authorized media · Personal API keys · Not affiliated with any platform</text>
</svg>`;
writeFileSync(path.join(pub, 'og-image.svg'), og);
await sharp(Buffer.from(og)).png({ compressionLevel: 9 }).toFile(path.join(pub, 'og-image.png'));
console.log('Brand assets generated in client/public');
