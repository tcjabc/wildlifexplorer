// Forests, without a browser: its green by month (Plant seasons' data, scripts/make-layers.mjs plants)
// as numbers and as pictures, the seasons where they should be, the key (the three forest kinds and
// the green, with the scale's colours), how the layer uses Temperature's months path with the forest
// kinds as outlines on top, its words in both languages, and its credits. In the browser:
// tests/globe-forests-touch.test.mjs.
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

test('the key: the three forest kinds with their trees, then the green, the scale\'s colours, each with a mark', async () => {
  const stops = token('--c-plant-scale').split(',').map(s => { const [v, c] = s.trim().split(/\s+/); return { v: Number(v), c }; });
  assert.equal(stops[0].v, 0);
  const at = v => stops.find(s => s.v === v)?.c;
  assert.equal(token('--c-plant-few'), at(0));
  assert.equal(token('--c-plant-some'), at(0.3));
  assert.equal(token('--c-plant-many'), at(0.75));
  const { INFO } = await import('../js/globe-info.js');
  const key = INFO.forests.key;
  assert.deepEqual(key.slice(0, 3).map(k => k.tree), ['tropical', 'temperate', 'boreal'], 'the forest kinds, a tree in each swatch');
  assert.deepEqual(key.slice(0, 3).map(k => k.token), ['--c-forest-tropical', '--c-forest-temperate', '--c-forest-boreal']);
  assert.deepEqual(key.slice(3).map(k => k.token), ['--c-plant-few', '--c-plant-some', '--c-plant-many']);
  for (const k of key.slice(3)) assert.ok(k.mark, `${k.label}: a mark in its swatch`);
  assert.equal(INFO.forests.clock, 'year');
  assert.equal(INFO.forests.what.length, 2, 'two lines');
  assert.ok(INFO.forests.more.length >= 1, 'and a Did you know?');
  assert.equal(INFO.plants, undefined, 'no Plant seasons panel any more');
});

test('Forests on Temperature\'s months path, the forest kinds as outlines on top; no Plant seasons layer', async () => {
  const { LAYERS } = await import('../js/layers.js');
  assert.equal(LAYERS.find(l => l.id === 'plants'), undefined, 'no separate layer, and no picker tile');
  const forests = LAYERS.find(l => l.id === 'forests');
  assert.equal(forests.months, true, 'on the year clock');
  assert.equal(forests.pictures.length, 12);
  assert.equal(forests.pictures[6], 'assets/layers/plants-07.webp', 'Plant seasons\' pictures, for the fallback');
  const src = readFileSync(`${ROOT}js/layers.js`, 'utf8');
  assert.match(src, /kind: 'months', files: PLANT_FILES, range: \[PLANT_MIN, PLANT_MAX\], land: true, stops: plantStops\(col\), bands: 0, hill: 0\.35, pos: month, tiles: RELIEF_TILES/, 'the green by month, on the land, with the relief\'s zoom tiles');
  assert.equal(src.match(/outlines: await forestOutlines\(col\)/g)?.length, 2, 'the forest kinds on both renderers');
  assert.match(src, /forests-far\.topo\.json`, `\$\{DIR\}forests\.topo\.json/, 'from the RESOLVE shapes, far and near');
  assert.match(src, /halo: col\('--c-forest-halo'\)/, 'on a light halo');
  assert.match(readFileSync(`${ROOT}js/globe.js`, 'utf8'), /if \(layer\?\.outlines\) drawOutlines\(layer\.outlines\);\n\s*if \(polys\?\.coast\) drawCoast/, 'just under the coastline');
});

test('its words in both languages, listed for checking, and credited (RESOLVE; NASA GIBS / MODIS)', async () => {
  const keys = ['info.plants.key.few', 'info.plants.key.some', 'info.plants.key.many', 'info.plants.what.1', 'info.plants.more.1', 'info.forests.what.1'];
  for (const gone of ['layer.plants', 'info.plants.what.2']) {
    assert.equal(en[gone], undefined, `${gone} gone`);
    assert.equal(zh[gone], undefined, `${gone} gone`);
  }
  assert.equal(en['layer.forests'], 'Forests', 'the tile\'s name unchanged');
  const review = readFileSync(`${ROOT}data/zh-ui-review.md`, 'utf8');
  for (const k of keys) {
    assert.ok(en[k] && zh[k], k);
    assert.ok(review.includes(`| \`${k}\` |`), `${k} listed for checking`);
  }
  const { LAYER_CREDITS } = await import('../js/layers.js');
  const credits = LAYER_CREDITS.filter(x => x.layer === 'forests');
  assert.ok(credits.some(c => /RESOLVE/.test(c.author)), 'RESOLVE, for the forest kinds');
  assert.ok(credits.some(c => /GIBS.*MODIS.*NDVI/.test(c.author)), 'NASA GIBS / MODIS, for the green');
  const md = readFileSync(`${ROOT}CREDITS.md`, 'utf8');
  assert.match(md, /🌳 Forests: green by month.*MODIS Terra NDVI/);
  assert.match(md, /🌳 Forests \| \[RESOLVE/);
});
