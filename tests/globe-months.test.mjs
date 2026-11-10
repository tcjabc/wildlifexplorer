// Temperature's months (js/globe-months.js), plain in and out, and the three files they are packed in.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { slotOf, wrapPos, nearestMonth, sliderPos, blendAt, heldBlend, fetchOrder, toByte, fromByte, bandSteps, MONTH_FILES } from '../js/globe-months.js';

const sharp = createRequire(import.meta.url)('sharp');

test('twelve months, four to a texture, one to a channel', () => {
  assert.deepEqual(slotOf(1), { tex: 0, ch: 0 });
  assert.deepEqual(slotOf(4), { tex: 0, ch: 3 });
  assert.deepEqual(slotOf(5), { tex: 1, ch: 0 });
  assert.deepEqual(slotOf(12), { tex: 2, ch: 3 });
});

test('a place in the year: between two months, and round from December to January', () => {
  assert.deepEqual(blendAt(3.25), { a: 3, b: 4, mix: 0.25 });
  assert.deepEqual(blendAt(12.5), { a: 12, b: 1, mix: 0.5 });
  assert.deepEqual(blendAt(13), { a: 1, b: 2, mix: 0 });
  assert.equal(wrapPos(13.5), 1.5);
  assert.equal(nearestMonth(3.4), 3);
  assert.equal(nearestMonth(3.6), 4);
  assert.equal(nearestMonth(12.6), 1);
});

test('the slider goes with its label: back at the start as soon as December turns to January', () => {
  assert.equal(sliderPos(3.25), 3.25);
  assert.equal(sliderPos(12.2), 12.2, 'still December: at the end');
  for (const pos of [12.5, 12.7, 12.99]) {
    assert.equal(nearestMonth(pos), 1);
    assert.equal(sliderPos(pos), 1, `${pos}: January, at the start`);
  }
  assert.ok(Math.abs(sliderPos(13.2) - 1.2) < 1e-9, 'and on into the new year');
  for (let pos = 1; pos < 13; pos += 0.05) assert.equal(Math.round(sliderPos(pos)), nearestMonth(pos), `${pos.toFixed(2)}`);
});

test('with a texture missing, the blend holds on what is here, and never shows nothing once there is something', () => {
  const only = (...ms) => m => ms.includes(m);
  assert.deepEqual(heldBlend({ a: 4, b: 5, mix: 0.3 }, only(4, 5)), { a: 4, b: 5, mix: 0.3 });
  assert.deepEqual(heldBlend({ a: 4, b: 5, mix: 0.3 }, only(4)), { a: 4, b: 4, mix: 0 });
  assert.deepEqual(heldBlend({ a: 4, b: 5, mix: 0.7 }, only(5)), { a: 5, b: 5, mix: 0 });
  assert.deepEqual(heldBlend({ a: 9, b: 10, mix: 0 }, only(2), 2), { a: 2, b: 2, mix: 0 }, 'the month last shown stays');
  assert.equal(heldBlend({ a: 9, b: 10, mix: 0 }, only()), null);
});

test('the texture with the month wanted comes first', () => {
  assert.deepEqual(fetchOrder(11), [2, 0, 1]);
  assert.deepEqual(fetchOrder(1), [0, 1, 2]);
});

test('bytes: never 0, so a channel is never see-through; -50 to +50 °C, to better than half a degree', () => {
  assert.equal(toByte(-50), 1);
  assert.equal(toByte(50), 255);
  assert.equal(toByte(-999), 1);
  for (const c of [-30, -1.3, 0, 12.7, 45]) assert.ok(Math.abs(fromByte(toByte(c)) - c) < 0.25, String(c));
});

test('the key\'s bands fill the scale, each coloured from its middle', () => {
  const bands = bandSteps(10);
  assert.equal(bands.length, 10);
  assert.equal(bands[0].from, 0);
  assert.equal(bands[9].to, 1);
  assert.equal(bands[0].at, 0.05);
});

const month = async (m, lon, lat) => {
  const { tex, ch } = slotOf(m);
  const file = fileURLToPath(new URL(`../${MONTH_FILES[tex]}`, import.meta.url));
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const x = Math.floor(((lon + 180) / 360) * info.width), y = Math.floor(((90 - lat) / 180) * info.height);
  return fromByte(data[(y * info.width + x) * 4 + ch]);
};

test('the files: 720 × 360 RGBA, every byte set, and the seasons where they should be', async () => {
  for (const f of MONTH_FILES) {
    const { data, info } = await sharp(fileURLToPath(new URL(`../${f}`, import.meta.url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height, info.channels], [720, 360, 4]);
    assert.ok(data.every(b => b > 0), `${f}: no empty bytes`);
  }
  assert.ok(await month(7, 100, 60) > await month(1, 100, 60) + 20, 'Siberia: summer far above winter');
  assert.ok(await month(1, 135, -25) > await month(7, 135, -25), 'Australia: the other way round');
  assert.ok(Math.abs(await month(1, -150, 0) - await month(7, -150, 0)) < 5, 'the middle of the Pacific hardly changes');
});
