// Ocean depth's currents, without a browser: the hand-traced file (assets/layers/currents.json), its
// lines never crossing the land, each with a direction and warm or cold, the Kuroshio past Taiwan,
// and the words in both languages. In the browser: tests/globe-currents-touch.test.mjs.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { currentPoints } from '../js/layers.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const json = f => JSON.parse(readFileSync(`${ROOT}${f}`, 'utf8'));
const data = json('assets/layers/currents.json');
const en = json('lang/en.json'), zh = json('lang/zh-TW.json');

// The land as drawn (assets/globe.json, detailed): is a place on it?
const globe = json('assets/globe.json');
const land = globe.near.map(rings => rings.map(flat => { const r = []; for (let i = 0; i < flat.length; i += 2) r.push([flat[i] * globe.unit, flat[i + 1] * globe.unit]); return r; }));
const boxes = land.map(rings => { const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; });
function onLand(lon, lat) {
  const x = ((((lon + 180) % 360) + 360) % 360) - 180;
  return land.some((rings, n) => {
    const [w, e, s, nn] = boxes[n];
    if (x < w || x > e || lat < s || lat > nn) return false;
    let inside = false;
    for (const ring of rings) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && x < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  });
}

test('about 15 major currents, each warm or cold, every line at sea', () => {
  const ids = data.currents.map(c => c.id);
  for (const id of ['kuroshio', 'oyashio', 'gulf-stream', 'north-atlantic-drift', 'labrador', 'canary', 'benguela', 'agulhas', 'brazil', 'humboldt', 'california', 'east-australian', 'antarctic-circumpolar', 'nec-pacific', 'sec-pacific', 'nec-atlantic', 'sec-atlantic']) assert.ok(ids.includes(id), id);
  assert.equal(new Set(ids).size, ids.length, 'one of each');
  const warm = Object.fromEntries(data.currents.map(c => [c.id, c.warm]));
  for (const id of ['kuroshio', 'gulf-stream', 'north-atlantic-drift', 'agulhas', 'brazil', 'east-australian', 'nec-pacific', 'sec-pacific', 'nec-atlantic', 'sec-atlantic']) assert.equal(warm[id], true, `${id}: warm`);
  for (const id of ['oyashio', 'labrador', 'canary', 'benguela', 'humboldt', 'california', 'antarctic-circumpolar']) assert.equal(warm[id], false, `${id}: cold`);
  const ashore = [];
  for (const c of data.currents) for (const [lon, lat] of currentPoints(c.pts)) if (onLand(lon, lat)) ashore.push(`${c.id} ${lon.toFixed(2)},${lat.toFixed(2)}`);
  assert.deepEqual(ashore, [], 'no current crosses the land');
});

test('each runs the way the water flows', () => {
  const by = id => data.currents.find(c => c.id === id).pts;
  const first = id => by(id)[0], last = id => by(id).at(-1);
  assert.ok(last('kuroshio')[1] > first('kuroshio')[1], 'the Kuroshio goes north');
  assert.ok(last('oyashio')[1] < first('oyashio')[1], 'the Oyashio goes south');
  assert.ok(last('gulf-stream')[0] > first('gulf-stream')[0], 'the Gulf Stream goes east');
  assert.ok(last('humboldt')[1] > first('humboldt')[1], 'the Humboldt goes north');
  assert.ok(last('nec-pacific')[0] < first('nec-pacific')[0], 'the equatorial currents go west');
  assert.equal(last('antarctic-circumpolar')[0] - first('antarctic-circumpolar')[0], 360, 'round Antarctica eastwards');
});

test('the Kuroshio passes Taiwan on its east, close by, from the Luzon Strait to the north-east', () => {
  const pts = currentPoints(data.currents.find(c => c.id === 'kuroshio').pts);
  const past = pts.filter(([, lat]) => lat >= 21.9 && lat <= 25.0);
  assert.ok(past.length >= 4, 'drawn in detail along Taiwan');
  // Taiwan's east coast runs from about 121.0° E (22.5° N) to 122.0° E (25° N): the current a few tens of km off it.
  for (const [lon, lat] of past) assert.ok(lon > 121.6 && lon < 123.0, `${lon.toFixed(2)}, ${lat.toFixed(2)}: off the east coast`);
  assert.ok(pts.some(([lon, lat]) => lat > 20 && lat < 21.5 && lon > 121.5 && lon < 122.5), 'through the Luzon Strait');
});

test('their names, and the key\'s words, in both languages and listed for checking', () => {
  const review = readFileSync(`${ROOT}data/zh-ui-review.md`, 'utf8');
  for (const k of [...new Set(data.currents.map(c => `current.${c.name}`)), 'info.depth.key.warm', 'info.depth.key.cold']) {
    assert.ok(en[k] && zh[k], k);
    assert.ok(review.includes(`\`${k}\``), `${k} in data/zh-ui-review.md`);
  }
  assert.equal(zh['current.kuroshio'], '黑潮');
});
