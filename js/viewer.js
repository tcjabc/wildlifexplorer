// The card viewer: a full-screen layer over the binder.
// - Opens by zooming from the tapped binder tile (the binder grows and blurs behind it).
// - The card is a bi-fold: cover, inside spread, back. Drag the cover's right edge and it
//   turns around the spine like a book (rotateY).
// - Swipe up to turn the card over, swipe down to go back to the binder.
// Every gesture follows the finger; on release a spring finishes or undoes it.
//
// Field Notes: 📓 opens the notebook beside the card (landscape: side by side with a
// draggable divider; portrait tablet: one above the other; phones: Card / Notes tabs). Either
// pane can fill the screen (double-tap its bar, or pinch out) and come back (pinch in).
//
// Sharpness: the card is laid out at its real on-screen size with CSS zoom (never a small
// card scaled up). While it moves it uses 3D transforms; at rest every transform comes off
// and the cover / open spread / back is drawn flat, so text and photos stay crisp.
import { h, mount, reducedMotion } from './dom.js';
import { tx, t, label, getMode } from './i18n.js';
import { cardsIn, isVisible, groupById, speechRate, watching } from './store.js';
import {
  coverPage, profilePage, insidePage, backPage, cardCredits,
  hasInside, hasBack, factsOf,
} from './cardparts.js';
import { cardNo, groupTitle } from './components.js';
import { track, spring, tween, clamp, lerp, haptic } from './gesture.js';
import { speak, stop, isSpeaking, speechSupported } from './speech.js';
import { notebook } from './notebook.js';
import { notesCount } from './notes-store.js';

const cssNum = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
const DONE = 0.999;

let v = null; // the open viewer, or null

export const isOpen = () => v !== null;
export const openCardId = () => v?.card.id ?? null;

// ---------- building the card ----------

function buildBook(card, onCredit) {
  const leaf = h('div', { class: 'leaf' },
    h('div', { class: 'face face--front' }, coverPage(card, { onCredit }),
      hasInside(card) && h('span', { class: 'grab', 'aria-hidden': 'true' }, '‹')),
    h('div', { class: 'face face--back face--y' }, profilePage(card)));
  const inside = insidePage(card);
  const base = h('div', { class: 'base' },
    h('div', { class: 'face face--front' }, inside.el),
    h('div', { class: 'face face--back face--x' }, backPage(card)));
  const flipper = h('div', { class: 'flipper' }, base, leaf);
  const root = h('div', { class: 'card3d' }, flipper);
  return { pos: h('div', { class: 'card-pos' }, root), root, flipper, leaf, inside };
}

// ---------- layout and drawing ----------

function measure() {
  const r = v.stage.getBoundingClientRect();
  const P = cssNum('--card-w'), H = cssNum('--card-h');
  const W = r.width, Hs = r.height;
  // Scales are rounded so the card's width is a whole number of pixels.
  const whole = x => Math.floor(P * x) / P;
  const s0 = whole(Math.min((W * 0.92) / P, (Hs * 0.9) / H));
  const s1 = hasInside(v.card) ? whole(Math.min((W * 0.96) / (2 * P), (Hs * 0.9) / H)) : s0;
  v.L = { P, H, W, Hs, s0, s1, cx: W / 2, cy: Hs / 2, left: r.left, top: r.top };
  // Where the zoom starts: the tapped tile, or a small card in the middle.
  const from = v.fromEl?.isConnected ? v.fromEl.getBoundingClientRect() : null;
  v.from = from
    ? { cx: from.left + from.width / 2 - r.left, cy: from.top + from.height / 2 - r.top, k: from.width / (P * s0) }
    : { cx: W / 2, cy: Hs / 2, k: 0.4 };
  v.zoomer.style.setProperty('transform-origin', `${v.L.cx}px ${v.L.cy}px`);
}

const at = (x, a) => Math.abs(x - a) < 1e-4;

// At rest: nothing moving, fully zoomed in, and the card fully closed, open or turned over.
function atRest() {
  return !v.cancel && !v.zoomCancel && !v.dragging && at(v.z, 1)
    && (at(v.p, 0) || at(v.p, 1)) && (at(v.f, 0) || at(v.f, 1));
}

