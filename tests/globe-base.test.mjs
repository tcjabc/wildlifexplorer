// The base renderer (js/globe-base.js): its numbers. In Chromium: tests/globe-base-browser.test.mjs.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rampBytes, monthRange, textureBytes } from '../js/globe-base.js';

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
  for (const f of ['shade-2k', 'temp-mean-2k', 'relief-2k']) assert.ok(existsSync(`${ROOT}assets/layers/${f}.webp`), f);
});
