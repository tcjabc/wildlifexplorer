// The wooden desk behind Field Notes: img/desk/wood.webp, a placeholder drawn here and kept behind
// --desk-texture in css/tokens.css so another picture can take its place. A tabletop, not a floor:
// a few wide boards close in colour, with soft grain and thin joins, in the app's style, not a
// photograph. It tiles: every board, line and knot meets itself across the edge.
// Run: node scripts/make-desk.mjs
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const SIZE = 1024;      // shown at half this (--desk-texture-size)
const PLANKS = 2;
const PLANK = SIZE / PLANKS;
const SEAM = 4;
const COLOURS = ['#815a3b', '#7c5536'];
const GRAIN = '#74502f', LIGHT = '#8a6344', SEAM_COLOUR = '#5e3f27';

// The same random lines each run.
let seed = 7;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// A line of grain along a plank: it wanders in whole waves, so it meets itself across the tile.
function grain(y, colour, width) {
  const waves = 1 + Math.floor(rnd() * 3), height = 3 + rnd() * 9, shift = rnd() * Math.PI * 2;
  const pts = [];
  for (let x = 0; x <= SIZE; x += 16) pts.push(`${x},${(y + Math.sin((x / SIZE) * Math.PI * 2 * waves + shift) * height).toFixed(1)}`);
  return `<polyline points="${pts.join(' ')}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function knot(x, y) {
  const rings = [26, 15].map(r => `<ellipse cx="${x}" cy="${y}" rx="${r * 2.2}" ry="${r}" fill="none" stroke="${GRAIN}" stroke-width="3"/>`);
  return rings.join('');
}

let body = '';
for (let p = 0; p < PLANKS; p++) {
  const top = p * PLANK;
  body += `<rect x="0" y="${top}" width="${SIZE}" height="${PLANK}" fill="${COLOURS[p]}"/>`;
  for (let i = 0; i < 11; i++) body += grain(top + 24 + rnd() * (PLANK - 48), i % 3 ? GRAIN : LIGHT, i % 3 ? 3 : 2);
  const kx = 120 + rnd() * (SIZE - 240), ky = top + PLANK / 2 + (rnd() - 0.5) * 60;
  if (p === 0) body += knot(kx, ky);
  body += `<rect x="0" y="${top - SEAM / 2}" width="${SIZE}" height="${SEAM}" fill="${SEAM_COLOUR}"/>`;
}
// The first plank's seam also closes the bottom of the tile.
body += `<rect x="0" y="${SIZE - SEAM / 2}" width="${SIZE}" height="${SEAM}" fill="${SEAM_COLOUR}"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">${body}</svg>`;
await mkdir(new URL('../img/desk/', import.meta.url), { recursive: true });
const out = new URL('../img/desk/wood.webp', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const info = await sharp(Buffer.from(svg)).webp({ quality: 72, effort: 6 }).toFile(out);
console.log(`img/desk/wood.webp: ${info.width} × ${info.height}, ${(info.size / 1024).toFixed(1)} KB`);