function draw() {
  const { L, p, f, z, from } = v;
  const reduced = reducedMotion();
  const rest = atRest();

  // Binder behind: grows faster than the card and blurs (parallax), unless motion is reduced.
  const bg = 1 - (1 - z) ** 2;
  if (!reduced) {
    v.main.style.setProperty('transform', `scale(${1 + cssNum('--zoom-bg-scale') * bg})`);
    v.main.style.setProperty('filter', `blur(${cssNum('--zoom-bg-blur') * bg}px)`);
  }
  v.scrim.style.setProperty('opacity', String(bg));
  v.chrome.forEach(el => el.style.setProperty('opacity', String(clamp((z - 0.6) / 0.4))));

  // The card's layout scale (CSS zoom) only changes at rest; while moving, a transform
  // makes up the difference.
  const s = lerp(L.s0, L.s1, p);
  if (rest || !v.zoom) v.zoom = s;
  v.built.root.style.setProperty('zoom', String(v.zoom));

  // Card pose: the closed card is centred; the open spread is centred on the spine.
  const x0 = L.cx - ((1 - p) * L.P * s) / 2;
  const y0 = L.cy - (L.H * s) / 2;
  const pos = v.built.pos;
  v.stage.classList.toggle('is-3d', !rest);
  v.built.root.classList.toggle('is-rest', rest);
  if (rest) {
    v.built.root.dataset.pose = f > 0.5 ? 'back' : p > 0.5 ? 'open' : 'front';
    pos.style.setProperty('left', `${Math.round(x0)}px`);
    pos.style.setProperty('top', `${Math.round(y0)}px`);
    pos.style.removeProperty('transform');
    ['transform'].forEach(k => { v.built.leaf.style.removeProperty(k); v.built.flipper.style.removeProperty(k); });
  } else {
    pos.style.setProperty('left', '0px');
    pos.style.setProperty('top', '0px');
    pos.style.setProperty('transform', `translate(${x0}px, ${y0}px) scale(${s / v.zoom})`);
    // Springs overshoot a little; the rotation is clamped so the cover never dips behind the
    // page it covers (the position still gets the bounce).
    v.built.leaf.style.setProperty('transform', `translateZ(1px) rotateY(${-180 * clamp(p)}deg)`);
    v.built.flipper.style.setProperty('transform', `rotateX(${180 * clamp(f)}deg)`);
  }
  v.built.root.classList.toggle('is-flipped', f > 0.5);
  v.built.root.classList.toggle('is-open', p > 0.02);

  // Zoom from the tile: starts scaled down to the tile and grows to its real size (FLIP).
  const q = 1 - z;
  if (reduced) v.zoomer.style.setProperty('opacity', String(z));
  else if (at(z, 1)) v.zoomer.style.removeProperty('transform');
  else v.zoomer.style.setProperty('transform', `translate(${(from.cx - L.cx) * q}px, ${(from.cy - L.cy) * q}px) scale(${lerp(1, from.k, q)})`);

  updateHint();
}

function updateHint() {
  const { p, f, card } = v;
  let key = null;
  if (f > 0.5) key = 'card.hintBack';
  else if (p > 0.5) key = 'card.hintCloseBook';
  else if (hasInside(card)) key = 'card.hintBook';
  else if (hasBack(card)) key = 'card.hintFlip';
  if (key === v.hintKey) return;
  v.hintKey = key;
  mount(v.hint, key && tx(key));
}

// ---------- motion ----------

// Page turns and flips share one animation slot; the zoom in/out has its own, so tapping
// open (or starting a drag) while the card is still zooming in doesn't freeze the zoom.
function stopMotion() { v?.cancel?.(); if (v) v.cancel = null; }
function stopZoom() { v?.zoomCancel?.(); if (v) v.zoomCancel = null; }

// Spring one of p / f / z to a target, then run `after`.
function settle(prop, target, velocity = 0, after) {
  const zoom = prop === 'z';
  if (zoom) stopZoom(); else stopMotion();
  const cancel = spring({
    from: v[prop], to: target, velocity,
    onUpdate: x => { v[prop] = x; draw(); },
    onDone: () => {
      if (zoom) v.zoomCancel = null; else v.cancel = null;
      draw();
      // The comparison animation plays as the card finishes opening.
      if (prop === 'p' && target === 1) v.built.inside.replay();
      after?.();
    },
  });
  if (zoom) v.zoomCancel = cancel; else v.cancel = cancel;
}

