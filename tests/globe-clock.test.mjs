// The Globe's layer clock (js/globe-clock.js clockLoop), on a pretend clock of frames: how far it
// plays, at most 30 times a second, in steps where redraws cost too much, and held while the globe
// moves.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockLoop } from '../js/globe-clock.js';

// Frames every `every` ms, run by hand.
function frames() {
  let next = null, t = 0;
  return {
    raf: fn => { next = fn; return 1; },
    caf: () => { next = null; },
    run(n, every = 1000 / 60) { for (let i = 0; i < n && next; i++) { t += every; const f = next; next = null; f(t); } },
  };
}

test('every frame, the time since the last', () => {
  const f = frames(), got = [];
  const loop = clockLoop({ advance: ms => got.push(ms), raf: f.raf, caf: f.caf });
  loop.start();
  f.run(61);
  assert.equal(got.length, 60, 'the first frame only starts it');
  assert.ok(Math.abs(got.reduce((s, x) => s + x, 0) - 1000) < 1e-6, 'a second of playing in a second');
});

test('at most 30 a second on a 60 Hz screen, and none of the time lost', () => {
  const f = frames(), got = [];
  const loop = clockLoop({ advance: ms => got.push(ms), fps: 30, raf: f.raf, caf: f.caf });
  loop.start();
  f.run(61);
  assert.equal(got.length, 30);
  assert.ok(Math.abs(got.reduce((s, x) => s + x, 0) - 1000) < 1e-6);
  // A 120 Hz screen: still 30.
  const g = frames(), more = [];
  clockLoop({ advance: ms => more.push(ms), fps: 30, raf: g.raf, caf: g.caf }).start();
  g.run(121, 1000 / 120);
  assert.ok(more.length >= 29 && more.length <= 31, `${more.length}`);
});

test('in steps: one advance of stepMs each stepMs, never two at once', () => {
  const f = frames(), got = [];
  clockLoop({ advance: ms => got.push(ms), stepMs: 1000 * 20 / 24, raf: f.raf, caf: f.caf }).start();
  f.run(602); // ten seconds
  assert.equal(got.length, 12, `${got.length} steps`);
  assert.ok(got.every(ms => Math.abs(ms - 1000 * 20 / 24) < 1e-9));
  // A long frame (the tab was hidden) is one step, not a burst.
  const g = frames(), few = [];
  clockLoop({ advance: ms => few.push(ms), stepMs: 800, raf: g.raf, caf: g.caf }).start();
  g.run(1, 0); g.run(1, 5000); g.run(1, 16);
  assert.ok(few.length <= 1);
});

test('held: nothing moves, and the time held is not made up afterwards', () => {
  const f = frames(), got = [];
  let hold = false, ticks = 0;
  clockLoop({ advance: ms => got.push(ms), held: () => hold, tick: () => ticks++, raf: f.raf, caf: f.caf }).start();
  f.run(31);
  const before = got.reduce((s, x) => s + x, 0);
  hold = true;
  f.run(60);
  assert.equal(got.reduce((s, x) => s + x, 0), before, 'nothing while held');
  hold = false;
  f.run(1);
  assert.ok(got.at(-1) < 20, `one frame's worth after: ${got.at(-1)}`);
  assert.equal(ticks, 92, 'tick runs on every frame, held or not');
});

test('stop: no more frames; start again from now', () => {
  const f = frames(), got = [];
  const loop = clockLoop({ advance: ms => got.push(ms), raf: f.raf, caf: f.caf });
  loop.start();
  f.run(10);
  loop.stop();
  assert.equal(loop.on, false);
  f.run(10);
  assert.equal(got.length, 9);
  loop.start();
  f.run(2);
  assert.equal(got.length, 10);
  assert.ok(got.at(-1) < 20, 'the stop is not counted as playing');
});
