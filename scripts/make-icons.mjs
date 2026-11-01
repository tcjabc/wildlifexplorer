#!/usr/bin/env node
// Draws the app icon (a paw print in a magnifying glass) and writes the PNG sizes
// the manifest and iOS need. Colours match css/tokens.css.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'icons');

const C = { bg: '#ffc93c', bgDeep: '#f2a900', ring: '#127a57', ringDeep: '#0b5a40', lens: '#fff8ec', paw: '#8b5e3c' };

// `inset` shrinks the artwork so it survives maskable-icon cropping.
function svg({ rounded, inset }) {
  const s = 512, k = 1 - inset * 2, o = s * inset;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs><radialGradient id="g" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="${C.bg}"/><stop offset="1" stop-color="${C.bgDeep}"/></radialGradient></defs>
  <rect width="${s}" height="${s}" rx="${rounded ? 112 : 0}" fill="url(#g)"/>
  <g transform="translate(${o} ${o}) scale(${k})">
    <line x1="330" y1="330" x2="440" y2="440" stroke="${C.ringDeep}" stroke-width="64" stroke-linecap="round"/>
    <circle cx="220" cy="220" r="150" fill="${C.lens}" stroke="${C.ring}" stroke-width="40"/>
    <g fill="${C.paw}">
      <ellipse cx="220" cy="262" rx="56" ry="46"/>
      <ellipse cx="148" cy="200" rx="24" ry="31" transform="rotate(-20 148 200)"/>
      <ellipse cx="190" cy="160" rx="24" ry="32" transform="rotate(-6 190 160)"/>
      <ellipse cx="250" cy="160" rx="24" ry="32" transform="rotate(6 250 160)"/>
      <ellipse cx="292" cy="200" rx="24" ry="31" transform="rotate(20 292 200)"/>
    </g>
  </g>
</svg>`;
}

await mkdir(OUT, { recursive: true });
const jobs = [
  ['icon-192.png', 192, { rounded: true, inset: 0.04 }],
  ['icon-512.png', 512, { rounded: true, inset: 0.04 }],
  ['icon-maskable-512.png', 512, { rounded: false, inset: 0.14 }],
  ['apple-touch-icon.png', 180, { rounded: false, inset: 0.08 }],
];
for (const [name, size, opts] of jobs) {
  await sharp(Buffer.from(svg(opts))).resize(size, size).png().toFile(path.join(OUT, name));
  console.log('wrote icons/' + name);
}