export function toggleOpen() {
  if (!v || !hasInside(v.card) || v.f > 0.01) return;
  haptic(10);
  settle('p', v.p > 0.5 ? 0 : 1);
}

export function toggleFlip() {
  if (!v || !hasBack(v.card) || v.p > 0.01) return;
  haptic(10);
  settle('f', v.f > 0.5 ? 0 : 1);
}

// ---------- gestures ----------

function wireGestures() {
  let mode = null, base = 0;
  const cardRect = () => v.built.root.getBoundingClientRect();
  const closedFront = () => v.p < 0.01 && v.f < 0.01;

  track(v.stage, {
    start: ({ target }) => {
      if (v.closing || target.closest?.('[data-swipe]')) return false; // e.g. the Profile list
      stopMotion();
      return true;
    },
    lock: ({ dx, dy, axis, x }) => {
      mode = null;
      if (closedFront()) {
        const r = cardRect();
        if (axis === 'x' && dx < 0 && hasInside(v.card) && x > r.left + r.width * 0.6) mode = 'open';
        else if (axis === 'y' && dy < 0 && hasBack(v.card)) mode = 'flip';
        else if (axis === 'y' && dy > 0) { mode = 'dismiss'; stopZoom(); }
      } else if (v.p > DONE && axis === 'x' && dx > 0) mode = 'close';
      else if (v.f > DONE && axis === 'y' && dy > 0) mode = 'unflip';
      if (!mode) return false;
      base = { p: v.p, f: v.f, z: v.z };
      v.dragging = true;
      return true;
    },
    move: ({ dx, dy }) => {
      const L = v.L;
      const turn = L.P * L.s0 * 1.4; // finger travel for a full page turn
      if (mode === 'open') v.p = clamp(-dx / turn);
      if (mode === 'close') v.p = 1 - clamp(dx / turn);
      if (mode === 'flip') v.f = clamp(-dy / (L.H * L.s0 * 0.7));
      if (mode === 'unflip') v.f = 1 - clamp(dy / (L.H * L.s0 * 0.7));
      if (mode === 'dismiss') v.z = 1 - clamp(dy / (L.Hs * 0.6));
      draw();
    },
    end: ({ dx, dy, vx, vy }) => {
      v.dragging = false;
      const L = v.L;
      const turn = L.P * L.s0 * 1.4;
      if (mode === 'open' || mode === 'close') {
        const vel = -vx / turn;
        const target = Math.abs(vel) > 1.2 ? (vel > 0 ? 1 : 0) : v.p > 0.5 ? 1 : 0;
        if (target !== base.p) haptic(12);
        settle('p', target, vel);
      } else if (mode === 'flip' || mode === 'unflip') {
        const vel = -vy / (L.H * L.s0 * 0.7);
        const target = Math.abs(vel) > 1.2 ? (vel > 0 ? 1 : 0) : v.f > 0.5 ? 1 : 0;
        if (target !== base.f) haptic(12);
        settle('f', target, vel);
      } else if (mode === 'dismiss') {
        if (dy > L.Hs * 0.18 || vy > 700) { haptic(8); dismiss(); } else settle('z', 1, -vy / (L.Hs * 0.6));
      }
      mode = null;
    },
    cancel: () => { mode = null; v.dragging = false; draw(); },
    // With the notebook open, pinching the card fills the screen with it (or brings it back).
    pinchStart: () => { stopMotion(); mode = null; v.dragging = false; },
    pinchMove: () => {},
    pinchEnd: ({ scale }) => {
      if (!v.split) return;
      if (scale > 1.25) maximise('card');
      else if (scale < 0.8) maximise(null);
    },
  });
}

// ---------- read aloud, credits, chrome ----------

function readPairs() {
  const c = v.card;
  if (v.f > 0.5) return [...(c.factFile?.breeding ?? []), t('card.habitat'), ...(c.factFile?.habitat ?? [])];
  if (v.p > 0.5) {
    const s = c.stats ?? {};
    return [...(c.profile?.callouts ?? []), ...(s.diet ? [t('card.diet'), s.diet] : [])];
  }
  return [c.name, ...factsOf(c)];
}

