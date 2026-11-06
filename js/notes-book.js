// The book the page lies in: the cover, the spiral along the top and the stacks of page edges, all
// outside the page, and what turns on the spiral. Colours in css/notes.css, timing in css/tokens.css;
// nothing here but transforms and opacity moves, and only for a moment. With reduced motion a
// crossfade stands in for any turn.
import { h } from './dom.js';
import { spiralArt } from './notes-rails.js';

const SHOW_BEFORE = 0.66;  // the stack above starts behind the coils: this much of it to clear them

// `desk` goes inside it, between the book and what turns.
export function bookFrame(desk) {
  const turn = h('div', { class: 'nb-bk__turn', 'aria-hidden': 'true' });
  const hinge = h('div', { class: 'nb-bk__hinge' });
  const part = name => h('div', { class: `nb-bk__${name}`, 'aria-hidden': 'true' });
  const el = h('div', { class: 'nb-bk' }, part('cover'), part('after'), part('before'), part('stub'), desk, turn, hinge, spiralArt());
  return {
    el, turn, hinge,
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

// Motion is tuned in css/tokens.css. WAAPI wants a number of milliseconds.
const motion = () => {
  const c = getComputedStyle(document.documentElement), ms = n => parseFloat(c.getPropertyValue(n));
  return { cover: ms('--nb-cover-ms'), page: ms('--nb-flip-ms'), fade: ms('--nb-fade-ms'), ease: c.getPropertyValue('--nb-flip-ease').trim(), turn: `rotateX(${c.getPropertyValue('--nb-flip-angle').trim()})` };
};
// Fading what turns would flatten it and show its front from behind, so what is around it fades.
const leaving = [{ opacity: 1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }];
const arriving = [{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1 }];
const settled = moves => Promise.all(moves.map(a => a.finished.catch(() => {})));

// The cover turning on the spiral, up and over (open) or back down: the reference for all the
// book's motion. It leaves `hidden` set to match. still: reduced motion, a crossfade instead.
export function turnCover(cover, { open, still = false }) {
  const { cover: ms, fade, ease, turn } = motion(), hinge = cover.parentElement;
  cover.hidden = false;
  const seen = still ? (open ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 1 }]) : open ? leaving : arriving;
  const moves = [hinge.animate(seen, { duration: still ? fade : ms, easing: 'linear', fill: 'both' })];
  if (!still) moves.push(cover.animate(open ? [{ transform: 'none' }, { transform: turn }] : [{ transform: turn }, { transform: 'none' }], { duration: ms, easing: ease, fill: 'both' }));
  return settled(moves).then(() => { cover.hidden = open; moves.forEach(a => a.cancel()); });
}

// A leaf: a picture on its front, plain paper on its back, in a wrap of its own that does the fading.
function leaf(front) {
  const turning = h('div', { class: 'nb-leaf' }, front, h('div', { class: 'nb-leaf__back' }));
  return { turning, wrap: h('div', { class: 'nb-leaf-wrap' }, turning) };
}

let flying = null; // what is in the air: a turn cut short by the next one ends at once
const land = () => { flying?.forEach(a => a.finish()); flying = null; };
function fly(parts, moves) {
  flying = moves;
  return settled(moves).then(() => { parts.forEach(p => p.wrap.remove()); if (flying === moves) flying = null; });
}

// One flip, however far the page it lands on. dir 1: the old page goes up and over the spiral off the
// new one. dir -1: the new page comes back down over the old one.
//   was, now: what each shows, from snapshot() or a copy of the page.
export function turnPage(layer, { dir, was, now }) {
  land();
  const { page: ms, ease, turn } = motion();
  const parts = dir > 0 ? [leaf(was)] : [leaf(was), leaf(now)];
  layer.append(...parts.map(p => p.wrap));
  const top = parts[parts.length - 1];
  return fly(parts, [
    top.turning.animate(dir > 0 ? [{ transform: 'none' }, { transform: turn }] : [{ transform: turn }, { transform: 'none' }], { duration: ms, easing: ease, fill: 'both' }),
    top.wrap.animate(dir > 0 ? leaving : arriving, { duration: ms, easing: 'linear', fill: 'both' }),
  ]);
}

// Reduced motion: the old page fades off the new one.
export function fadePage(layer, was) {
  land();
  const part = leaf(was);
  layer.append(part.wrap);
  return fly([part], [part.wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: motion().fade, easing: 'linear', fill: 'both' })]);
}
