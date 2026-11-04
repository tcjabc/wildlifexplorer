// Plates & volcanoes, the plates (scripts/make-layers.mjs plates, js/globe.js drawPlates): the
// PB2002 boundaries in three kinds, the teeth on the side of the plate on top, the files'
// density, the plates' motion, their names in both languages, and the credit.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { LAYERS, LAYER_CREDITS } from '../js/layers.js';

const url = path => new URL(`../${path}`, import.meta.url);
const src = path => readFileSync(url(path), 'utf8');
const json = path => JSON.parse(src(path));
const near = json('assets/layers/plates.json'), far = json('assets/layers/plates-far.json');
const motion = json('assets/layers/plates-motion.json').plates;
const en = json('lang/en.json'), zh = json('lang/zh-TW.json');

// [kind, side, points [lon, lat]] from a file's delta-coded runs.
const runs = d => d.lines.map(l => {
  const pts = [[l[2] / 100, l[3] / 100]];
  for (let i = 4; i < l.length; i += 2) { const [x, y] = pts.at(-1); pts.push([x + l[i] / 100, y + l[i + 1] / 100]); }
  return { kind: d.kinds[l[0]], side: l[1], pts };
});
const segs = list => list.flatMap(r => r.pts.slice(1).map((p, i) => Math.hypot(p[0] - r.pts[i][0], p[1] - r.pts[i][1]))).sort((a, b) => a - b);

test('three kinds of boundary, and teeth only where plates crash together', () => {
  for (const d of [near, far]) {
    const list = runs(d);
    assert.deepEqual([...new Set(list.map(r => r.kind))].sort(), ['apart', 'crash', 'slide']);
    for (const r of list) if (r.kind !== 'crash') assert.equal(r.side, 0, `${r.kind}: no teeth`);
    const crash = list.filter(r => r.kind === 'crash');
    assert.ok(crash.filter(r => r.side !== 0).length >= 70, 'subduction zones have a side');
    assert.ok(crash.every(r => [1, -1, 0].includes(r.side)));
  }
});

test('the Manila Trench: the South China Sea dives under the Philippine Sea Plate, so the teeth face east', () => {
  const run = runs(near).find(r => r.kind === 'crash' && Math.abs(r.pts[0][0] - 120.45) < 0.05 && Math.abs(r.pts[0][1] - 21.63) < 0.05);
  assert.ok(run, 'the run west of Luzon');
  assert.ok(run.pts.at(-1)[1] < run.pts[0][1], 'it runs south');
  assert.equal(run.side, 1, 'walking south, the left side is east: the Philippine Sea Plate, on top');
  const make = src('scripts/make-layers.mjs');
  assert.match(make, /"A\/B" means\n\/\/ B dives under A, "A\\B" that A dives under B/, 'PB2002\'s convention, written down');
});

test('the same density as the other line layers, nothing across 180°, and small files', () => {
  const n = segs(runs(near)), f = segs(runs(far));
  const median = a => a[a.length >> 1];
  assert.ok(median(n) < 0.6, `near: median ${median(n).toFixed(2)}°`);
  assert.ok(n.at(-1) < 4.5 && f.at(-1) < 4.5, `longest segments ${n.at(-1).toFixed(1)}°, ${f.at(-1).toFixed(1)}°`);
  assert.ok(f[Math.floor(f.length * 0.99)] <= 3.01, 'far: 99 % under 3°');
  for (const d of [near, far]) for (const r of runs(d)) for (let i = 1; i < r.pts.length; i++) assert.ok(Math.abs(r.pts[i][0] - r.pts[i - 1][0]) < 180, 'no segment goes the long way round');
  assert.ok(statSync(url('assets/layers/plates.json')).size < 80 * 1024);
  assert.ok(statSync(url('assets/layers/plates-far.json')).size < 60 * 1024);
});

test('plate motion: the Pacific fast to the north-west, Eurasia slow, the Philippine Sea Plate towards Taiwan', () => {
  const m = Object.fromEntries(motion.filter(p => p.code === p.name).map(p => [p.code, p]));
  const speed = p => Math.hypot(p.east, p.north), heading = p => ((Math.atan2(p.east, p.north) * 180) / Math.PI + 360) % 360;
  assert.ok(speed(m.PA) > 55 && speed(m.PA) < 100 && Math.abs(heading(m.PA) - 295) < 25, `Pacific ${speed(m.PA)} mm/yr toward ${heading(m.PA)}°`);
  assert.ok(speed(m.EU) < 35, 'Eurasia is slow');
  assert.ok(Math.abs(heading(m.PS) - 300) < 30, `Philippine Sea toward ${heading(m.PS)}°: north-west`);
  for (const p of motion) assert.ok(p.reach > 0 && Math.abs(p.lat) <= 75, `${p.code}: a label point inside the plate`);
  assert.deepEqual(motion.filter(p => p.code !== p.name).map(p => [p.code, p.name]), [['YA', 'EU'], ['SU', 'EU']], 'west of Taiwan is named the Eurasian Plate');
});

test('the layer: one chip, its names and key in both languages, credited (ODC-By)', () => {
  const L = LAYERS.find(l => l.id === 'plates');
  assert.ok(L && L.emoji);
  assert.ok(en['layer.plates'] && zh['layer.plates'] === '板塊與火山');
  for (const p of motion) {
    assert.ok(en[`plate.${p.name}`]?.endsWith('Plate'), `en plate.${p.name}`);
    assert.ok(zh[`plate.${p.name}`]?.endsWith('板塊'), `zh plate.${p.name}`);
  }
  const c = LAYER_CREDITS.find(x => x.layer === 'plates');
  assert.match(c.author, /Bird \(2003\).*Ahlenius/);
  assert.equal(c.license, 'ODC-By 1.0');
  assert.match(src('CREDITS.md'), /PB2002.*ODC-By 1\.0/);
  const sw = src('sw.js');
  assert.match(sw, /const VERSION = 'v36';/);
  assert.match(sw, /const LAYERS_VERSION = 'l4';/);
});

test('drawn as planned: dashes for sliding past, a cut-out double line for pulling apart, teeth for crashing together', () => {
  const g = src('js/globe.js');
  assert.match(g, /platePath\(list, 'slide'\);\n\s*ctx\.setLineDash/);
  assert.match(g, /platePath\(list, 'apart'\);[\s\S]*?destination-out/);
  assert.match(g, /platePath\(list, 'crash', teeth\);/);
  assert.match(g, /const nx = uy \* sd, ny = -ux \* sd;/, 'side 1: the left of the way along, on screen');
  assert.match(g, /const list = view\.k >= NEAR_K \? near : far, w = coastWidth\(view\.k\);/, 'the coastline\'s widths');
});
