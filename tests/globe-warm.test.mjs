// Coral reefs' warm water, without a browser: its twelve months (scripts/make-layers.mjs warmwater) as
// numbers and as pictures, the seasons where they should be, the scale and the key's colours, how the
// layer uses the months path with the reefs on top, its words in both languages, and its credit. In
// the browser: tests/globe-warm-touch.test.mjs.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { WARM_FILES, WARM_MIN, WARM_MAX, slotOf, fromByte } from '../js/globe-months.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sharp = createRequire(import.meta.url)('sharp');
const json = f => JSON.parse(readFileSync(`${ROOT}${f}`, 'utf8'));
const en = json('lang/en.json'), zh = json('lang/zh-TW.json');
const tokens = readFileSync(`${ROOT}css/tokens.css`, 'utf8');
const token = name => tokens.match(new RegExp(`${name}:\\s*([^;]+);`))[1].trim();

test('twelve months as numbers, four to a file at 720 × 360, twelve pictures, all small', async () => {
  let total = 0;
  for (const f of WARM_FILES) {
    const meta = await sharp(`${ROOT}${f}`).metadata();
    assert.deepEqual([meta.width, meta.height, meta.channels], [720, 360, 4], f);
    total += statSync(`${ROOT}${f}`).size;
  }
  for (let m = 1; m <= 12; m++) {
    const f = `${ROOT}assets/layers/warm-${String(m).padStart(2, '0')}.webp`;
    const meta = await sharp(f).metadata();
    assert.deepEqual([meta.width, meta.height], [2048, 1024], f);
    total += statSync(f).size;
  }
  assert.ok(total < 1024 * 1024, `all fifteen: ${(total / 1024).toFixed(0)} KB`);
});

test('the seasons where they should be: the Coral Sea, the Caribbean, the Mediterranean, the Southern Ocean', async () => {
  const files = await Promise.all(WARM_FILES.map(f => sharp(`${ROOT}${f}`).raw().toBuffer({ resolveWithObject: true })));
  const sst = (month, lon, lat) => {
    const { tex, ch } = slotOf(month), { data, info } = files[tex];
    const x = Math.floor(((lon + 180) / 360) * info.width), y = Math.floor(((90 - lat) / 180) * info.height);
    return fromByte(data[(y * info.width + x) * 4 + ch], WARM_MIN, WARM_MAX);
  };
  assert.ok(sst(2, 152, -17) >= 26, `the Coral Sea in February: ${sst(2, 152, -17).toFixed(1)} °C`);
  const aug = sst(8, 152, -17);
  assert.ok(aug >= 20 && aug < 26, `the Coral Sea in August: ${aug.toFixed(1)} °C`);
  assert.ok(sst(8, -75, 15) >= 26, 'the Caribbean in August: very warm');
  assert.ok(sst(8, 18, 35) > sst(2, 18, 35) + 6, 'the Mediterranean: warmer in August');
  for (const m of [2, 8]) assert.ok(sst(m, 0, -60) < 5, `the Southern Ocean in month ${m}: cold`);
  assert.ok(sst(8, 121.8, 23) >= 26 && sst(2, 121.8, 23) < 26, 'off Taiwan\'s east coast: very warm in August, not in February');
});

test('the scale: the plain sea below 20 °C, warm from 20, very warm from 26; the key\'s swatches are its colours', async () => {
  const stops = token('--c-warm-scale').split(',').map(s => { const [v, c] = s.trim().split(/\s+/); return { v: Number(v), c }; });
  const at = v => { let c = stops[0].c; for (const s of stops) if (v >= s.v) c = s.c; return c; };
  assert.equal(at(10), token('--c-map-sea'), 'below 20 °C: the plain map\'s sea');
  assert.equal(at(19.9), token('--c-map-sea'));
  assert.equal(at(20), token('--c-warm-water'));
  assert.equal(at(25.9), token('--c-warm-water'));
  assert.equal(at(26), token('--c-warm-water-hot'));
  assert.equal(at(33), token('--c-warm-water-hot'));
  const { INFO } = await import('../js/globe-info.js');
  const rows = INFO.reefs.key;
  assert.deepEqual(rows.map(k => k.token), ['--c-reef-fill', '--c-warm-water', '--c-warm-water-hot'], 'the reefs first, then the warm water');
  assert.deepEqual(rows.slice(1).map(k => k.temp), [20, 26]);
  for (const k of rows) assert.ok(k.mark, `${k.label}: a mark in its swatch`);
  assert.equal(INFO.reefs.clock, 'year');
  assert.equal(INFO.reefs.what.length, 2, 'the panel still two lines');
});

test('on the months path, the sea only, with the reefs on top on both renderers', async () => {
  const { LAYERS } = await import('../js/layers.js');
  const reefs = LAYERS.find(l => l.id === 'reefs');
  assert.equal(reefs.months, true, 'on the year clock');
  assert.equal(reefs.pictures.length, 12);
  const layers = readFileSync(`${ROOT}js/layers.js`, 'utf8');
  assert.match(layers, /kind: 'months', files: WARM_FILES, range: \[WARM_MIN, WARM_MAX\], sea: true, stops: warmStops\(col\)/);
  assert.match(readFileSync(`${ROOT}js/globe-base.js`, 'utf8'), /uLandOnly > 0\.5 \? land : uSeaOnly > 0\.5 \? 1\.0 - land : 1\.0/, 'the shader: the sea only');
  assert.match(readFileSync(`${ROOT}js/globe.js`, 'utf8'), /if \(layer\?\.raster && layer\.sea\) fillAll\(layer\.sea\);/, 'without the base renderer, the reefs above the picture');
});

test('its words in both languages, listed for checking, and credited (NOAA OISST)', async () => {
  const review = readFileSync(`${ROOT}data/zh-ui-review.md`, 'utf8');
  for (const k of ['info.reefs.key.warm', 'info.reefs.key.hot', 'info.reefs.what.2']) {
    assert.ok(en[k] && zh[k], k);
    assert.ok(review.includes(`| \`${k}\` |`), `${k} listed for checking`);
  }
  assert.match(zh['info.reefs.key.warm'], /^暖水/);
  assert.ok(en['info.reefs.more.2'] && zh['info.reefs.more.2'], 'the algae line kept, in "Did you know?"');
  const { LAYER_CREDITS } = await import('../js/layers.js');
  const c = LAYER_CREDITS.find(x => /OISST/.test(x.author));
  assert.equal(c?.layer, 'reefs');
  assert.match(c.author, /NOAA PSL, Boulder, Colorado/);
  assert.match(readFileSync(`${ROOT}CREDITS.md`, 'utf8'), /Coral reefs: warm water.*OISST v2\.1/);
});
