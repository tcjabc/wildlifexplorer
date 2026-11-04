// Regression test for the card gesture release path (the dismiss freeze in 7510104: the
// release threw, so the card was left half-way). Every gesture type must decide without
// throwing and end settled: a page turn or flip springs to exactly 0 or 1, a dismiss either
// goes back to the binder or springs back to full size, anything unknown springs back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { releaseOutcome, COMMIT, DISMISS_SHARE, DISMISS_FLICK } from '../js/gesture-release.js';

const travel = { x: 300, y: 260 };
const stageH = 650;
const state = (over = {}) => ({ p: 0, f: 0, base: { p: 0, f: 0 }, dir: -1, travel, stageH, ...over });

// Settled: a spring to an end (0 or 1, zoom 1) with a finite speed, a dismiss, a scroll glide
// or a spring back. Never "stay where you are".
function assertSettled(o, label) {
  assert.ok(o && typeof o === 'object', `${label}: no outcome`);
  if (o.dismiss || o.springBack) return;
  if (o.scroll) { assert.ok(Number.isFinite(o.velocity), `${label}: scroll speed`); return; }
  if (!o.prop && 'pan' in o) { assert.ok(Number.isFinite(o.pan) && Number.isFinite(o.velocity), `${label}: pan ${o.pan}`); return; }
  assert.ok(['p', 'f', 'z'].includes(o.prop), `${label}: prop ${o.prop}`);
  assert.ok(o.prop === 'z' ? o.target === 1 : o.target === 0 || o.target === 1, `${label}: target ${o.target}`);
  assert.ok(Number.isFinite(o.velocity), `${label}: velocity ${o.velocity}`);
}

const CASES = {
  // mode: [label, state, info, expected]
  open: [
    ['past a quarter', state({ p: COMMIT + 0.05 }), { vx: -10 }, { prop: 'p', target: 1 }],
    ['released early', state({ p: 0.1 }), { vx: -10 }, { prop: 'p', target: 0 }],
    ['quick flick', state({ p: 0.05 }), { vx: -900 }, { prop: 'p', target: 1 }],
    ['flick back the other way', state({ p: 0.5 }), { vx: 900 }, { prop: 'p', target: 0 }],
  ],
  close: [
    ['past a quarter', state({ p: 0.6, base: { p: 1, f: 0 }, dir: 1 }), { vx: 10 }, { prop: 'p', target: 0 }],
    ['released early', state({ p: 0.9, base: { p: 1, f: 0 }, dir: 1 }), { vx: 10 }, { prop: 'p', target: 1 }],
  ],
  flip: [
    ['past a quarter', state({ f: 0.4 }), { vy: -20 }, { prop: 'f', target: 1 }],
    ['released early', state({ f: 0.1 }), { vy: -20 }, { prop: 'f', target: 0 }],
    ['quick flick up', state({ f: 0.05 }), { vy: -900 }, { prop: 'f', target: 1 }],
  ],
  unflip: [
    ['past a quarter', state({ f: 0.6, base: { p: 0, f: 1 }, dir: 1 }), { vy: 20 }, { prop: 'f', target: 0 }],
    ['released early', state({ f: 0.95, base: { p: 0, f: 1 }, dir: 1 }), { vy: 20 }, { prop: 'f', target: 1 }],
  ],
  dismiss: [
    ['dragged far enough', state(), { dy: stageH * DISMISS_SHARE + 10, vy: 100 }, { dismiss: true }],
    ['hard flick down', state(), { dy: 30, vy: DISMISS_FLICK + 100 }, { dismiss: true }],
    ['slow, released early', state(), { dy: 40, vy: 50 }, { prop: 'z', target: 1 }],
    ['down, then flicked back up', state(), { dy: stageH * 0.3, vy: -(DISMISS_FLICK + 100) }, { prop: 'z', target: 1 }],
  ],
  scroll: [
    ['a flick glides', state(), { vy: -800 }, { scroll: true }],
  ],
  pan: [
    ['panned inside the edges', state({ p: 1, panLeft: -200, range: { min: -600, max: 0 } }), { vx: 0 }, { pan: -200 }],
    ['past the left edge far enough', state({ p: 0.5, panLeft: 8, range: { min: -600, max: 0 } }), { vx: 30 }, { prop: 'p', target: 0 }],
    ['past the left edge a little', state({ p: 0.9, panLeft: 8, range: { min: -600, max: 0 } }), { vx: 0 }, { prop: 'p', target: 1 }],
  ],
};

for (const [mode, cases] of Object.entries(CASES)) {
  test(`release ${mode}: commits or springs back, never stays half-way`, () => {
    for (const [label, s, info, expected] of cases) {
      let o;
      assert.doesNotThrow(() => { o = releaseOutcome(mode, s, info); }, `${mode} ${label}`);
      assertSettled(o, `${mode} ${label}`);
      for (const [k, v] of Object.entries(expected)) assert.equal(o[k], v, `${mode} ${label}: ${k}`);
    }
  });
}

test('release with missing or broken numbers still ends settled', () => {
  const broken = [undefined, {}, { p: NaN, f: NaN, dir: 0, travel: {}, stageH: 0 }, { p: Infinity, travel: { x: 0, y: 0 } }];
  const infos = [undefined, {}, { dy: NaN, vx: NaN, vy: NaN }, { vx: Infinity, vy: -Infinity }];
  for (const mode of [...Object.keys(CASES), 'spring-back', null, undefined]) {
    for (const s of broken) {
      for (const info of infos) {
        let o;
        assert.doesNotThrow(() => { o = releaseOutcome(mode, s, info); }, `${mode}`);
        assertSettled(o, `${mode} with ${JSON.stringify(s)} / ${JSON.stringify(info)}`);
      }
    }
  }
});

test('an unknown gesture springs back', () => {
  for (const mode of [null, undefined, '', 'spring-back', 'pinch']) {
    assert.deepEqual(releaseOutcome(mode, state(), { dy: 100, vx: 500, vy: 500 }), { springBack: true });
  }
});

test('the viewer releases through releaseOutcome and springs back if applying it throws', () => {
  const src = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
  assert.match(src, /releaseOutcome\(mode,/, 'viewer.js decides the release with releaseOutcome');
  assert.match(src, /try \{ release\(m, info\); \} catch \(err\) \{ springBack\(\); throw err; \}/, 'a throw springs back');
  assert.match(src, /cancel: \(\) => \{[^}]*springBack\(\)/, 'cancel springs back');
  // The bug in 7510104: a bare layout variable left over from the old handler, in the
  // gesture code (draw() has its own L from v, which is fine).
  const gestures = src.slice(src.indexOf('function wireGestures'), src.indexOf('// ---------- read aloud'));
  assert.ok(gestures.length > 1000, 'found the gesture code');
  assert.doesNotMatch(gestures, /(?<![\w.])L\.(Hs|P|H|s0|s1)\b/, 'no bare L.* in the gesture code (use v.L)');
});