function readButton() {
  if (!speechSupported) return null;
  const icon = h('span', { 'aria-hidden': 'true' }, '🔊');
  const btn = h('button', { class: 'btn btn--icon btn--read', type: 'button', 'aria-label': label('card.readAloud') }, icon);
  const idle = () => { btn.classList.remove('is-speaking'); icon.textContent = '🔊'; };
  btn.addEventListener('click', () => {
    if (btn.classList.contains('is-speaking') && isSpeaking()) { stop(); return; }
    btn.classList.add('is-speaking');
    icon.textContent = '⏹';
    speak(readPairs(), { mode: getMode(), rate: speechRate(), onend: idle });
  });
  return btn;
}

function openCredits() {
  mount(v.sheet,
    h('h2', { class: 'sheet__title' }, h('span', { 'aria-hidden': 'true' }, '📷'), tx('card.credits')),
    cardCredits(v.card),
    h('div', { class: 'sheet__actions' },
      h('button', { class: 'btn btn--primary', type: 'button', onclick: () => v.sheet.close() }, tx('card.close'))));
  v.sheet.showModal();
}

function buildBar(card) {
  const g = groupById(card.group);
  const siblings = cardsIn(card.group).filter(isVisible);
  const i = siblings.indexOf(card);
  const nav = (target, key, glyph) => h('button', {
    class: ['btn btn--icon', !target && 'is-hidden'], type: 'button', 'aria-label': label(key),
    onclick: () => { if (target) location.hash = `#/card/${encodeURIComponent(target.id)}`; },
  }, glyph);
  return h('div', { class: 'viewer__bar', 'data-group': card.group },
    h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('card.back'), onclick: () => dismiss() }, '←'),
    h('span', { class: 'viewer__group' }, groupTitle(g)),
    h('span', { class: 'viewer__no' }, cardNo(card.number)),
    h('span', { class: 'spacer' }),
    readButton(),
    hasInside(card) && h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('card.open'), onclick: toggleOpen }, '📖'),
    hasBack(card) && h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('card.turnOver'), onclick: toggleFlip }, '🔄'),
    notesButton(card),
    nav(siblings[i - 1], 'card.prev', '‹'),
    nav(siblings[i + 1], 'card.next', '›'));
}

// 📓 with the number of pages linked to this card.
function notesButton(card) {
  if (watching()) return null; // Field Notes stay on the explorers' device
  const n = notesCount(card.id);
  return h('button', {
    class: ['btn btn--icon viewer__notes', v?.split && 'is-on'], type: 'button',
    'aria-label': label(n === 0 ? 'notes.open' : n === 1 ? 'notes.openCount.one' : 'notes.openCount.many', { n }), 'aria-pressed': String(Boolean(v?.split)),
    onclick: () => toggleNotes(),
  }, h('span', { 'aria-hidden': 'true' }, '📓'), n > 0 && h('span', { class: 'viewer__notes-n', 'aria-hidden': 'true' }, String(n)));
}

function setCard(card) {
  v.card = card;
  v.built = buildBook(card, openCredits);
  mount(v.zoomer, v.built.pos);
  v.zoom = 0;
  const bar = buildBar(card);
  // Double-tap the bar (not a button) to fill the screen with the card, or come back.
  bar.addEventListener('dblclick', e => { if (v.split && !e.target.closest('button')) maximise(v.max === 'card' ? null : 'card'); });
  v.bar.replaceWith(bar);
  v.bar = bar;
  v.chrome = [v.bar, v.hint];
  v.p = 0; v.f = 0; v.hintKey = undefined;
}

// ---------- open / switch / close ----------

