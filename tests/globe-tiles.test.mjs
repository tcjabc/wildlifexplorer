// Topography zoom tiles: the files (scripts/make-layers.mjs tiles), the detail window round
// the view (js/globe-tiles.js), which tiles are in sight, and the service worker's own tile
// cache with its size cap (sw.js, run here against a fake Cache API).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import vm from 'node:vm';
import { RELIEF_TILES, DETAIL, detailWindow, tileCap } from '../js/globe-tiles.js';

const url = path => new URL(`../${path}`, import.meta.url);
const src = path => readFileSync(url(path), 'utf8');
const T = RELIEF_TILES;

test('the tiles: 8,192 × 4,096 px in 512 px tiles, 16 × 8 of them, every one there', () => {
  assert.equal(T.cols * T.tile, T.level);
  assert.equal(T.rows * T.tile, T.level / 2);
  assert.deepEqual([T.cols, T.rows], [16, 8]);
  const files = readdirSync(url(T.dir)).filter(f => f.endsWith('.webp')).sort();
  const want = [];
  for (let r = 0; r < T.rows; r++) for (let c = 0; c < T.cols; c++) want.push(`${r}-${c}.webp`);
  assert.deepEqual(files, want.sort());
  const total = files.reduce((s, f) => s + statSync(url(`${T.dir}${f}`)).size, 0);
  assert.ok(total < 25 * 1024 * 1024, `all the tiles fit the cache cap (${(total / 1048576).toFixed(1)} MB)`);
  for (const f of files) assert.ok(statSync(url(`${T.dir}${f}`)).size < 120 * 1024, `${f} is small`);
  const make = src('scripts/make-layers.mjs');
  assert.match(make, /const TILE_LEVEL = 8192, TILE = 512;/, 'the build script makes the same grid');
});

test('the window: the DETAIL × DETAIL tiles round the view, wrapping at 180°, staying on the map', () => {
  // Taiwan (121° E, 23.7° N): columns 11–14, rows 1–4.
  assert.deepEqual(detailWindow(121, 23.7), [11, 1, DETAIL, DETAIL]);
  // Just west of the antimeridian: columns 14, 15, 0, 1.
  assert.deepEqual(detailWindow(179.5, -17), [14, 3, DETAIL, DETAIL]);
  assert.deepEqual(detailWindow(-179.5, -17), [14, 3, DETAIL, DETAIL]);
  // Near the poles the rows stop at the map's edge.
  assert.equal(detailWindow(0, 89)[1], 0);
  assert.equal(detailWindow(0, -89)[1], T.rows - DETAIL);
});

test('a tile\'s cap: its middle, and a reach that covers its corners', () => {
  const { c, r } = tileCap(13, 2); // 112.5–135° E, 22.5–45° N: has Taiwan's north tip
  const lon = (Math.atan2(c[1], c[0]) * 180) / Math.PI, lat = (Math.asin(c[2]) * 180) / Math.PI;
  assert.ok(Math.abs(lon - 123.75) < 1e-9 && Math.abs(lat - 33.75) < 1e-9);
  assert.ok(r > (11.25 * Math.PI) / 180 && r < (20 * Math.PI) / 180, `reach ${(r * 180) / Math.PI}°`);
});

test('the globe uses the tiles only for relief, from zoom 2.4, and the picture shader falls back to the base', () => {
  assert.equal(T.fromK, 2.4);
  assert.match(src('js/layers.js'), /mode: 'relief'[^\n]*tiles: RELIEF_TILES/);
  const gl = src('js/globegl.js');
  assert.match(gl, /base = mix\(base, d\.rgb \/ max\(d\.a, 1e-4\), d\.a\);/, 'clear where no tile is: the base shows');
  assert.match(gl, /if \(next\?\.mode !== 'relief'\) dropDetail\(\);/, 'the atlas goes with the layer');
});

// ---------- the service worker's tile cache ----------

function fakeWorker() {
  const stores = new Map();
  const store = name => {
    if (!stores.has(name)) {
      const m = new Map();
      stores.set(name, {
        m,
        async match(req) { return m.get(typeof req === 'string' ? req : req.url)?.clone(); },
        async put(req, res) { const k = typeof req === 'string' ? req : req.url; m.delete(k); m.set(k, res); },
        async keys() { return [...m.keys()].map(u => new Request(u)); },
        async delete(req) { return m.delete(typeof req === 'string' ? req : req.url); },
        async addAll() {},
      });
    }
    return stores.get(name);
  };
  const caches = { open: async name => store(name), keys: async () => [...stores.keys()], delete: async n => stores.delete(n), match: async () => undefined };
  const handlers = {};
  const MB = 1024 * 1024;
  const self = { addEventListener: (t, f) => { handlers[t] = f; }, location: { origin: 'https://wildfile.app' }, registration: { scope: 'https://wildfile.app/' } };
  // A tile's size is in its header (as Cloudflare sends it); the body itself can stay tiny.
  const fetch = async () => new Response('x', { headers: { 'content-length': String(MB) } });
  const setTimeout = fn => { Promise.resolve().then(fn); return 0; };
  vm.runInNewContext(src('sw.js'), { self, caches, fetch, setTimeout, Response, Request, URL, Promise, Number, Set, Map, console });
  const get = async path => {
    let p;
    handlers.fetch({ request: new Request(`https://wildfile.app/${path}`), respondWith: x => { p = x; } });
    await p;
    for (let i = 0; i < 6; i++) await new Promise(r => globalThis.setImmediate(r)); // let the trim run
  };
  return { stores, get };
}

test('the service worker keeps tiles in their own cache, the oldest let go above about 25 MB', async () => {
  const sw = fakeWorker();
  const tiles = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 8; c++) tiles.push(`assets/layers/relief-tiles/${r}-${c}.webp`);
  for (const t of tiles) await sw.get(t); // 32 tiles of 1 MB
  await sw.get('assets/layers/depth.topo.json');
  const version = src('sw.js').match(/const LAYERS_VERSION = '(l\d+)'/)[1];
  const tileStore = sw.stores.get(`tiles-${version}`).m, layerStore = sw.stores.get(`layers-${version}`).m;
  assert.ok(tileStore.size <= 25 && tileStore.size >= 20, `${tileStore.size} tiles kept (1 MB each)`);
  assert.ok(!tileStore.has(`https://wildfile.app/${tiles[0]}`), 'the first one fetched is gone');
  assert.ok(tileStore.has(`https://wildfile.app/${tiles.at(-1)}`), 'the newest is kept');
  assert.deepEqual([...layerStore.keys()], ['https://wildfile.app/assets/layers/depth.topo.json'], 'other layer files go in the layer cache');
});

test('the tile cache survives a release and goes with LAYERS_VERSION', () => {
  const sw = src('sw.js');
  assert.match(sw, /const TILE_CACHE = `tiles-\$\{LAYERS_VERSION\}`;/);
  assert.match(sw, /const keep = new Set\(\[SHELL_CACHE, IMAGE_CACHE, LAYER_CACHE, TILE_CACHE\]\);/);
  assert.match(sw, /const TILE_CAP = 25 \* 1024 \* 1024;/);
});
