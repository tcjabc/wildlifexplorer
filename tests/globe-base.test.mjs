// The ?globe=webgl spike (js/globe-base.js): its numbers. In Chromium: tests/globe-base-browser.test.mjs.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rampBytes, rampValue, textureBytes, BASE_DPR } from '../js/globe-base.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const STOPS = [{ v: -30, colour: '#000000' }, { v: 10, colour: '#ff0000' }, { v: 50, colour: '#ffffff' }];

test('the colour scale as pixels: its ends, and a point between two stops', () => {
  const px = rampBytes(STOPS, 5);
  assert.deepEqual([...px.slice(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...px.slice(8, 12)], [255, 0, 0, 255]);
  assert.deepEqual([...px.slice(16, 20)], [255, 255, 255, 255]);
  assert.deepEqual([...px.slice(4, 8)], [128, 0, 0, 255]);
});

test('a byte of a number texture: 0 is no data, 1 and 255 the ends of the scale', () => {
  assert.equal(rampValue(0, STOPS), null);
  assert.equal(rampValue(1, STOPS), -30);
  assert.equal(rampValue(255, STOPS), 50);
  assert.equal(rampValue(128, STOPS), 10);
});

test('GPU memory, and the pixel ratio cap', () => {
  assert.equal(textureBytes(2048, 1024), 8 * 1024 * 1024);
  assert.equal(BASE_DPR, 1.5);
});

test('the renderer works offline and its textures are the globe\'s files', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'js\/globe-base\.js'/);
  assert.match(sw, /GLOBE_FILE = .*assets\\\/\(layers\\\//);
  for (const f of ['shade-2k', 'temp-mean-2k', 'relief-2k']) assert.ok(existsSync(`${ROOT}assets/layers/${f}.webp`), f);
});
