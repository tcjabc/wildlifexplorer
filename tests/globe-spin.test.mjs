// The globe turns by itself only when fully zoomed out and untouched for 20 seconds.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spinEase } from '../js/globe.js';

test('still until 20 seconds have gone by without a touch', () => {
  assert.equal(spinEase(0, 1), 0);
  assert.equal(spinEase(3500, 1), 0);
  assert.equal(spinEase(19999, 1), 0);
  assert.equal(spinEase(20000, 1), 0);
});

test('then it eases into the turn', () => {
  assert.ok(spinEase(20750, 1) > 0.4 && spinEase(20750, 1) < 0.6);
  assert.equal(spinEase(21500, 1), 1);
  assert.equal(spinEase(600000, 1), 1);
});

test('never while zoomed in, however long it is left', () => {
  for (const k of [1.01, 1.5, 2.2, 40]) assert.equal(spinEase(600000, k), 0, `k ${k}`);
});
