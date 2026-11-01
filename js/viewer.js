// The card viewer: a full-screen layer over the binder.
// - Opens by zooming from the tapped binder tile (the binder grows and blurs behind it).
// - The card is a bi-fold: cover, inside spread, back. Two opening styles:
//     book   – drag the right edge; the cover turns around the spine (rotateY)
//     fridge – spread two fingers; the cover splits and both halves swing open
// - Swipe up to turn the card over, swipe down to go back to the binder.
// Every gesture follows the finger; on release a spring finishes or undoes it.
import { h, mount, reducedMotion } from './dom.js';
import { tx, t, label, getMode } from './i18n.js';
import { state, cardsIn, isVisible, groupById, speechRate } from './store.js';
import {
  coverPage, profilePage, statsSection, compareSection, backPage, cardCredits,
  hasInside, hasBack, factsOf,
} from './cardparts.js';
import { cardNo, groupTitle } from './components.js';
import { track, spring, tween, clamp, lerp, haptic } from './gesture.js';
import { speak, stop, isSpeaking, speechSupported } from './speech.js';

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
  const inside = h('div', { class: 'page page--inside', 'data-group': card.group },
    statsSection(card), compareSection(card));
  const base = h('div', { class: 'base' },
    h('div', { class: 'face face--front' }, inside),
    h('div', { class: 'face face--back face--x' }, backPage(card)));
  const flipper = h('div', { class: 'flipper' }, base, leaf);
  return { root: h('div', { class: 'card3d card3d--book' }, flipper), flipper, movers: [leaf] };
}

function buildFridge(card, onCredit) {
  const flap = section => h('div', { class: 'page page--flap', 'data-group': card.group }, section);
  const door = (side, back) => h('div', { class: `door door--${side}` },
    h('div', { class: 'face face--front door__front' },
      h('div', { class: 'door__cover', 'aria-hidden': side === 'right' ? 'true' : null }, coverPage(card, { onCredit }))),
    h('div', { class: 'face face--back face--y' }, flap(back)));
  const left = door('left', statsSection(card));
  const right = door('right', compareSection(card));
  const center = h('div', { class: 'base' },
    h('div', { class: 'face face--front' }, profilePage(card)),
    h('div', { class: 'face face--back face--x' }, backPage(card)));
  const flipper = h('div', { class: 'flipper' }, center, left, right);
  return { root: h('div', { class: 'card3d card3d--fridge' }, flipper), flipper, movers: [left, right] };
}

// ---------- layout and drawing ----------

function measure() {
  const r = v.stage.getBoundingClientRect();
  const P = cssNum('--card-w'), H = cssNum('--card-h');
  const W = r.width, Hs = r.height;
  const s0 = Math.min((W * 0.92) / P, (Hs * 0.9) / H);
  const s1 = hasInside(v.card) ? Math.min((W * 0.96) / (2 * P), (Hs * 0.9) / H) : s0;
  v.L = { P, H, W, Hs, s0, s1, cx: W / 2, cy: Hs / 2, left: r.left, top: r.top };
  // Where the zoom starts: the tapped tile, or a small card in the middle.
  const from = v.fromEl?.isConnected ? v.fromEl.getBoundingClientRect() : null;
  v.from = from
    ? { cx: from.left + from.width / 2 - r.left, cy: from.top + from.height / 2 - r.top, k: from.width / (P * s0) }
    : { cx: W / 2, cy: Hs / 2, k: 0.4 };
  v.zoomer.style.setProperty('transform-origin', `${v.L.cx}px ${v.L.cy}px`);
}

function draw() {
  const { L, p, f, z, from } = v;
  const reduced = reducedMotion();

  // Binder behind: grows faster than the card and blurs (parallax), unless motion is reduced.
  const bg = 1 - (1 - z) ** 2;
  if (!reduced) {
    v.main.style.setProperty('transform', `scale(${1 + cssNum('--zoom-bg-scale') * bg})`);
    v.main.style.setProperty('filter', `blur(${cssNum('--zoom-bg-blur') * bg}px)`);
  }
  v.scrim.style.setProperty('opacity', String(bg));
  v.chrome.forEach(el => el.style.setProperty('opacity', String(clamp((z - 0.6) / 0.4))));

  // Card pose: closed card centred; open spread centred on the spine (book) or panel (fridge).
  const s = lerp(L.s0, L.s1, p);
  const x0 = v.style === 'book' ? L.cx - ((1 - p) * L.P * s) / 2 : L.cx - (L.P * s) / 2;
  const y0 = L.cy - (L.H * s) / 2;
  v.built.root.style.setProperty('transform', `translate(${x0}px, ${y0}px) scale(${s})`);
  const [a, b] = v.built.movers;
  a.style.setProperty('transform', `translateZ(1px) rotateY(${-180 * p}deg)`);
  b?.style.setProperty('transform', `translateZ(1px) rotateY(${180 * p}deg)`);
  v.built.flipper.style.setProperty('transform', `rotateX(${180 * f}deg)`);
  v.built.root.classList.toggle('is-flipped', f > 0.5);
  v.built.root.classList.toggle('is-open', p > 0.02);

  // Zoom from the tile.
  const q = 1 - z;
  if (reduced) v.zoomer.style.setProperty('opacity', String(z));
  else v.zoomer.style.setProperty('transform', `translate(${(from.cx - L.cx) * q}px, ${(from.cy - L.cy) * q}px) scale(${lerp(1, from.k, q)})`);

  updateHint();
}

