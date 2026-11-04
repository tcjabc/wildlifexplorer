// The country label sits on a translucent pill matched to the photo corner behind it
// (scripts/lib/label-tone.mjs). The text must reach 4.5:1 against the pill over any photo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { decideTone, labelToneOf, cornerBox, sampleBox, contrast, luminance, throughPill, TEXT, PILL, AA, TILE } from '../scripts/lib/label-tone.mjs';

const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const lum = hex => luminance(...rgb(hex));
const grey = v => [v, v, v];
const flat = (px, n = 100) => Array.from({ length: n }, () => px);
const onPill = (px, tone) => contrast(luminance(...throughPill(px, tone)), lum(tone === 'light' ? TEXT.onLight : TEXT.onDark));

test('the text reaches 4.5:1 on the pill even over the worst photo pixel', () => {
  // White pill over pure black, dark pill over pure white: the pill's see-through part at its worst.
  assert.ok(onPill(grey(0), 'light') >= AA, `white pill over black: ${onPill(grey(0), 'light')}`);
  assert.ok(onPill(grey(255), 'dark') >= AA, `dark pill over white: ${onPill(grey(255), 'dark')}`);
  for (const v of [0, 64, 128, 192, 255]) {
    assert.ok(onPill(grey(v), 'light') >= AA && onPill(grey(v), 'dark') >= AA, `grey ${v}`);
  }
});

test('a light corner gets the white pill, a dark corner the dark pill', () => {
  for (const v of [255, 220, 180, 140]) assert.equal(decideTone(flat(grey(v))).tone, 'light', `grey ${v}`);
  for (const v of [0, 30, 60, 90]) assert.equal(decideTone(flat(grey(v))).tone, 'dark', `grey ${v}`);
});

test('no real corner is busy behind the pill: a half black, half white corner still passes', () => {
  const mixed = [...flat(grey(0), 50), ...flat(grey(255), 50)];
  const r = decideTone(mixed);
  assert.ok(r.minContrast >= AA, `lowest ${r.minContrast}`);
  assert.equal(r.busy, false);
});

test('the sampled box is the photo\'s top-right corner, cropped like object-fit: cover', () => {
  const wide = cornerBox(480, 240, 150);
  assert.ok(wide.right < 480 && wide.left > 240, JSON.stringify(wide));
  assert.equal(wide.top, 0);
  const tall = cornerBox(240, 480, 150);
  assert.ok(tall.top > 0 && Math.round(tall.right) === 240, JSON.stringify(tall));
  const b = sampleBox(480, 320);
  assert.ok(b.left >= 0 && b.top >= 0 && b.left + b.width <= 480 && b.top + b.height <= 320);
  assert.ok(b.width >= TILE.label.w && b.height >= TILE.label.h);
});

test('from a real image: a white top-right corner gets the white pill, a black one the dark pill', async () => {
  const w = 480, h = 360;
  const corner = async (bg, fg) => sharp({ create: { width: w, height: h, channels: 3, background: bg } })
    .composite([{ input: { create: { width: 220, height: 130, channels: 3, background: fg } }, left: w - 220, top: 0 }])
    .png().toBuffer();
  assert.equal((await labelToneOf(await corner('#000', '#fff'))).tone, 'light');
  assert.equal((await labelToneOf(await corner('#fff', '#000'))).tone, 'dark');
});

test('every card with a picture has a label tone, and only light or dark', () => {
  const cards = JSON.parse(readFileSync(new URL('../data/animals.json', import.meta.url), 'utf8'));
  for (const c of cards) {
    if ('labelTone' in c) assert.ok(['light', 'dark'].includes(c.labelTone), `${c.id}: ${c.labelTone}`);
    if (c.taiwan && (c.photo ?? c.illustration)?.file) assert.ok(c.labelTone, `${c.id} has no labelTone`);
  }
});

test('the CSS pill and text colours match the ones the build measures with', () => {
  const tokens = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
  assert.match(tokens, new RegExp(`--c-label-on-light:\\s*${TEXT.onLight}`, 'i'));
  assert.match(tokens, new RegExp(`--c-label-on-dark:\\s*${TEXT.onDark}`, 'i'));
  const pill = (name, hex) => {
    const [r, g, b] = rgb(hex);
    assert.match(tokens, new RegExp(`--c-label-pill-${name}:\\s*rgb\\(${r} ${g} ${b} / ${PILL.alpha}\\)`), `--c-label-pill-${name}`);
  };
  pill('light', PILL.light);
  pill('dark', PILL.dark);
  const app = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.match(app, /\.tile__tw \{[^}]*background: var\(--c-label-pill-dark\)/, 'default: the dark pill');
  assert.match(app, /\.tile__tw\[data-tone="light"\] \{[^}]*background: var\(--c-label-pill-light\)/, 'light corner: the white pill');
});
