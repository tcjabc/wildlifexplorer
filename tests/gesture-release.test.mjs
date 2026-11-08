// Regression test for the card gesture release path (the dismiss freeze in 7510104: the
// release threw, so the card was left half-way). Every gesture type must decide without
// throwing and end settled: a turn-over springs to a whole half turn (where it started, or one
// further either way), a swipe sideways changes card or springs back, anything unknown springs back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { releaseOutcome, COMMIT } from '../js/gesture-release.js';

const travel = { x: 300, y: 260 };
const state = (over = {}) => ({ f: 0, base: 0, dx: 0, travel, ...over });

// Settled: a spring to a whole turn with a finite speed, a card change, a scroll glide or a
// spring back. Never "stay where you are".
function assertSettled(o, label) {
  assert.ok(o && typeof o === 'object', `${label}: no outcome`);
  if (o.springBack) return;
  if (o.swap) { assert.ok(o.swap === 1 || o.swap === -1, `${label}: swap ${o.swap}`); return; }
  if (o.scroll) { assert.ok(Number.isFinite(o.velocity), `${label}: scroll speed`); return; }
  assert.equal(o.prop, 'f', `${label}: prop ${o.prop}`);
  assert.ok(Number.isInteger(o.target), `${label}: target ${o.target}`);
  assert.ok(Number.isFinite(o.velocity), `${label}: velocity ${o.velocity}`);
}

const CASES = {
  // mode: [label, state, info, expected]
  turn: [
    ['up past a quarter', state({ f: COMMIT + 0.1 }), { vy: -20 }, { target: 1 }],
    ['up, released early', state({ f: 0.1 }), { vy: -20 }, { target: 0 }],
    ['a quick flick up', state({ f: 0.05 }), { vy: -900 }, { target: 1 }],
    ['up, then flicked back down', state({ f: 0.5 }), { vy: 900 }, { target: 0 }],
    ['down from the front: over the other way', state({ f: -0.4 }), { vy: 20 }, { target: -1 }],
    ['down from the back', state({ f: 0.6, base: 1 }), { vy: 20 }, { target: 0 }],
    ['down from the back, released early', state({ f: 0.95, base: 1 }), { vy: 20 }, { target: 1 }],
    ['up from the back: on round', state({ f: 1.4, base: 1 }), { vy: -20 }, { target: 2 }],
  ],
  swap: [
    ['left past a quarter: the next card', state({ dx: -100 }), { vx: -10 }, { swap: 1 }],
    ['right past a quarter: the card before', state({ dx: 100 }), { vx: 10 }, { swap: -1 }],
    ['released early', state({ dx: -40 }), { vx: -10 }, { springBack: true }],
    ['a quick flick left', state({ dx: -20 }), { vx: -900 }, { swap: 1 }],
    ['left, then flicked back', state({ dx: -120 }), { vx: 900 }, { springBack: true }],
  ],
  scroll: [
    ['a flick glides', state(), { vy: -800 }, { scroll: true }],
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
  const broken = [undefined, {}, { f: NaN, base: NaN, dx: NaN, travel: {} }, { f: Infinity, travel: { x: 0, y: 0 } }];
  const infos = [undefined, {}, { vx: NaN, vy: NaN }, { vx: Infinity, vy: -Infinity }];
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

test('an unknown gesture springs back (the old open, close and dismiss are gone)', () => {
  for (const mode of [null, undefined, '', 'spring-back', 'pinch', 'open', 'close', 'dismiss', 'flip']) {
    assert.deepEqual(releaseOutcome(mode, state(), { vx: 500, vy: 500 }), { springBack: true });
  }
});

test('the viewer releases through releaseOutcome and springs back if applying it throws', () => {
  const src = readFileSync(new URL('../js/viewer.js', import.meta.url), 'utf8');
  assert.match(src, /releaseOutcome\(mode,/, 'viewer.js decides the release with releaseOutcome');
  assert.match(src, /try \{ release\(m, info\); \} catch \(err\) \{ springBack\(\); throw err; \}/, 'a throw springs back');
  assert.match(src, /cancel: \(\) => \{[^}]*springBack\(\)/, 'cancel springs back');
  // The bug in 7510104: a bare layout variable left over from the old handler, in the
  // gesture code (draw() has its own L from v, which is fine).
  const gestures = src.slice(src.indexOf('function wireGestures'), src.indexOf('// ---------- the bar'));
  assert.ok(gestures.length > 1000, 'found the gesture code');
  assert.doesNotMatch(gestures, /(?<![\w.])L\.(Hs|P|H|s|box)\b/, 'no bare L.* in the gesture code (use v.L)');
});

test('a turn-over springs the way the finger went', () => {
  // Up is negative vy: f grows, so the spring starts with a positive speed.
  assert.ok(releaseOutcome('turn', state({ f: 0.5 }), { vy: -260 }).velocity > 0);
  assert.ok(releaseOutcome('turn', state({ f: 0.5, base: 1 }), { vy: 260 }).velocity < 0);
});
