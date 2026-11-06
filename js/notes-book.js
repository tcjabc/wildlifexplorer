// The book the page lies in: the cover, the spiral along the top and the stacks of page edges, all
// outside the page, and the leaves that flip over the spiral. Colours in css/notes.css; nothing here
// but transforms and opacity moves, and only for a moment (js/notebook.js says when; with reduced
// motion it doesn't ask).
import { h } from './dom.js';
import { spiralArt } from './notes-rails.js';

const FLIP_MS = 300;
const RIFFLE_LEAVES = 6;
const RIFFLE_GAP_MS = 36;
const RIFFLE_MS = 230;     // 6 leaves: 410 ms in all
const OVER = 'rotateX(172deg)'; // a leaf gone over the spiral: past its top, so it never stands on edge
const SHOW_BEFORE = 0.66;  // the stack above starts behind the coils: this much of it to clear them

// frame: the desk's outer box; `desk` goes inside it, between the book and the leaves.
export function bookFrame(desk) {
  const turn = h('div', { class: 'nb-bk__turn', 'aria-hidden': 'true' });
  const part = name => h('div', { class: `nb-bk__${name}`, 'aria-hidden': 'true' });
  const el = h('div', { class: 'nb-bk' }, part('cover'), part('after'), part('before'), part('stub'), desk, turn, spiralArt());
  return {
    el, turn,
    // How much of the stack lies each way, out of 1 (js/notes-view.js stackDepth).
    depth({ before, after }) {
      el.style.setProperty('--nb-after', String(after));
      el.style.setProperty('--nb-before', String(before ? SHOW_BEFORE + (1 - SHOW_BEFORE) * before : 0));
    },
  };
}

// A canvas's picture at the size it shows: a leaf is in the air too briefly to need more.
export function snapshot(canvas, w, hgt) {
  const c = h('canvas', { class: 'nb-leaf__face', width: w, height: hgt });
  c.getContext('2d').drawImage(canvas, 0, 0, w, hgt);
  return c;
}
const leaf = front => h('div', { class: 'nb-leaf' }, front ?? h('div', { class: 'nb-leaf__face nb-leaf__face--paper' }), h('div', { class: 'nb-leaf__back' }));

let flying = null; // what is in the air: a turn cut short by the next one ends at once
const land = () => { flying?.forEach(a => a.finish()); flying = null; };

// One page turning. dir 1: the old page goes up and over the spiral off the new one. dir -1: the new
// page comes back down over the old one.
//   was, now: canvases from snapshot().
export function flip(layer, { dir, was, now }) {
  land();
  const parts = dir > 0 ? [leaf(was)] : [leaf(was), leaf(now)];
  layer.append(...parts);
  const moving = parts[parts.length - 1];
  const steps = [{ transform: 'none' }, { transform: OVER, opacity: 1, offset: 0.86 }, { transform: OVER, opacity: 0 }];
  const a = moving.animate(dir > 0 ? steps : [...steps].reverse().map((s, i) => ({ ...s, offset: i === 1 ? 0.14 : undefined })), { duration: FLIP_MS, easing: 'ease-in-out', fill: 'both' });
  flying = [a];
  return a.finished.catch(() => {}).then(() => { parts.forEach(p => p.remove()); if (flying?.[0] === a) flying = null; });
}

// A quick run of plain leaves, one after another. dir -1: falling back towards the front. dir 1:
// lifting off, from the front down to the page under them.
export function riffle(layer, { dir, count = RIFFLE_LEAVES }) {
  land();
  const leaves = Array.from({ length: Math.min(count, RIFFLE_LEAVES) }, () => leaf());
  layer.append(...(dir > 0 ? [...leaves].reverse() : leaves));
  const up = [{ transform: 'none' }, { transform: OVER, opacity: 1, offset: 0.9 }, { transform: OVER, opacity: 0 }];
  const down = [{ transform: OVER, opacity: 0 }, { transform: OVER, opacity: 1, offset: 0.1 }, { transform: 'none' }];
  const all = leaves.map((l, i) => l.animate(dir > 0 ? up : down, { delay: i * RIFFLE_GAP_MS, duration: RIFFLE_MS, easing: 'ease-in-out', fill: 'both' }));
  flying = all;
  return Promise.all(all.map(a => a.finished.catch(() => {}))).then(() => { leaves.forEach(l => l.remove()); if (flying === all) flying = null; });
}