// fromEl: the binder tile to zoom out of. onDismiss: called when the child closes the
// card themselves (swipe down or ←), so the app can update the address.
export function open(card, { fromEl, main, onDismiss } = {}) {
  if (v) teardown();
  const scrim = h('div', { class: 'viewer__scrim' });
  const zoomer = h('div', { class: 'viewer__zoomer' });
  const stage = h('div', { class: 'viewer__stage' }, zoomer);
  const hint = h('p', { class: 'viewer__hint', 'aria-live': 'polite' });
  const bar = h('div');
  const sheet = h('dialog', { class: 'sheet' });
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
  const pane = h('div', { class: 'viewer__pane' }, bar, stage, hint);
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true' }, scrim, pane, sheet);
  el.addEventListener('wheel', e => e.preventDefault(), { passive: false });
  document.body.append(el);

  v = { el, pane, scrim, zoomer, stage, hint, bar, sheet, main, fromEl, onDismiss, p: 0, f: 0, z: 0, cancel: null, split: null, max: null };
  setCard(card);
  if (main && fromEl) {
    const m = main.getBoundingClientRect(), r = fromEl.getBoundingClientRect();
    main.style.setProperty('transform-origin', `${r.left + r.width / 2 - m.left}px ${r.top + r.height / 2 - m.top}px`);
  }
  measure();
  draw();
  wireGestures();
  v.onResize = () => { fitSplit(); measure(); draw(); };
  window.addEventListener('resize', v.onResize);

  v.zoomCancel = tween({ from: 0, to: 1, duration: 520, onUpdate: z => { v.z = z; draw(); }, onDone: () => { v.zoomCancel = null; draw(); } });
}

// Show another card in the open viewer (‹ ›), with a quick cross-fade.
export function show(card) {
  if (!v) return;
  stopMotion();
  stop();
  setCard(card);
  if (v.split) { closeNotes(); openNotes(); }
  v.fromEl = v.main?.querySelector(`.tile[data-card="${CSS.escape(card.id)}"]`) ?? v.fromEl;
  v.z = 1;
  measure();
  draw();
  if (!reducedMotion()) v.built.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
}

function teardown() {
  if (!v) return;
  v.split?.book.destroy();
  stopMotion();
  stopZoom();
  stop();
  window.removeEventListener('resize', v.onResize);
  ['transform', 'filter', 'transform-origin'].forEach(p => v.main?.style.removeProperty(p));
  v.el.remove();
  v = null;
}

// ---------- Field Notes beside the card ----------

// Side by side and stacked each remember their own divider position (kept on this device).
const stacked = () => getComputedStyle(v.el).flexDirection === 'column';
const splitKey = () => `we-notes-split-${stacked() ? 'col' : 'row'}`;
// Stacked starts with more room for the page.
const readSplit = () => { const d = stacked() ? 0.4 : 0.5; try { return Number(localStorage.getItem(splitKey())) || d; } catch { return d; } };
// Turning the tablet swaps between the two.
function fitSplit() {
  if (!v?.split || v.split.stacked === stacked()) return;
  v.split.stacked = stacked();
  v.el.style.setProperty('--split', String(readSplit()));
}
const relayout = () => requestAnimationFrame(() => { if (v) { measure(); draw(); } });

export function openNotes() {
  if (watching()) return;
  if (!v || v.split) return;
  const book = notebook({
    cardId: v.card.id, beside: true,
    onMaximise: m => maximise(m === 'toggle' ? (v.max === 'notes' ? null : 'notes') : m === 'max' ? 'notes' : null),
    onClose: () => toggleNotes(false),
  });
  const divider = h('div', { class: 'viewer__divider', role: 'separator', 'aria-label': label('notes.divider'), tabindex: '0' });
  const notesPane = h('div', { class: 'viewer__notespane' }, book.el);
  const tab = (id, key, icon) => h('button', { type: 'button', role: 'tab', class: 'viewer__tab', 'data-pane': id, onclick: () => showPane(id) },
    h('span', { 'aria-hidden': 'true' }, icon), tx(key));
  const tabs = h('div', { class: 'viewer__tabs', role: 'tablist' }, tab('card', 'notes.tabCard', '🃏'), tab('notes', 'notes.tabNotes', '📓'));
  v.el.insertBefore(tabs, v.pane);
  v.pane.after(divider, notesPane);
  v.split = { book, divider, notesPane, tabs, stacked: null };
  v.el.classList.add('is-split');
  fitSplit();
  showPane('notes');
  wireDivider(divider);
  wireTabSwipe(tabs);
  v.bar.querySelector('.viewer__notes')?.classList.add('is-on');
  relayout();
}

