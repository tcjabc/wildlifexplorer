// Plant seasons, without a browser: its twelve months (scripts/make-layers.mjs plants) as numbers
// and as pictures, the seasons where they should be, the key's colours from the scale, how the layer
// uses Temperature's months path, its words in both languages, and its credit. In the browser:
// tests/globe-plants-touch.test.mjs.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { PLANT_FILES, PLANT_MIN, PLANT_MAX, MONTH_FILES, slotOf, toByte, fromByte } from '../js/globe-months.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sharp = createRequire(import.meta.url)('sharp');
const json = f => JSON.parse(readFileSync(`${ROOT}${f}`, 'utf8'));
const en = json('lang/en.json'), zh = json('lang/zh-TW.json');
const tokens = readFileSync(`${ROOT}css/tokens.css`, 'utf8');
const token = name => tokens.match(new RegExp(`${name}:\\s*([^;]+);`))[1].trim();

test('twelve months as numbers, four to a file at Temperature\'s size, and twelve pictures', async () => {
  let total = 0;
  for (const f of PLANT_FILES) {
    const meta = await sharp(`${ROOT}${f}`).metadata();
    assert.deepEqual([meta.width, meta.height, meta.channels], [720, 360, 4], f);
    total += statSync(`${ROOT}${f}`).size;
  }
  assert.ok(total < 900 * 1024, `the three number files: ${(total / 1024).toFixed(0)} KB`);
  const temp = await sharp(`${ROOT}${MONTH_FILES[0]}`).metadata();
  assert.deepEqual([temp.width, temp.height], [720, 360], 'the same size as Temperature\'s');
  for (let m = 1; m <= 12; m++) {
    const f = `${ROOT}assets/layers/plants-${String(m).padStart(2, '0')}.webp`;
    const meta = await sharp(f).metadata();
    assert.deepEqual([meta.width, meta.height], [2048, 1024], f);
  }
  assert.equal(fromByte(toByte(0.37, PLANT_MIN, PLANT_MAX), PLANT_MIN, PLANT_MAX).toFixed(2), '0.37');
});

test('the seasons where they should be: Europe green in July, southern Africa in January, the Sahara bare', async () => {
  const files = await Promise.all(PLANT_FILES.map(f => sharp(`${ROOT}${f}`).raw().toBuffer({ resolveWithObject: true })));
  const ndvi = (month, lon, lat) => {
    const { tex, ch } = slotOf(month), { data, info } = files[tex];
    const x = Math.floor(((lon + 180) / 360) * info.width), y = Math.floor(((90 - lat) / 180) * info.height);
    return fromByte(data[(y * info.width + x) * 4 + ch], PLANT_MIN, PLANT_MAX);
  };
  assert.ok(ndvi(7, 10, 51) > ndvi(1, 10, 51) + 0.15, `Germany: ${ndvi(1, 10, 51).toFixed(2)} in January, ${ndvi(7, 10, 51).toFixed(2)} in July`);
  assert.ok(ndvi(1, 28, -15) > ndvi(9, 28, -15) + 0.15, `Zambia: ${ndvi(1, 28, -15).toFixed(2)} in January, ${ndvi(9, 28, -15).toFixed(2)} in September`);
  for (const m of [1, 4, 7, 10]) assert.ok(ndvi(m, 25, 24) < 0.12, `the Sahara in month ${m}: ${ndvi(m, 25, 24).toFixed(2)}`);
  assert.ok(ndvi(7, -62, -4) > 0.7, 'the Amazon: deep green');
  assert.equal(ndvi(1, -40, 75), PLANT_MIN, 'Greenland\'s ice: bare');
});

test('the key\'s three swatches are the scale\'s colours, each with a mark; brown to deep green', async () => {
  const stops = token('--c-plant-scale').split(',').map(s => { const [v, c] = s.trim().split(/\s+/); return { v: Number(v), c }; });
  assert.equal(stops[0].v, 0);
  const at = v => stops.find(s => s.v === v)?.c;
  assert.equal(token('--c-plant-few'), at(0));
  assert.equal(token('--c-plant-some'), at(0.3));
  assert.equal(token('--c-plant-many'), at(0.75));
  const { INFO } = await import('../js/globe-info.js');
  assert.deepEqual(INFO.plants.key.map(k => k.token), ['--c-plant-few', '--c-plant-some', '--c-plant-many']);
  for (const k of INFO.plants.key) assert.ok(k.mark, `${k.label}: a mark in its swatch`);
  assert.equal(INFO.plants.clock, 'year');
  assert.ok(INFO.plants.what.length >= 1 && INFO.plants.what.length <= 2);
});

test('on Temperature\'s months path: the base renderer mixes its months, the fallback shows its pictures; Forests unchanged', async () => {
  const { LAYERS } = await import('../js/layers.js');
  const col = n => (n === '--c-plant-scale' ? token('--c-plant-scale') : '#000000');
  const plants = LAYERS.find(l => l.id === 'plants');
  assert.equal(plants.months, true, 'on the year clock');
  const b = plants.gpu({ col, month: 4 }).base;
  assert.equal(b.kind, 'months');
  assert.deepEqual(b.files, PLANT_FILES);
  assert.deepEqual(b.range, [PLANT_MIN, PLANT_MAX]);
  assert.equal(b.land, true, 'on the land only');
  assert.equal(b.pos, 4, 'at the shared month');
  assert.equal((await plants.load({ month: 7 })).raster.tex, 'assets/layers/plants-07.webp');
  assert.equal(plants.pictures.length, 12);
  const forests = LAYERS.find(l => l.id === 'forests');
  assert.equal(forests.gpu({ col }).base.kind, 'classes', 'Forests is still its three forest kinds');
});

test('its words in both languages, listed for checking, and credited (NASA GIBS / MODIS)', async () => {
  const keys = ['layer.plants', 'info.plants.key.few', 'info.plants.key.some', 'info.plants.key.many', 'info.plants.what.1', 'info.plants.what.2', 'info.plants.more.1'];
  const review = readFileSync(`${ROOT}data/zh-ui-review.md`, 'utf8');
  for (const k of keys) {
    assert.ok(en[k] && zh[k], k);
    assert.ok(review.includes(`| \`${k}\` |`), `${k} listed for checking`);
  }
  const { LAYER_CREDITS } = await import('../js/layers.js');
  const c = LAYER_CREDITS.find(x => x.layer === 'plants');
  assert.match(c.author, /GIBS.*MODIS.*NDVI/);
  assert.match(readFileSync(`${ROOT}CREDITS.md`, 'utf8'), /Plant seasons.*MODIS Terra NDVI/);
});
