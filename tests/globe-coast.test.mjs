// The coastline over the picture layers (topography, temperature): the land's rings as lines,
// without the stretches along the map's frame where Natural Earth cuts its shapes.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { coastRuns } from '../js/globe.js';

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

test('drawn over the picture layers only, in a token colour, sharper lines zoomed in', () => {
  const globe = src('js/globe.js');
  assert.match(globe, /if \(layer\?\.raster && polys\?\.coast\) drawCoast\(view\.k >= NEAR_K \? polys\.coast\.near : polys\.coast\.far\);/);
  assert.match(globe, /coast: v\('--c-map-coast'\)/);
  assert.match(src('css/tokens.css'), /--c-map-coast: rgb\([^)]*\/ 0\.\d+\);/);
});
