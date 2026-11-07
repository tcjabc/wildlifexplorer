// The home outlines (assets/layers/home.topo.json, scripts/make-layers.mjs home) against the country
// codes the profile forms offer (js/countries.js): which have an outline, which can't, what the file
// weighs, and that fetching it says nothing about where an explorer is from.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { CODES } from '../js/countries.js';
import { DEFAULT_HOME, HOME_OUTLINES, loadHome } from '../js/globe.js';
import { decodeTopo } from '../js/topo.js';

const src = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const FILE = new URL(`../${HOME_OUTLINES}`, import.meta.url);
const topo = JSON.parse(src(HOME_OUTLINES));
const shapes = decodeTopo(topo);
const codes = shapes.map(s => s.props.code);

// Offered in the forms with no shape of their own in Natural Earth 1:50m: tiny islands, territories
// drawn as part of their country, and places too small for the scale. They draw no outline.
const NO_OUTLINE = 'BQ BV CC CX GF GI GP MQ RE SJ TK UM YT'.split(' ');

test('every code offered has an outline, or is on the list of those that can\'t', () => {
  const missing = CODES.filter(c => !codes.includes(c));
  assert.deepEqual(missing, NO_OUTLINE);
});

test('every outline is for a code the forms offer, one shape a country', () => {
  assert.deepEqual(codes.filter(c => !CODES.includes(c)), []);
  assert.equal(new Set(codes).size, codes.length);
});

test('Taiwan, the fallback, is there', () => {
  assert.ok(codes.includes(DEFAULT_HOME));
});

test('each is a list of polygons in degrees, to a hundredth of a degree', () => {
  assert.ok(topo.transform.scale[0] <= 0.0101, 'as fine as assets/globe.json');
  for (const { props, polys } of shapes) {
    assert.ok(polys.length > 0, props.code);
    for (const rings of polys) for (const r of rings) {
      assert.ok(r.length >= 3, props.code);
      for (const [lon, lat] of r) assert.ok(Math.abs(lon) <= 180.01 && Math.abs(lat) <= 90.01, props.code);
    }
  }
});

test('Taiwan\'s outline is at least as detailed as the coastline under it', () => {
  const inTaiwan = flat => flat.every((v, i) => (i % 2 ? v > 2100 && v < 2600 : v > 11900 && v < 12300));
  const coast = JSON.parse(src('assets/globe.json')).near.flat().filter(inTaiwan).map(r => r.length / 2);
  const outline = shapes.find(s => s.props.code === 'TW').polys.flat().map(r => r.length);
  assert.ok(Math.max(...outline) >= Math.max(...coast), `${Math.max(...outline)} points against ${Math.max(...coast)}`);
});

test('one file, smaller than the separate files were (442 KB)', () => {
  assert.ok(statSync(FILE).size < 350 * 1024, `${statSync(FILE).size} bytes`);
  assert.ok(!existsSync(new URL('../assets/home/', import.meta.url)));
});

test('picking one country gives the same shape, without working out the rest', () => {
  const [jp, ...others] = decodeTopo(topo, p => p.code === 'JP');
  assert.deepEqual(others, []);
  assert.deepEqual(jp, shapes.find(s => s.props.code === 'JP'));
  assert.deepEqual(decodeTopo(topo, p => p.code === 'BV'), []);
});

test('no request says which country: every explorer fetches the same file', async () => {
  const real = globalThis.fetch, urls = [];
  globalThis.fetch = async url => { urls.push(String(url)); return { ok: true, json: async () => topo }; };
  try {
    const [jp, ru, none] = await Promise.all(['JP', 'RU', 'BV'].map(loadHome));
    assert.ok(jp.length > 0 && ru.length > 0);
    assert.deepEqual(none, [], 'a code with no shape draws nothing');
    assert.deepEqual(urls, [HOME_OUTLINES, HOME_OUTLINES, HOME_OUTLINES]);
    assert.doesNotMatch(HOME_OUTLINES, /[A-Z]/);
  } finally { globalThis.fetch = real; }
});

test('a failed fetch is forgotten, so going online again can retry', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(loadHome('FR'));
    globalThis.fetch = async () => ({ ok: true, json: async () => topo });
    assert.ok((await loadHome('FR')).length > 0);
  } finally { globalThis.fetch = real; }
});

test('fetched in idle time once the globe has drawn, not when it is made', () => {
  assert.doesNotMatch(src('js/globe.js'), /^\s*getHome\(\);$/m);
  assert.match(src('js/views/globe.js'), /globe\.ready\.then\(\(\) => whenIdle\(\(\) => \{\s*if \(!globe\) return;\s*globe\.loadHome\(\);/);
});
