// Topography's sea level, without a browser: the floor's file (scripts/make-layers.mjs elevation),
// where it is used, the clock's words in both languages, and its credit. In the browser:
// tests/globe-sea-level.test.mjs.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sharp = createRequire(import.meta.url)('sharp');
const FILE = `${ROOT}assets/layers/elevation-2k.webp`;
const json = f => JSON.parse(readFileSync(`${ROOT}${f}`, 'utf8'));
const src = f => readFileSync(`${ROOT}${f}`, 'utf8');
const en = json('lang/en.json'), zh = json('lang/zh-TW.json');

test('the floor: 2048 × 1024, small, a metre a byte; the Taiwan Strait shallow enough to close at −120 m', async () => {
  assert.ok(statSync(FILE).size < 200 * 1024, `${statSync(FILE).size} bytes`);
  const { data, info } = await sharp(FILE).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [2048, 1024]);
  const at = (lon, lat) => data[Math.floor(((90 - lat) / 180) * info.height) * info.width + Math.floor(((lon + 180) / 360) * info.width)];
  assert.equal(at(121, 23.5), 0, 'Taiwan: land');
  assert.equal(at(-100, 40), 0, 'North America: land');
  // Across the strait at 24.5° N, from Fujian to Taiwan: today's sea, all of it under 120 m.
  const across = [119.25, 119.5, 119.75, 120.0, 120.25].map(lon => at(lon, 24.5));
  for (const d of across) assert.ok(d >= 1 && d < 120, `strait: ${across}`);
  assert.equal(at(-150, 0), 255, 'the middle of the Pacific: deep');
  assert.equal(at(50.5, 42), 255, 'the Caspian keeps its own level');
  assert.equal(at(34, 43), 255, 'and so does the Black Sea');
  assert.ok(at(3, 55) >= 1 && at(3, 55) < 40, 'Dogger Bank in the North Sea: shallow (Doggerland)');
});

test('Topography uses it on both renderers, dry land in the green lowlands colour', async () => {
  const { LAYERS } = await import('../js/layers.js');
  const relief = LAYERS.find(l => l.id === 'relief');
  const col = n => ({ '--c-relief-low': '#acc9ae' })[n] ?? '#000000';
  assert.deepEqual(relief.gpu({ col }).base.floor, { tex: 'assets/layers/elevation-2k.webp', dry: '#acc9ae' });
  const fallback = (await relief.load({ col })).raster.floor;
  assert.equal(fallback.tex, 'assets/layers/elevation-2k.webp');
  assert.deepEqual(fallback.dry.map(v => Math.round(v * 255)), [0xac, 0xc9, 0xae]);
  const { INFO } = await import('../js/globe-info.js');
  assert.equal(INFO.relief.clock, 'sea-level');
});

test('Topography\'s sea in Ocean depth\'s zones: the same file and colours on both renderers, and its key', async () => {
  const { LAYERS, depthZones, depthStops } = await import('../js/layers.js');
  const tokens = { '--c-map-sea': '#d8eef6', '--c-depth-1': '#9fd0ec', '--c-depth-2': '#5ea7d8', '--c-depth-3': '#2f78bd', '--c-depth-4': '#1b4b8f', '--c-relief-low': '#acc9ae' };
  const col = n => tokens[n] ?? '#000000';
  const relief = LAYERS.find(l => l.id === 'relief');
  const r = relief.gpu({ col }).base, d = { tex: 'assets/layers/depth-2k.webp' };
  assert.match(src('js/layers.js'), /kind: 'ramp', tex: ZONES, stops: depthStops\(col\)/, 'Ocean depth draws the same file with the same scale');
  assert.equal(r.sea.tex, d.tex, 'one file for both: no second download');
  assert.deepEqual(r.stops, depthStops(col));
  assert.equal(r.bands, 5);
  const fallback = (await relief.load({ col })).raster.sea;
  assert.equal(fallback.tex, d.tex);
  assert.deepEqual(fallback.colours.map(c => c.map(v => Math.round(v * 255))), depthZones(col).map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))));
  const { INFO } = await import('../js/globe-info.js');
  assert.deepEqual(INFO.relief.key.slice(-2).map(k => [k.label, k.token]), [['info.relief.key.shallow', '--c-map-sea'], ['info.relief.key.deep', '--c-depth-4']]);
  const review = readFileSync(`${ROOT}data/zh-ui-review.md`, 'utf8');
  for (const k of ['info.relief.key.shallow', 'info.relief.key.deep']) {
    assert.ok(en[k] && zh[k], k);
    assert.ok(review.includes(`\`${k}\``), `${k} listed for checking`);
  }
});

test('the clock\'s words in both languages, and a true minus sign', async () => {
  for (const k of ['layer.relief.today', 'layer.relief.iceAge', 'layer.relief.iceAgeWhen', 'layer.relief.level', 'layer.relief.levelText', 'layer.relief.play', 'layer.relief.pause', 'unit.m']) {
    assert.ok(en[k] && zh[k], k);
  }
  assert.equal(en['layer.relief.iceAge'], 'Ice Age');
  assert.equal(zh['layer.relief.iceAge'], '冰河時期');
  const review = readFileSync(`${ROOT}data/zh-ui-review.md`, 'utf8');
  for (const k of ['layer.relief.today', 'layer.relief.iceAge', 'layer.relief.iceAgeWhen', 'layer.relief.level', 'layer.relief.play', 'unit.m']) assert.ok(review.includes(`\`${k}\``), `${k} listed for checking`);
  const { seaText } = await import('../js/units.js');
  assert.equal(seaText(-74).en, '−74 unit.m', 'a true minus sign (strings are not loaded here: the key shows)');
  assert.equal(seaText(0).en, '0 unit.m');
  assert.equal(seaText(-120.4).en, '−120 unit.m');
});

test('credited: ETOPO 2022, CC0, on the Credits page and in CREDITS.md', async () => {
  const { LAYER_CREDITS } = await import('../js/layers.js');
  const c = LAYER_CREDITS.find(x => /ETOPO 2022/.test(x.author));
  assert.ok(c, 'in LAYER_CREDITS');
  assert.equal(c.layer, 'relief');
  assert.match(c.license, /CC0/);
  assert.match(c.sourceUrl, /^https:\/\/www\.ncei\.noaa\.gov\//);
  assert.match(readFileSync(`${ROOT}CREDITS.md`, 'utf8'), /ETOPO 2022/);
});
