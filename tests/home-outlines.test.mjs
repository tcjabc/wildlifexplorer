// The home outlines (assets/home/, scripts/make-layers.mjs home) against the country codes the
// profile forms offer (js/countries.js): which have an outline, which can't, and what they weigh.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { CODES } from '../js/countries.js';
import { DEFAULT_HOME } from '../js/globe.js';

const DIR = new URL('../assets/home/', import.meta.url);
const files = readdirSync(DIR).filter(f => f.endsWith('.json'));
const codes = files.map(f => f.slice(0, -5));

// Offered in the forms with no shape of their own in Natural Earth 1:50m: tiny islands, territories
// drawn as part of their country, and places too small for the scale. They draw no outline.
const NO_OUTLINE = 'BQ BV CC CX GF GI GP MQ RE SJ TK UM YT'.split(' ');

test('every code offered has an outline, or is on the list of those that can\'t', () => {
  const missing = CODES.filter(c => !codes.includes(c));
  assert.deepEqual(missing, NO_OUTLINE);
});

test('every outline is for a code the forms offer', () => {
  assert.deepEqual(codes.filter(c => !CODES.includes(c)), []);
});

test('Taiwan, the fallback, is there', () => {
  assert.ok(codes.includes(DEFAULT_HOME));
});

test('each is a list of polygons in hundredths of a degree', () => {
  for (const f of files) {
    const d = JSON.parse(readFileSync(new URL(f, DIR), 'utf8'));
    assert.equal(d.unit, 0.01, f);
    assert.ok(d.polys.length > 0, f);
    for (const rings of d.polys) for (const r of rings) assert.ok(r.length >= 6 && r.length % 2 === 0, f);
  }
});

test('small: most are a few KB, and even the biggest is a small download', () => {
  const sizes = files.map(f => statSync(new URL(f, DIR)).size).sort((a, b) => a - b);
  assert.ok(sizes[sizes.length >> 1] < 8 * 1024, `median ${sizes[sizes.length >> 1]} bytes`);
  assert.ok(sizes.at(-1) < 120 * 1024, `largest ${sizes.at(-1)} bytes`);
});
