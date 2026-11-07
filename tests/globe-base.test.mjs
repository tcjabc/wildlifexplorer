// The base renderer (js/globe-base.js): its numbers. In Chromium: tests/globe-base-browser.test.mjs.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { coastEdge, tileHill, tileSoft, rampBytes, monthRange, textureBytes } from '../js/globe-base.js';
import { RELIEF_TILES } from '../js/globe-tiles.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const STOPS = [{ v: -30, colour: '#000000' }, { v: 10, colour: '#ff0000' }, { v: 50, colour: '#ffffff' }];

test('the colour scale as pixels: its ends, and a point between two stops', () => {
  const px = rampBytes(STOPS, 5);
  assert.deepEqual([...px.slice(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...px.slice(8, 12)], [255, 0, 0, 255]);
  assert.deepEqual([...px.slice(16, 20)], [255, 255, 255, 255]);
  assert.deepEqual([...px.slice(4, 8)], [128, 0, 0, 255]);
});

test('a month\'s byte to the scale: the shader\'s sum lands on the right place', () => {
  const [x, y] = monthRange(STOPS), at = byte => (byte / 255) * x + y;
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);
  near(at(1 + (20 / 100) * 254), 0);   // -30 °C: the bottom of the scale
  near(at(1 + (100 / 100) * 254), 1);  // +50 °C: the top
  near(at(1 + (60 / 100) * 254), 0.5); // +10 °C: the middle
});

test('GPU memory', () => {
  assert.equal(textureBytes(2048, 1024), 8 * 1024 * 1024);
});

test('the renderer works offline and its textures are the globe\'s files', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'js\/globe-base\.js'/);
  assert.match(sw, /GLOBE_FILE = .*assets\\\/\(layers\\\//);
  for (const f of ['shade-2k', 'forests-2k', 'depth-2k', 'relief-2k', 'temp-months-1']) assert.ok(existsSync(`${ROOT}assets/layers/${f}.webp`), f);
});

test('the hillshade from the zoom tiles on the plain map: none where they start, all of it soon after', () => {
  assert.equal(tileHill(RELIEF_TILES.fromK - 0.5, RELIEF_TILES.fromK), 0);
  assert.equal(tileHill(RELIEF_TILES.fromK, RELIEF_TILES.fromK), 0);
  assert.ok(tileHill(RELIEF_TILES.fromK + 0.4, RELIEF_TILES.fromK) > 0);
  assert.equal(tileHill(4, RELIEF_TILES.fromK), 1);
});

test('its blur stays the same size on the map at any zoom', () => {
  // A bias counts from the level in use, so twice the radius needs one more.
  const r = 1000, level = RELIEF_TILES.level;
  assert.ok(Math.abs(tileSoft(r * 2, level) - tileSoft(r, level) - 1) < 1e-9);
  assert.equal(tileSoft(1, level), 0, 'never sharper than the picture');
});

test('the land edge of the plain map stays thin however far the mask is stretched', () => {
  assert.equal(coastEdge(300, 2048), 1, 'the whole globe: as it is');
  assert.ok(coastEdge(4000, 2048) > 7, 'zoomed in: much steeper');
  assert.ok(Math.abs(coastEdge(8000, 2048) - 2 * coastEdge(4000, 2048)) < 1e-9);
});