function closeNotes() {
  if (!v?.split) return;
  const { book, divider, notesPane, tabs } = v.split;
  book.destroy();
  [divider, notesPane, tabs].forEach(x => x.remove());
  v.split = null;
  v.max = null;
  v.el.classList.remove('is-split', 'is-max-card', 'is-max-notes');
  v.el.removeAttribute('data-pane');
  // The page count on 📓 may have changed.
  v.bar.querySelector('.viewer__notes')?.replaceWith(notesButton(v.card));
  relayout();
}

export function toggleNotes(open = !v?.split) { if (open) openNotes(); else closeNotes(); }

// null: both panes; 'card' or 'notes': that pane fills the screen.
function maximise(which) {
  if (!v?.split) return;
  v.max = which;
  v.el.classList.toggle('is-max-card', which === 'card');
  v.el.classList.toggle('is-max-notes', which === 'notes');
  haptic(8);
  relayout();
}

// Phones: one pane at a time; tap a tab or swipe across the tabs.
function showPane(id) {
  v.el.dataset.pane = id;
  v.split.tabs.querySelectorAll('[data-pane]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.pane === id)));
  relayout();
}
function wireTabSwipe(tabs) {
  let x0 = null;
  tabs.addEventListener('pointerdown', e => { x0 = e.clientX; });
  tabs.addEventListener('pointerup', e => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) showPane(dx < 0 ? 'notes' : 'card');
  });
}

// Drag the divider to give either pane more room (kept on this device).
function wireDivider(divider) {
  const setTo = k => {
    const x = clamp(k, 0.25, 0.75);
    v.el.style.setProperty('--split', String(x));
    try { localStorage.setItem(splitKey(), String(x)); } catch { /* fine without */ }
  };
  divider.addEventListener('pointerdown', e => {
    try { divider.setPointerCapture(e.pointerId); } catch { /* gone */ }
    divider.classList.add('is-dragging');
    const r = v.el.getBoundingClientRect();
    const onMove = ev => {
      setTo(stacked() ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width);
      measure();
      draw();
    };
    const onUp = () => {
      divider.classList.remove('is-dragging');
      divider.removeEventListener('pointermove', onMove);
      divider.removeEventListener('pointerup', onUp);
      relayout();
    };
    divider.addEventListener('pointermove', onMove);
    divider.addEventListener('pointerup', onUp);
  });
  divider.addEventListener('keydown', e => {
    const step = { ArrowLeft: -0.05, ArrowUp: -0.05, ArrowRight: 0.05, ArrowDown: 0.05 }[e.key];
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    setTo(Number(v.el.style.getPropertyValue('--split')) + step);
    relayout();
  });
}

// Close with the zoom running backwards into the tile.
export function close({ animate = true } = {}) {
  if (!v) return Promise.resolve();
  if (!animate || reducedMotion()) { teardown(); return Promise.resolve(); }
  v.closing = true; // no gestures while zooming back into the binder
  stopMotion();
  stopZoom();
  stop();
  v.fromEl = v.main?.querySelector(`.tile[data-card="${CSS.escape(v.card.id)}"]`) ?? v.fromEl;
  measure();
  const start = { p: v.p, f: v.f, z: v.z };
  return new Promise(resolve => {
    v.zoomCancel = tween({
      from: 0, to: 1, duration: 420,
      onUpdate: u => { v.p = start.p * (1 - u); v.f = start.f * (1 - u); v.z = start.z * (1 - u); draw(); },
      onDone: () => { teardown(); resolve(); },
    });
  });
}

function dismiss() {
  const done = v?.onDismiss;
  close().then(() => done?.());
}

export function onKey(e) {
  if (!v || document.querySelector('.viewer dialog[open]')) return;
  if (e.key === 'Escape') dismiss();
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const siblings = cardsIn(v.card.group).filter(isVisible);
    const target = siblings[siblings.indexOf(v.card) + (e.key === 'ArrowLeft' ? -1 : 1)];
    if (target) location.hash = `#/card/${encodeURIComponent(target.id)}`;
  } else if (e.key === ' ' || e.key === 'Enter') {
    if (e.target.closest?.('button, a')) return;
    e.preventDefault();
    toggleOpen();
  }
}
