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

test('Topography\'s sea: one blue shaded by the sea floor, the same on both renderers, and its key', async () => {
  const { LAYERS, SEA_HILL } = await import('../js/layers.js');
  const col = n => ({ '--c-relief-sea': '#4a86c0', '--c-relief-low': '#acc9ae' })[n] ?? '#000000';
  const relief = LAYERS.find(l => l.id === 'relief');
  const r = relief.gpu({ col }).base;
  assert.deepEqual(r.sea, { tex: 'assets/layers/seafloor-2k.webp', colour: '#4a86c0', hill: SEA_HILL });
  assert.equal(r.ice.tex, 'assets/layers/icesheets-2k.webp');
  assert.equal(r.stops, undefined, 'no depth zones on Topography');
  assert.doesNotMatch(JSON.stringify(r), /depth-2k/, 'Ocean depth\'s file is not needed');
  const fallback = (await relief.load({ col })).raster.sea;
  assert.equal(fallback.tex, r.sea.tex);
  assert.equal(fallback.hill, SEA_HILL);
  assert.deepEqual(fallback.colour.map(v => Math.round(v * 255)), [0x4a, 0x86, 0xc0]);
  const { INFO } = await import('../js/globe-info.js');
  const row = INFO.relief.key.find(k => k.label === 'info.relief.key.floor');
  assert.equal(row.token, '--c-relief-sea');
  assert.ok(row.mark, 'a mark in its swatch');
  assert.equal(INFO.relief.key.filter(k => /sea|floor|shallow|deep/.test(k.label)).length, 1, 'one sea row');
  assert.equal(INFO.relief.what.length, 2, 'the panel stays at two lines');
  assert.match(en['info.relief.what.1'], /ridges and valleys/);
  assert.match(zh['info.relief.what.1'], /海底/);
  const review = readFileSync(`${ROOT}data/zh-ui-review.md`, 'utf8');
  for (const k of ['info.relief.key.floor', 'info.relief.what.1']) {
    assert.ok(en[k] && zh[k], k);
    assert.ok(review.includes(`\`${k}\``), `${k} listed for checking`);
  }
  for (const k of ['info.relief.key.shallow', 'info.relief.key.deep']) assert.equal(en[k], undefined, `${k} gone`);
});

test('the sea floor file: 2048 × 1024, small, flat on land, the Mid-Atlantic Ridge lit on its north-west side', async () => {
  const file = `${ROOT}assets/layers/seafloor-2k.webp`;
  assert.ok(statSync(file).size < 600 * 1024, `${statSync(file).size} bytes`);
  const { data, info } = await sharp(file).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [2048, 1024]);
  const at = (lon, lat) => data[Math.floor(((90 - lat) / 180) * info.height) * info.width + Math.floor(((lon + 180) / 360) * info.width)];
  const mean = (w, e, s, n) => { let t = 0, c = 0; for (let lon = w; lon <= e; lon += 0.25) for (let lat = s; lat <= n; lat += 0.25) { t += at(lon, lat); c++; } return t / c; };
  assert.equal(at(-100, 40), 128, 'North America: flat (land, never shown)');
  assert.ok(Math.abs(at(121, 23.5) - 128) <= 8, 'Taiwan: about flat (the lossy file rings a little by a narrow coast)');
  // At 25–35° N the ridge's axis is near 42–45° W: its western flank faces the light, its eastern one away.
  const west = mean(-52, -46, 25, 35), east = mean(-40, -34, 25, 35);
  assert.ok(west - east > 8, `the ridge: lit ${west.toFixed(1)} west, ${east.toFixed(1)} east`);
  let lo = 255, hi = 0;
  for (let lon = 140; lon <= 148; lon += 0.2) { const v = at(lon, 15); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(hi - lo > 80, `the Mariana arc and trench in strong light and shade: ${lo}–${hi}`);
});

test('the Ice Age ice sheets: none at 0 m, the Laurentide and Scandinavia at −120 m, today\'s ice left as it is', async () => {
  const file = `${ROOT}assets/layers/icesheets-2k.webp`;
  assert.ok(statSync(file).size < 150 * 1024, `${statSync(file).size} bytes`);
  const { data, info } = await sharp(file).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  assert.deepEqual([info.width, info.height], [2048, 1024]);
  const need = (lon, lat) => data[Math.floor(((90 - lat) / 180) * info.height) * info.width + Math.floor(((lon + 180) / 360) * info.width)];
  // The shaders: ice where the sea has gone down at least the need, softly, and none at 0 m.
  const ice = (n, drop) => { const t = Math.min(1, Math.max(0, (drop - (n - 8)) / 8)); return t * t * (3 - 2 * t) * Math.min(1, drop); };
  const places = { 'Hudson Bay': [-85, 60], 'Chicago (the ice reached it)': [-87.6, 42.5], 'Oslo': [10.7, 60], 'Scotland': [-4.5, 57] };
  for (const [name, at] of Object.entries(places)) {
    assert.equal(ice(need(...at), 0), 0, `${name}: no ice today`);
    assert.ok(ice(need(...at), 120) > 0.99, `${name}: ice in the Ice Age (needs ${need(...at)} m)`);
  }
  assert.ok(need(-85, 60) < need(-87.6, 42.5), 'the ice left Chicago before Hudson Bay');
  for (const [name, at] of Object.entries({ 'Greenland': [-40, 75], 'Antarctica': [0, -80], 'Taiwan': [121, 23.5], 'Florida': [-81.5, 28] })) assert.equal(need(...at), 255, `${name}: never drawn`);
  const src = readFileSync(`${ROOT}js/globe-base.js`, 'utf8') + readFileSync(`${ROOT}js/globegl.js`, 'utf8');
  assert.equal(src.match(/smoothstep\(need - 8\.0, need, -uLevel\) \* clamp\(-uLevel, 0\.0, 1\.0\)/g)?.length, 2, 'both shaders draw it the same way');
  const { INFO } = await import('../js/globe-info.js');
  const row = INFO.relief.key.find(k => k.label === 'info.relief.key.ice');
  assert.ok(row?.mark && row.token === '--c-ice-sheet', 'its key row, with a mark');
  assert.equal(INFO.relief.what.length, 2, 'the panel still two lines');
  assert.match(en['info.relief.what.2'], /locked up in the ice/);
  assert.match(zh['info.relief.what.2'], /冰蓋/);
  assert.equal(zh['info.relief.key.ice'], '冰蓋');
  const review = readFileSync(`${ROOT}data/zh-ui-review.md`, 'utf8');
  for (const k of ['info.relief.key.ice', 'info.relief.what.2']) assert.ok(review.includes(`| \`${k}\` |`), `${k} listed for checking`);
  const { LAYER_CREDITS } = await import('../js/layers.js');
  const c = LAYER_CREDITS.find(x => /PaleoMIST/.test(x.author));
  assert.equal(c?.license, 'CC BY 4.0');
  assert.match(readFileSync(`${ROOT}CREDITS.md`, 'utf8'), /PaleoMIST 1\.0/);
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
