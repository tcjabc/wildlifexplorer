// A layer's clock in the Globe's key (js/views/globe.js): Temperature's year and Day & night's day.
// One row of controls, clockRow(): a name, then ▶/⏸ and a slider, with end marks and a Now button
// where a layer has them. And the loop that plays it, clockLoop(), plain so it can be tested without
// a page (tests/globe-clock.test.mjs).
import { h } from './dom.js';
import { label, tx } from './i18n.js';

// Playing: advance(ms) moves the clock on by ms of playing time.
//   fps:    at most this many advances a second (0: one every frame)
//   stepMs: instead, one advance of stepMs each stepMs (where a redraw costs too much to play
//           smoothly: the globe without WebGL)
//   held(): nothing advances while it is true (the globe being moved); the time is not made up
//   tick(): every frame while playing
// A frame later than MAX_DT (a hidden tab, a slow frame) counts as MAX_DT.
const MAX_DT = 100;
export function clockLoop({ advance, fps = 0, stepMs = 0, held = () => false, tick, raf = requestAnimationFrame, caf = cancelAnimationFrame }) {
  let id = 0, last = 0, acc = 0;
  const gap = fps ? 1000 / fps - 2 : 0; // a little early still counts: 60 Hz frames come at 33.3 ms
  function frame(t) {
    id = raf(frame);
    tick?.();
    const dt = Math.min(MAX_DT, t - last);
    if (held()) { last = t; acc = 0; return; }
    if (dt <= 0) return; // the frame that started it
    if (stepMs) {
      last = t;
      acc += dt;
      if (acc >= stepMs) { acc = Math.min(acc - stepMs, stepMs); advance(stepMs); }
      return;
    }
    if (dt < gap) return;
    last = t;
    advance(dt);
  }
  return {
    get on() { return id !== 0; },
    start() {
      if (id) return;
      acc = 0;
      id = raf(t => { last = t; frame(t); });
    },
    stop() { if (id) caf(id); id = 0; },
  };
}

// The row: name (an element) on its own line, then the controls.
//   slider:  { min, max, step, value, valuetext, label (key), oninput(value), onchange(value), onkeydown(e) }
//   play:    { playing, onToggle(), labels: [play key, pause key] }, or null (none: reduced motion)
//   ends:    [start mark, end mark] either side of the slider, or null
//   now:     { onclick, label (key) }: a small button beside the name, or null
// Returns { el, name, slider, play, setPlaying(on) }.
export function clockRow({ name, slider: s, play = null, ends = null, now = null, cls }) {
  const slider = h('input', {
    class: 'gclock__slider', type: 'range', min: s.min, max: s.max, step: s.step, value: s.value,
    'aria-label': label(s.label), 'aria-valuetext': s.valuetext,
    oninput: e => s.oninput?.(Number(e.target.value)),
    onchange: e => s.onchange?.(Number(e.target.value)),
    onkeydown: e => s.onkeydown?.(e),
  });
  const btn = play && h('button', { class: 'gclock__play', type: 'button', onclick: () => play.onToggle() },
    h('span', { class: 'gclock__play-icon', 'aria-hidden': 'true' }));
  const setPlaying = on => {
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(Boolean(on)));
    btn.setAttribute('aria-label', label(play.labels[on ? 1 : 0]));
  };
  setPlaying(play?.playing);
  const end = mark => h('span', { class: 'gclock__end', 'aria-hidden': 'true' }, mark);
  const nameEl = h('span', { class: 'gclock__name' }, name);
  const el = h('div', { class: ['gclock', cls] },
    nameEl,
    now && h('button', { class: 'btn btn--soft gclock__now', type: 'button', onclick: now.onclick }, tx(now.label)),
    h('div', { class: 'gclock__controls' }, btn, ends && end(ends[0]), slider, ends && end(ends[1])));
  return { el, name: nameEl, slider, play: btn, setPlaying };
}
