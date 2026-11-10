// A layer's clock on the Globe (js/views/globe.js): Temperature's year, Day & night's day and
// Topography's sea level. Its controls are one bar along the bottom of the globe, clockBar(): ▶/⏸,
// the clock's label and a slim slider. And the loop that plays it, clockLoop(), plain so it can be
// tested without a page (tests/globe-clock.test.mjs).
import { h } from './dom.js';
import { label } from './i18n.js';

// Playing: advance(ms) moves the clock on by ms of playing time.
//   fps:    at most this many advances a second (0: one every frame)
//   stepMs: instead, one advance of stepMs each stepMs (where a redraw costs too much to play
//           smoothly: the globe without WebGL)
//   held(): nothing advances while it is true (the globe being moved); the time is not made up
//   tick(): every frame while playing
// A slow frame counts in full, so the clock keeps to the time that passed. Only a gap longer than
// MAX_DT (the tab was hidden) counts as MAX_DT, so the clock doesn't jump on coming back.
export const MAX_DT = 250;
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

// Topography's sea level: Today (0 m below today's sea) to the Ice Age, about 20,000 years ago, when
// the sea was about SEA_ICE m lower. Playing, it goes Today → Ice Age → Today in SEA_MS and again; a
// phase runs from 0 (Today) through 0.5 (the Ice Age) to 1 (Today again). It lingers a little at
// each end (a cosine), so both are there to see.
export const SEA_ICE = 120;
export const SEA_MS = 12000;
export const seaDepthAt = phase => (SEA_ICE * (1 - Math.cos(2 * Math.PI * phase))) / 2;
// The phase for a depth, on the half the clock was on (going down before 0.5, coming back after),
// so playing on from a scrub keeps going the same way.
export function seaPhaseOf(depth, was = 0) {
  const p = Math.acos(Math.max(-1, Math.min(1, 1 - (2 * depth) / SEA_ICE))) / (2 * Math.PI);
  const back = ((was % 1) + 1) % 1 > 0.5;
  return back ? 1 - p : p;
}

// The bar's one row: ▶/⏸, the clock's label (the month, the hour), and a slim slider.
//   name:    the label's content (an element), or null to fill in later
//   onName:  { onclick, label (key) }: the label is a button (Day & night: its months and Now), or null
//   label:   false for no label at all (Ocean depth's ▶/⏸ only)
//   slider:  { min, max, step, value, valuetext, label (key), oninput(value), onchange(value), onkeydown(e) },
//            or null for none
//   play:    { playing, onToggle(), labels: [play key, pause key] }, or null (none: reduced motion)
//   ends:    [start mark, end mark] either side of the slider, or null
// Returns { el, name, slider, play, setPlaying(on) }.
export function clockBar({ name = null, onName = null, label: named = true, slider: s = null, play = null, ends = null, cls }) {
  const slider = s && h('input', {
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
  const nameEl = onName
    ? h('button', { class: 'gclock__name gclock__name--btn', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': label(onName.label), onclick: onName.onclick }, name)
    : named ? h('span', { class: 'gclock__name' }, name) : null;
  const el = h('div', { class: ['gclock', cls] }, btn, nameEl, ends && end(ends[0]), slider, ends && end(ends[1]));
  return { el, name: nameEl, slider, play: btn, setPlaying };
}
