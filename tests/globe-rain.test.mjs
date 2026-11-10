// Rain, without a browser: its twelve months (scripts/make-layers.mjs rain) as numbers and as
// pictures, the seasons where they should be (the monsoon, the Sahara, Taiwan's plum rains), the scale
// (see-through where dry, one blue getting darker) and the key's colours, how the layer uses the
// months path, its words in both languages, and its credit. In the browser: tests/globe-rain-touch.test.mjs.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { RAIN_FILES, RAIN_MIN, RAIN_MAX, slotOf, fromByte } from '../js/globe-months.js';
import { rampBytes } from '../js/globe-base.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sharp = createRequire(import.meta.url)('sharp');
const json = f => JSON.parse(readFileSync(`${ROOT}${f}`, 'utf8'));
const en = json('lang/en.json'), zh = json('lang/zh-TW.json');
const tokens = readFileSync(`${ROOT}css/tokens.css`, 'utf8');
const token = name => tokens.match(new RegExp(`${name}:\\s*([^;]+);`))[1].trim();

test('twelve months as numbers, four to a file at 720 × 360, and twelve pictures', async () => {
  let total = 0;
  for (const f of RAIN_FILES) {
    const meta = await sharp(`${ROOT}${f}`).metadata();
    assert.deepEqual([meta.width, meta.height, meta.channels], [720, 360, 4], f);
    total += statSync(`${ROOT}${f}`).size;
  }
  for (let m = 1; m <= 12; m++) {
    const f = `${ROOT}assets/layers/rain-${String(m).padStart(2, '0')}.webp`;
    const meta = await sharp(f).metadata();
    assert.deepEqual([meta.width, meta.height], [2048, 1024], f);
    total += statSync(f).size;
  }
  assert.ok(total < 4 * 1024 * 1024, `all fifteen: ${(total / 1024).toFixed(0)} KB`);
});

test('the seasons where they should be: the monsoon, the Sahara, the Sahel, Taiwan\'s plum rains', async () => {
  const files = await Promise.all(RAIN_FILES.map(f => sharp(`${ROOT}${f}`).raw().toBuffer({ resolveWithObject: true })));
  const rain = (month, lon, lat) => {
    const { tex, ch } = slotOf(month), { data, info } = files[tex];
    const x = Math.floor(((lon + 180) / 360) * info.width), y = Math.floor(((90 - lat) / 180) * info.height);
    return fromByte(data[(y * info.width + x) * 4 + ch], RAIN_MIN, RAIN_MAX);
  };
  assert.ok(rain(7, 72.9, 19.1) > 8 && rain(1, 72.9, 19.1) < 1, `Mumbai: ${rain(1, 72.9, 19.1).toFixed(1)} mm a day in January, ${rain(7, 72.9, 19.1).toFixed(1)} in July (the monsoon)`);
  for (const m of [1, 4, 7, 10]) assert.ok(rain(m, 25, 24) < 0.5, `the Sahara in month ${m}: dry`);
  assert.ok(rain(8, 0, 12) > rain(1, 0, 12) + 3, 'the Sahel: rain in August, not January');
  assert.ok(rain(6, 120.9, 23.7) > rain(12, 120.9, 23.7) + 3, `Taiwan: ${rain(12, 120.9, 23.7).toFixed(1)} in December, ${rain(6, 120.9, 23.7).toFixed(1)} in June (the plum rains)`);
  assert.ok(rain(4, -60, -3) > 6, 'the Amazon in April: wet');
  assert.ok(rain(7, -95, -20) < 1, 'the sea off Peru in July: dry');
});

test('the scale: see-through where dry, then one blue getting darker (readable colour-blind); the key\'s swatches', async () => {
  const stops = token('--c-rain-scale').split(',').map(s => { const [v, c] = s.trim().split(/\s+/); return { v: Number(v), c }; });
  assert.match(stops[0].c, /^#[0-9a-f]{6}00$/, 'dry: see-through, so the plain map shows on land and sea');
  const opaque = stops.filter(s => s.c.length === 7);
  const lum = c => { const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  for (let i = 1; i < opaque.length; i++) assert.ok(lum(opaque[i].c) <= lum(opaque[i - 1].c), `darker with more rain: ${opaque[i - 1].c} → ${opaque[i].c}`);
  for (const s of opaque) { const [r, , b] = [1, 3, 5].map(i => parseInt(s.c.slice(i, i + 2), 16)); assert.ok(b > r + 40, `${s.c}: blue`); }
  assert.ok(lum(opaque[0].c) - lum(opaque.at(-1).c) > 0.5, 'from pale to deep');
  assert.equal(token('--c-rain-some'), stops.find(s => s.v === 4).c);
  assert.equal(token('--c-rain-lots'), stops.find(s => s.v === 11).c);
  // The base renderer's scale keeps the see-through end.
  const px = rampBytes([{ v: 0, colour: '#11223300' }, { v: 1, colour: '#112233' }], 3);
  assert.deepEqual([px[3], px[7], px[11]], [0, 128, 255]);
  const { INFO } = await import('../js/globe-info.js');
  assert.deepEqual(INFO.rain.key.map(k => k.token), ['--c-map-land', '--c-rain-some', '--c-rain-lots']);
  for (const k of INFO.rain.key) assert.ok(k.mark, `${k.label}: a mark in its swatch`);
  assert.equal(INFO.rain.clock, 'year');
  assert.equal(INFO.rain.what.length, 2, 'two lines');
  assert.match(en[INFO.rain.more[0]], /monsoon/);
});

test('on the months path, land and sea; Forests unchanged and separate', async () => {
  const { LAYERS } = await import('../js/layers.js');
  const rain = LAYERS.find(l => l.id === 'rain');
  assert.equal(rain.months, true);
  assert.equal(rain.pictures.length, 12);
  const col = n => (n === '--c-rain-scale' ? token('--c-rain-scale') : '#000000');
  const b = rain.gpu({ col, month: 7 }).base;
  assert.equal(b.kind, 'months');
  assert.deepEqual(b.files, RAIN_FILES);
  assert.deepEqual(b.range, [RAIN_MIN, RAIN_MAX]);
  assert.ok(!b.land && !b.sea, 'land and sea both');
  assert.equal(b.pos, 7);
  assert.equal((await rain.load({ month: 1 })).raster.tex, 'assets/layers/rain-01.webp');
  const forests = LAYERS.find(l => l.id === 'forests');
  assert.equal(forests.pictures[0], 'assets/layers/plants-01.webp', 'Forests keeps its own months');
});

test('its words in both languages, listed for checking, and credited (NASA MERRA-2)', async () => {
  const review = readFileSync(`${ROOT}data/zh-ui-review.md`, 'utf8');
  for (const k of ['layer.rain', 'info.rain.key.dry', 'info.rain.key.some', 'info.rain.key.lots', 'info.rain.what.1', 'info.rain.what.2', 'info.rain.more.1']) {
    assert.ok(en[k] && zh[k], k);
    assert.ok(review.includes(`| \`${k}\` |`), `${k} listed for checking`);
  }
  assert.equal(zh['layer.rain'], '雨');
  const { LAYER_CREDITS } = await import('../js/layers.js');
  const c = LAYER_CREDITS.find(x => x.layer === 'rain');
  assert.match(c.author, /MERRA-2.*1991–2020.*GIBS/);
  assert.match(c.license, /CC0/);
  assert.match(readFileSync(`${ROOT}CREDITS.md`, 'utf8'), /🌧️ Rain.*MERRA-2/);
});
