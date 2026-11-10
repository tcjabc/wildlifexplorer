// Coral reefs as areas (scripts/make-layers.mjs reefs): two files like the other shape layers,
// the Great Barrier Reef still a long chain, a see-through fill with a darker edge, credited.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { LAYERS, LAYER_CREDITS } from '../js/layers.js';
import { decodeTopo } from '../js/topo.js';

const url = path => new URL(`../${path}`, import.meta.url);
const src = path => readFileSync(url(path), 'utf8');
const topo = name => decodeTopo(JSON.parse(src(`assets/layers/${name}.topo.json`)));

// Every polygon's outer ring, with its bounding box.
const rings = shapes => shapes.flatMap(s => s.polys.map(p => {
  const r = p[0], lons = r.map(q => q[0]), lats = r.map(q => q[1]);
  return { w: Math.min(...lons), e: Math.max(...lons), s: Math.min(...lats), n: Math.max(...lats), r };
}));

test('reefs: a near and a far file, every shape a reef, both small', () => {
  for (const name of ['reefs', 'reefs-far']) {
    const shapes = topo(name);
    assert.ok(shapes.length > 0, name);
    for (const s of shapes) assert.equal(s.props.kind, 'reef');
    assert.ok(statSync(url(`assets/layers/${name}.topo.json`)).size < 100 * 1024, `${name} under 100 KB`);
  }
  assert.ok(!existsSync(url('assets/layers/reefs.json')), 'the dots file is gone');
});

test('the Great Barrier Reef is still recognisable: reefs all along the Queensland coast', () => {
  for (const name of ['reefs', 'reefs-far']) {
    const gbr = rings(topo(name)).filter(b => b.e > 142 && b.w < 154 && b.n > -25 && b.s < -10);
    // Reef areas in every 2° of latitude from Cape York (11° S) to the southern end (24° S).
    for (let lat = -24; lat < -11; lat += 2) {
      assert.ok(gbr.some(b => b.s < lat + 2 && b.n > lat), `${name}: reefs at ${lat}° to ${lat + 2}°`);
    }
    // In the far file they join into a few long pieces rather than hundreds of specks.
    if (name === 'reefs-far') assert.ok(gbr.some(b => b.n - b.s > 4), 'a piece at least 4° long');
  }
});

test('drawn on the sea, under the land: a see-through coral fill and a darker edge (tokens)', () => {
  const layers = src('js/layers.js');
  assert.match(layers, /shapesBy\('reefs', 'kind', \['reef'\], \(\) => col\('--c-reef-fill'\), \{ edge: col\('--c-reef-edge'\) \}\)/);
  // Made once (reefShapes), the same with the base renderer and without it, on top of the warm water.
  assert.equal(layers.match(/sea: await reefShapes\(col\)/g)?.length, 2, 'the reefs on both renderers');
  const tokens = src('css/tokens.css');
  assert.match(tokens, /--c-reef-fill: rgb\(255 127 80 \/ 0\.\d+\)/, 'the reef colour, see-through');
  assert.match(tokens, /--c-reef-edge: #[0-9a-f]{6};/);
  assert.match(src('js/globe.js'), /if \(s\.edge\) \{ ctx\.strokeStyle = s\.edge;/);
  assert.ok(LAYERS.some(L => L.id === 'reefs'));
});

test('credited: Natural Earth, public domain, as areas', () => {
  const c = LAYER_CREDITS.find(x => x.layer === 'reefs');
  assert.match(c.author, /Natural Earth.*Reefs.*areas/);
  assert.equal(c.license, 'Public domain');
  assert.match(src('CREDITS.md'), /🪸 Coral reefs.*Public domain.*areas/);
});
