// The country label's colour follows the photo corner behind it (scripts/lib/label-tone.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { decideTone, labelToneOf, cornerBox, sampleBox, contrast, luminance, TEXT, AA, TILE } from '../scripts/lib/label-tone.mjs';

const lum = hex => { const n = parseInt(hex.slice(1), 16); return luminance(n >> 16, (n >> 8) & 255, n & 255); };
const flat = (l, n = 100) => new Float64Array(n).fill(l);

test('light corners get near-black text, dark corners white text, and the choice passes 4.5:1', () => {
  for (const l of [1, 0.8, 0.5, 0.3, 0.25]) {
    const r = decideTone(flat(l));
    assert.equal(r.tone, 'light', `L=${l}`);
    assert.ok(contrast(l, lum(TEXT.onLight)) >= AA && r.passes, `L=${l}: ${r.contrast}`);
  }
  for (const l of [0, 0.02, 0.08, 0.15]) {
    const r = decideTone(flat(l));
    assert.equal(r.tone, 'dark', `L=${l}`);
    assert.ok(contrast(l, lum(TEXT.onDark)) >= AA && r.passes, `L=${l}: ${r.contrast}`);
  }
});

test('a mid-grey corner where neither colour reaches 4.5:1 is reported as busy', () => {
  const r = decideTone(flat(0.19));
  assert.equal(r.passes, false);
  assert.equal(r.busy, true);
});

test('a corner that is half black, half white is busy even when the average looks fine', () => {
  const lums = new Float64Array(100);
  for (let i = 0; i < 100; i++) lums[i] = i < 50 ? 0 : 1;
  const r = decideTone(lums);
  assert.equal(r.busy, true);
  assert.ok(r.poorShare >= 0.45);
});

test('the sampled box is the photo\'s top-right corner, cropped like object-fit: cover', () => {
  // A wide photo is cropped at the sides, so the box sits inside the image, away from its edge.
  const wide = cornerBox(480, 240, 150);
  assert.ok(wide.right < 480 && wide.left > 240, JSON.stringify(wide));
  assert.equal(wide.top, 0);
  // A tall photo is cropped top and bottom: the box starts below the image's top edge.
  const tall = cornerBox(240, 480, 150);
  assert.ok(tall.top > 0 && Math.round(tall.right) === 240, JSON.stringify(tall));
  // Both tile widths together, clamped to the image.
  const b = sampleBox(480, 320);
  assert.ok(b.left >= 0 && b.top >= 0 && b.left + b.width <= 480 && b.top + b.height <= 320);
  assert.ok(b.width >= TILE.label.w && b.height >= TILE.label.h);
});

test('from a real image: a white top-right corner on a black photo means dark text', async () => {
  const w = 480, h = 360;
  const black = await sharp({ create: { width: w, height: h, channels: 3, background: '#000' } })
    .composite([{ input: { create: { width: 200, height: 120, channels: 3, background: '#fff' } }, left: w - 200, top: 0 }])
    .png().toBuffer();
  assert.equal((await labelToneOf(black)).tone, 'light');
  const white = await sharp({ create: { width: w, height: h, channels: 3, background: '#fff' } })
    .composite([{ input: { create: { width: 200, height: 120, channels: 3, background: '#000' } }, left: w - 200, top: 0 }])
    .png().toBuffer();
  assert.equal((await labelToneOf(white)).tone, 'dark');
});

test('every card with a picture has a label tone, and only light or dark', () => {
  const cards = JSON.parse(readFileSync(new URL('../data/animals.json', import.meta.url), 'utf8'));
  for (const c of cards) {
    if ('labelTone' in c) assert.ok(['light', 'dark'].includes(c.labelTone), `${c.id}: ${c.labelTone}`);
    if (c.taiwan && (c.photo ?? c.illustration)?.file) assert.ok(c.labelTone, `${c.id} has no labelTone`);
  }
});

test('the CSS colours match the ones the build measures against', () => {
  const tokens = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, new RegExp(`--c-label-on-light:\\s*${TEXT.onLight}`, 'i'));
  assert.match(tokens, new RegExp(`--c-label-on-dark:\\s*${TEXT.onDark}`, 'i'));
});
