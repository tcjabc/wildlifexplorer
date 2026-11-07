// The coastline on the globe: the land's rings as lines,
// without the stretches along the map's frame where Natural Earth cuts its shapes.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coastRuns, gridFade } from '../js/globe.js';

const src = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const onFrame = ([lon, lat]) => Math.abs(lon) >= 179.9 || Math.abs(lat) >= 89.5;

test('an island away from the frame is one closed line', () => {
  const ring = [[120, 22], [122, 22], [122, 25], [120, 25]];
  const runs = coastRuns(ring);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], [...ring, ring[0]]);
});

test('land cut at the antimeridian: the cut is left out, the coast on either side kept', () => {
  // A piece of Chukotka east of the cut: two points on 180°, the rest coast.
  const ring = [[180, 64], [180, 70], [176, 70], [172, 66], [176, 64]];
  const runs = coastRuns(ring);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], [[180, 70], [176, 70], [172, 66], [176, 64], [180, 64]]);
  for (const run of runs) for (let i = 1; i < run.length; i++) assert.ok(!(onFrame(run[i - 1]) && onFrame(run[i])), 'no segment along the frame');
});

test('Antarctica: the edge along the South Pole and the antimeridian is not coast', () => {
  const ring = [[-180, -90], [-180, -78], [-90, -72], [0, -70], [90, -66], [180, -78], [180, -90], [0, -90]];
  const runs = coastRuns(ring);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs[0], [[-180, -78], [-90, -72], [0, -70], [90, -66], [180, -78]]);
});

test('the real land: every coast segment kept, none along the frame', () => {
  const d = JSON.parse(src('assets/globe.json'));
  for (const level of ['far', 'near']) {
    let segments = 0, kept = 0;
    for (const rings of d[level]) {
      for (const flat of rings) {
        const ring = [];
        for (let i = 0; i < flat.length; i += 2) ring.push([flat[i] * d.unit, flat[i + 1] * d.unit]);
        for (let i = 0; i < ring.length; i++) if (!(onFrame(ring[i]) && onFrame(ring[(i + 1) % ring.length]))) segments++;
        for (const run of coastRuns(ring)) {
          for (let i = 1; i < run.length; i++) {
            assert.ok(!(onFrame(run[i - 1]) && onFrame(run[i])), `${level}: a segment along the frame`);
            kept++;
          }
        }
      }
    }
    assert.equal(kept, segments, `${level}: every coast segment drawn once`);
  }
});

test('in a token colour, the near lines zoomed in', () => {
  const globe = src('js/globe.js');
  assert.match(globe, /if \(polys\?\.coast\) drawCoast\(view\.k >= NEAR_K \? polys\.coast\.near : polys\.coast\.far\);/);
  assert.match(globe, /coast: v\('--c-map-coast'\)/);
  assert.match(src('css/tokens.css'), /--c-map-coast: rgb\([^)]*\/ 0\.\d+\);/);
});

test('a clear line, the same at every zoom: 1.5 px, dark, on a 3 px light halo, on every layer', async () => {
  const { COAST_LINE, COAST_GLOW } = await import('../js/globe.js');
  assert.equal(COAST_LINE, 1.5);
  assert.equal(COAST_GLOW, 3);
  const tokens = src('css/tokens.css');
  const dark = tokens.match(/--c-map-coast: rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/).slice(1).map(Number);
  assert.ok(Math.max(...dark.slice(0, 3)) < 60 && dark[3] >= 0.8, 'near black, nearly opaque: shows on red and on blue');
  const halo = tokens.match(/--c-map-coast-halo: rgb\(255 255 255 \/ ([\d.]+)\)/);
  assert.ok(Number(halo[1]) >= 0.8, 'strong enough to lift an island off a hot sea');
  const globe = src('js/globe.js');
  assert.match(globe, /ctx\.strokeStyle = col\.coastHalo; ctx\.lineWidth = COAST_GLOW;\n\s*ctx\.stroke\(\);\n\s*ctx\.strokeStyle = col\.coast; ctx\.lineWidth = COAST_LINE;/, 'the halo first, then the line');
  assert.match(globe, /\n\s*if \(polys\?\.coast\) drawCoast\(/, 'whatever the layer');
});

test('the plate boundaries: 1.5 px for the whole globe to 2.5 px zoomed in, on a halo', async () => {
  const { coastWidth, COAST_HALO } = await import('../js/globe.js');
  assert.equal(coastWidth(1), 1.5);
  assert.ok(coastWidth(2) > 1.5 && coastWidth(4) < 2.5);
  assert.equal(coastWidth(8), 2.5);
  assert.equal(coastWidth(40), 2.5);
  assert.ok(COAST_HALO > 0);
});

test('home: one magenta line on the coastline\'s halo, nothing filled, the explorer\'s country or else Taiwan', async () => {
  const { HOME_LINE, HOME_GLOW } = await import('../js/globe.js');
  assert.equal(HOME_LINE, 2.5);
  assert.ok(HOME_GLOW > HOME_LINE);
  const tokens = src('css/tokens.css'), globe = src('js/globe.js');
  assert.match(tokens, /--c-map-home: #ff2daa;/);
  assert.match(tokens, /--c-reef: #ff7f50;/);
  assert.match(globe, /ctx\.strokeStyle = col\.coastHalo; ctx\.lineWidth = HOME_GLOW;\n\s*ctx\.stroke\(\);\n\s*ctx\.strokeStyle = col\.home; ctx\.lineWidth = HOME_LINE;/);
  assert.match(globe, /loadHome\(homeCountry \|\| DEFAULT_HOME\)/);
  assert.match(globe, /tracedLines\(home\);/, 'lines: no stroke along the horizon or the map\'s frame');
});

test('the grid: faint, the equator a little stronger, gone from zoom 1.5, set in the tokens', () => {
  const tokens = src('css/tokens.css');
  const token = name => Number(tokens.match(new RegExp(`${name}: ([0-9.]+)`))[1]);
  const lines = token('--map-grid-opacity'), equator = token('--map-equator-opacity'), goneK = token('--map-grid-gone-k');
  assert.ok(lines <= 0.15, 'much fainter than the 0.45 it was');
  assert.ok(equator > lines && equator <= 0.4);
  assert.equal(goneK, 1.5);
  assert.equal(gridFade(1, goneK), 1);
  assert.equal(gridFade(1.25, goneK), 0.5);
  assert.equal(gridFade(goneK, goneK), 0);
  assert.equal(gridFade(8, goneK), 0);
  const globe = src('js/globe.js');
  for (const name of ['--c-map-grid', '--map-grid-opacity', '--map-equator-opacity', '--map-grid-gone-k']) assert.ok(globe.includes(`'${name}'`), name);
});