function updateHint() {
  const { p, f, card } = v;
  let key = null;
  if (f > 0.5) key = 'card.hintBack';
  else if (p > 0.5) key = v.style === 'book' ? 'card.hintCloseBook' : 'card.hintCloseFridge';
  else if (hasInside(card)) key = v.style === 'book' ? 'card.hintBook' : 'card.hintFridge';
  else if (hasBack(card)) key = 'card.hintFlip';
  if (key === v.hintKey) return;
  v.hintKey = key;
  mount(v.hint, key && tx(key));
}

// ---------- motion ----------

function stopMotion() { v?.cancel?.(); if (v) v.cancel = null; }

// Spring one of p / f / z to a target, then run `after`.
function settle(prop, target, velocity = 0, after) {
  stopMotion();
  v.cancel = spring({
    from: v[prop], to: target, velocity,
    onUpdate: x => { v[prop] = x; draw(); },
    onDone: () => { v.cancel = null; after?.(); },
  });
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
    start: () => { stopMotion(); return true; },
    lock: ({ dx, dy, axis, x }) => {
      mode = null;
      if (closedFront()) {
        const r = cardRect();
        if (axis === 'x' && dx < 0 && v.style === 'book' && hasInside(v.card) && x > r.left + r.width * 0.6) mode = 'open';
        else if (axis === 'y' && dy < 0 && hasBack(v.card)) mode = 'flip';
        else if (axis === 'y' && dy > 0) mode = 'dismiss';
      } else if (v.p > DONE && v.style === 'book' && axis === 'x' && dx > 0) mode = 'close';
      else if (v.f > DONE && axis === 'y' && dy > 0) mode = 'unflip';
      if (!mode) return false;
      base = { p: v.p, f: v.f, z: v.z };
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
    cancel: () => { mode = null; },
    pinchStart: () => {
      stopMotion();
      mode = null;
      if (v.style !== 'fridge' || !hasInside(v.card) || v.f > 0.01) return;
      mode = v.p > 0.5 ? 'pclose' : 'popen';
    },
    pinchMove: ({ delta }) => {
      const span = v.L.P * v.L.s0 * 0.8;
      if (mode === 'popen') v.p = clamp(delta / span);
      if (mode === 'pclose') v.p = 1 - clamp(-delta / span);
      if (mode) draw();
    },
    pinchEnd: ({ velocity }) => {
      if (!mode) return;
      const vel = velocity / (v.L.P * v.L.s0 * 0.8);
      const target = Math.abs(vel) > 1.2 ? (vel > 0 ? 1 : 0) : v.p > 0.5 ? 1 : 0;
      haptic(12);
      settle('p', target, vel);
      mode = null;
    },
  });
}

// ---------- read aloud, credits, chrome ----------

function readPairs() {
  const c = v.card;
  if (v.f > 0.5) return [...(c.lifeCycle ?? []), ...(c.habitat?.en || c.habitat?.zh ? [t('card.habitat'), c.habitat] : [])];
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
    nav(siblings[i - 1], 'card.prev', '‹'),
    nav(siblings[i + 1], 'card.next', '›'));
}

function setCard(card) {
  v.card = card;
  v.style = state.settings.openStyle === 'fridge' ? 'fridge' : 'book';
  v.built = (v.style === 'book' ? buildBook : buildFridge)(card, openCredits);
  mount(v.zoomer, v.built.root);
  const bar = buildBar(card);
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
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true' }, scrim, bar, stage, hint, sheet);
  el.addEventListener('wheel', e => e.preventDefault(), { passive: false });
  document.body.append(el);

  v = { el, scrim, zoomer, stage, hint, bar, sheet, main, fromEl, onDismiss, p: 0, f: 0, z: 0, cancel: null };
  setCard(card);
  if (main && fromEl) {
    const m = main.getBoundingClientRect(), r = fromEl.getBoundingClientRect();
    main.style.setProperty('transform-origin', `${r.left + r.width / 2 - m.left}px ${r.top + r.height / 2 - m.top}px`);
  }
  measure();
  draw();
  wireGestures();
  v.onResize = () => { measure(); draw(); };
  window.addEventListener('resize', v.onResize);

  v.cancel = tween({ from: 0, to: 1, duration: 520, onUpdate: z => { v.z = z; draw(); }, onDone: () => { v.cancel = null; } });
}

// Show another card in the open viewer (‹ ›), with a quick cross-fade.
export function show(card) {
  if (!v) return;
  stopMotion();
  stop();
  setCard(card);
  v.fromEl = v.main?.querySelector(`.tile[data-card="${CSS.escape(card.id)}"]`) ?? v.fromEl;
  v.z = 1;
  measure();
  draw();
  if (!reducedMotion()) v.built.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
}

function teardown() {
  if (!v) return;
  stopMotion();
  stop();
  window.removeEventListener('resize', v.onResize);
  ['transform', 'filter', 'transform-origin'].forEach(p => v.main?.style.removeProperty(p));
  v.el.remove();
  v = null;
}

// Close with the zoom running backwards into the tile.
export function close({ animate = true } = {}) {
  if (!v) return Promise.resolve();
  if (!animate || reducedMotion()) { teardown(); return Promise.resolve(); }
  stopMotion();
  stop();
  v.fromEl = v.main?.querySelector(`.tile[data-card="${CSS.escape(v.card.id)}"]`) ?? v.fromEl;
  measure();
  const start = { p: v.p, f: v.f, z: v.z };
  return new Promise(resolve => {
    v.cancel = tween({
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
