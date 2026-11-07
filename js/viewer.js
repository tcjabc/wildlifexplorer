// The card viewer: a full-screen layer over the binder.
// - Opens by zooming from the tapped binder tile (the binder grows behind it).
// - The card is a bi-fold: cover (Card), inside spread (Profile), back (Fact File).
// - Gestures are decided by direction, from anywhere on the card (or a margin around it, never
//   the screen's right edge, where the notebook spine goes): sideways opens or closes the card
//   (the cover turns around the spine like a book, rotateY); up turns it over, down goes back
//   to the binder (or turns the back over again). A movement under the slop is a tap, so the
//   buttons on the card keep working. A quarter of the way, or a flick, is enough.
// - The first time a closed card settles, its cover peeks open a little (once per card per
//   profile), to show that it opens.
// Every gesture follows the finger; on release a spring finishes or undoes it.
// - Pages with more than fits ([data-scroll]: the Fact File, Vital Statistics) scroll inside
//   the card: a vertical drag there scrolls; on the Fact File, a drag down from the top turns
//   the card back over.
//
// Field Notes: the notebook is always there, collapsed (a spine at the right, or a tab on
// phones) or expanded (a panel beside the card, or over it). The open spread stays at card
// scale; when it is wider than the space a sideways drag pans it, and dragging on past its left
// edge closes it (js/card-layout.js).
//
// Sharpness: the card is laid out at its real on-screen size with CSS zoom (never a small
// card scaled up). While it moves it uses 3D transforms; at rest every transform comes off
// and the cover / open spread / back is drawn flat, so text and photos stay crisp.
import { h, mount, reducedMotion } from './dom.js';
import { tx, label, getMode } from './i18n.js';
import { state, cardsIn, isVisible, groupById, speechRate, watching, updateProfile, debugOn } from './store.js';
import { dockMode, cardLayout, fitScale, spreadRange, panDrag, clipLeftOf } from './card-layout.js';
import { sideOf } from './card-return.js';
import {
  coverPage, profilePage, insidePage, backPage, cardCredits,
  hasInside, hasBack, readOrder,
} from './cardparts.js';
import { cardNo, groupTitle } from './components.js';
import { track, spring, tween, clamp, lerp, haptic } from './gesture.js';
import { speak, stop, isSpeaking, speechSupported } from './speech.js';
import { notebook } from './notebook.js';
import { closePopover } from './glossary.js';
import { releaseOutcome } from './gesture-release.js';

const cssNum = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
const DONE = 0.999;
const HAND_DROP = 0.2; // the hand sits this share of the card's height below its middle

let v = null; // the open viewer, or null

export const isOpen = () => v !== null;
export const openCardId = () => v?.card.id ?? null;

// ---------- building the card ----------

function buildBook(card, onCredit, onMap) {
  const leaf = h('div', { class: 'leaf' },
    h('div', { class: 'face face--front' }, coverPage(card, { onCredit, onMap })),
    h('div', { class: 'face face--back face--y' }, profilePage(card)));
  const inside = insidePage(card);
  const base = h('div', { class: 'base' },
    h('div', { class: 'face face--front' }, inside.el),
    h('div', { class: 'face face--back face--x' }, backPage(card, { onMap })));
  const flipper = h('div', { class: 'flipper' }, base, leaf);
  const root = h('div', { class: 'card3d' }, flipper);
  return { pos: h('div', { class: 'card-pos' }, root), root, flipper, leaf, inside };
}

// ---------- layout and drawing ----------

// The card's space (js/card-layout.js): the stage less what the notebook takes; the closed
// card fits it (s0), the open spread stays at card scale (s1) and pans when it doesn't fit.
function measure(again = true) {
  const r = v.stage.getBoundingClientRect();
  const P = cssNum('--card-w'), H = cssNum('--card-h');
  const W = r.width, Hs = r.height;
  const share = cssNum('--nb-panel-share') || undefined;
  const mode = v.dock ? dockMode({ vw: window.innerWidth, W, Hs, P, H, share }) : 'none';
  const lay = v.dock
    ? cardLayout({ W, Hs, P, H, mode, expanded: v.dock.expanded, share })
    : { visibleW: W, s0: fitScale(W, Hs, P, H), s1: fitScale(W, Hs, P, H) };
  const s0 = lay.s0, s1 = hasInside(v.card) ? lay.s1 : s0;
  v.L = { P, H, W, Hs, s0, s1, visibleW: lay.visibleW, cx: lay.visibleW / 2, cy: Hs / 2, left: r.left, top: r.top, mode };
  // A new mode can show or hide the hint row (and so change the stage's height): measure again.
  if (v.el.dataset.dock !== mode) { v.el.dataset.dock = mode; if (again) { measure(false); return; } }
  v.range = spreadRange({ visibleW: lay.visibleW, P, s: s1 });
  v.pan = clamp(v.pan ?? v.range.max, v.range.min, v.range.max);
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
  return !v.cancel && !v.zoomCancel && !v.panCancel && !v.dragging && at(v.z, 1)
    && (at(v.p, 0) || at(v.p, 1)) && (at(v.f, 0) || at(v.f, 1));
}

function draw() {
  const { L, p, f, z, from } = v;
  const reduced = reducedMotion();
  const rest = atRest();

  // Binder behind: grows faster than the card (parallax), unless motion is reduced.
  const bg = 1 - (1 - z) ** 2;
  if (!reduced) {
    v.main.style.setProperty('transform', `scale(${1 + cssNum('--zoom-bg-scale') * bg})`);
  }
  v.scrim.style.setProperty('opacity', String(bg));
  v.chrome.forEach(el => el.style.setProperty('opacity', String(clamp((z - 0.6) / 0.4))));

  // The card's layout scale (CSS zoom) only changes at rest; while moving, a transform
  // makes up the difference.
  const s = lerp(L.s0, L.s1, p);
  if (rest || !v.zoom) v.zoom = s;
  v.built.root.style.setProperty('zoom', String(v.zoom));

  // Card pose: the closed card is centred in its space; the open spread is centred when it
  // fits, otherwise where it has been panned to (v.pan is its left edge).
  const closedX = L.cx - (L.P * s) / 2;
  const openX = (v.range.fits ? v.range.min : v.pan) + L.P * s; // the right page's left edge
  const x0 = lerp(closedX, openX, p);
  const y0 = L.cy - (L.H * s) / 2;
  const pos = v.built.pos;
  v.stage.classList.toggle('is-3d', !rest);
  v.built.root.classList.toggle('is-rest', rest);
  if (rest) {
    v.built.root.dataset.pose = f > 0.5 ? 'back' : p > 0.5 ? 'open' : 'front';
    if (v.built.root.dataset.pose === 'front') v.pan = v.range.max; // it opens on the left page
    if (v.built.root.dataset.pose === 'front' && at(z, 1)) requestAnimationFrame(peek);
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
  updateHand(rest);
  if (rest) drawZones();
}

// How to open the card: a hand showing the swipe, for children who can't read a hint. It sits on
// the closed card at rest and goes as soon as anything moves.
function updateHand(rest) {
  const covered = v.dock?.expanded && v.L.mode !== 'side';
  const show = rest && at(v.p, 0) && at(v.f, 0) && hasInside(v.card) && !covered;
  v.hand.hidden = !show;
  if (!show) return;
  v.hand.style.setProperty('left', `${Math.round(v.L.cx)}px`);
  v.hand.style.setProperty('top', `${Math.round(v.L.cy + v.L.H * v.L.s0 * HAND_DROP)}px`);
}

function updateHint() {
  const { p, f, card } = v;
  let key = null;
  if (f > 0.5) key = 'card.hintBack';
  else if (p > 0.5) key = v.range?.fits ? 'card.hintCloseBook' : 'card.hintPan';
  else if (!hasInside(card) && hasBack(card)) key = 'card.hintFlip';
  if (key === v.hintKey) return;
  v.hintKey = key;
  mount(v.hint, key && tx(key));
}

// ---------- motion ----------

// Page turns and flips share one animation slot; the zoom in/out has its own, so tapping
// open (or starting a drag) while the card is still zooming in doesn't freeze the zoom.
function stopMotion() {
  v?.cancel?.(); v?.glide?.(); v?.panCancel?.();
  if (v) { v.cancel = null; v.glide = null; v.panCancel = null; }
}

// Spring the open spread's left edge (v.pan) to a place inside its edges. Its own slot, so it
// can run while a page turn settles.
function springPan(target, velocity = 0) {
  v.panCancel?.();
  v.panCancel = spring({
    from: v.pan, to: target, velocity,
    onUpdate: x => { v.pan = x; draw(); },
    onDone: () => { v.panCancel = null; draw(); },
  });
}
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

// ---------- the peek hint ----------

// Which cards have already peeked, per profile (kept on this device only).
const PEEK = 0.15; // of a full turn: about 27°
const peekKey = () => `we-peeked-${state.profile?.id ?? 'none'}`;
function peekedCards() {
  try { return new Set(JSON.parse(localStorage.getItem(peekKey()) ?? '[]')); } catch { return new Set(); }
}
function rememberPeek(id) {
  const ids = peekedCards();
  ids.add(id);
  try { localStorage.setItem(peekKey(), JSON.stringify([...ids])); } catch { /* fine without */ }
}

// The cover swings open a little and eases shut again, once.
function peek() {
  if (!v || v.peeked || !atRest() || v.p !== 0 || v.f !== 0) return;
  v.peeked = true;
  if (reducedMotion() || !hasInside(v.card) || peekedCards().has(v.card.id)) return;
  rememberPeek(v.card.id);
  v.peeking = true;
  v.cancel = tween({
    from: 0, to: 1, duration: 1300, ease: t => (1 - Math.cos(2 * Math.PI * t)) / 2,
    onUpdate: u => { v.p = PEEK * u; draw(); },
    onDone: () => { v.peeking = false; v.cancel = null; v.p = 0; draw(); },
  });
}

// A touch during the peek stops it where it is: a sideways drag carries on opening from
// there; anything else closes the cover again.
function interruptPeek() {
  if (!v.peeking) return false;
  v.peeking = false;
  stopMotion();
  return true;
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

// Gesture tuning, for young kids who aren't precise.
const SLOP = 11;          // px before a movement is a drag (less is a tap)
const SIDEWAYS = Math.tan(30 * Math.PI / 180); // within 30° of horizontal counts as sideways
const MARGIN = 40;        // px around the card that also start a gesture
const OPEN_REACH = 0.5;   // the open zone reaches this share of a card's width to its right
const CLOSE_MARGIN = 80;  // px around the open spread that also start closing it

// Where a gesture may start, in screen pixels:
//   card – the card itself (both pages when open)
//   near – a margin around it (wider around the open spread, for closing)
//   open – the space right of the closed card, where its right page will appear: opening only
// Everything stays inside the stage (below the top bar) and left of the notebook: its spine,
// its panel, or all of the stage while it covers the card. The notebook itself is not part of
// the stage, so drawing in it never reaches these gestures.
function notebookLeft(s) {
  const d = v.dock;
  if (!d) return s.right;
  if (d.expanded && v.L.mode !== 'side') return s.left; // it covers the card
  if (v.L.mode === 'phone') return s.right;            // the tab sits below the stage
  return s.left + v.L.visibleW;
}
function gestureZones() {
  const r = v.built.root.getBoundingClientRect();
  const s = v.stage.getBoundingClientRect();
  const isOpen = v.p > 0.5;
  const nbLeft = notebookLeft(s);
  const fit = b => clipLeftOf({ left: Math.max(b.left, s.left), right: Math.min(b.right, s.right), top: Math.max(b.top, s.top), bottom: Math.min(b.bottom, s.bottom) }, nbLeft);
  const card = fit({ left: isOpen ? r.left - r.width : r.left, right: r.right, top: r.top, bottom: r.bottom });
  const m = isOpen ? CLOSE_MARGIN : MARGIN;
  const near = fit({ left: card.left - m, right: card.right + m, top: card.top - m, bottom: card.bottom + m });
  const closed = v.p < PEEK + 0.01 && v.f < 0.01 && hasInside(v.card);
  const open = closed ? fit({ left: r.right, right: r.right + r.width * OPEN_REACH, top: r.top, bottom: r.bottom }) : null;
  // The notebook's own area, for the debug overlay.
  const d = v.dock;
  const nbEl = !d ? null : d.expanded ? d.panel : v.L.mode === 'phone' ? d.tab : d.spine;
  const nbRect = nbEl?.getBoundingClientRect();
  const notebookBox = nbRect && nbRect.width ? { left: nbRect.left, right: nbRect.right, top: nbRect.top, bottom: nbRect.bottom } : null;
  return { card, near, open, notebook: notebookBox, stage: s };
}
const inBox = (b, x, y) => Boolean(b && b.right > b.left && x >= b.left && x <= b.right && y >= b.top && y <= b.bottom);

// Debug overlay of the gesture zones, for grown-ups in preview: ?debug=gestures (store.js).
const gestureDebugOn = () => debugOn('gestures');
function drawZones() {
  if (!gestureDebugOn()) { v.zones?.remove(); v.zones = null; return; }
  const z = gestureZones();
  if (!v.zones?.isConnected) { v.zones = h('div', { class: 'gzones', 'aria-hidden': 'true' }); v.stage.append(v.zones); }
  const box = (kind, b) => {
    if (!b || b.right <= b.left || b.bottom <= b.top) return null;
    const el = h('div', { class: ['gzones__box', `gzones__box--${kind}`] });
    el.style.setProperty('left', `${b.left - z.stage.left}px`);
    el.style.setProperty('top', `${b.top - z.stage.top}px`);
    el.style.setProperty('width', `${b.right - b.left}px`);
    el.style.setProperty('height', `${b.bottom - b.top}px`);
    return el;
  };
  mount(v.zones,
    box('near', z.near), box('open', z.open), box('card', z.card), box('notebook', z.notebook));
}

function wireGestures() {
  let mode = null, base = null, scroller = null, dir = 1, zone = null;
  const where = (x, y) => {
    const z = gestureZones();
    return inBox(z.card, x, y) ? 'card' : inBox(z.near, x, y) ? 'near' : inBox(z.open, x, y) ? 'open' : null;
  };
  const atEdge = (el, dy) => !el || el.scrollHeight <= el.clientHeight + 1
    || (dy > 0 ? el.scrollTop <= 0 : el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  const travel = () => ({ x: v.L.P * v.L.s0, y: v.L.H * v.L.s0 * 0.7 }); // finger travel for a full turn

  v.untrack = track(v.stage, {
    start: ({ x, y, target }) => {
      if (v.closing || target.closest?.('[data-swipe], .gloss-pop')) return false;
      zone = where(x, y);
      if (!zone) return false;
      const peeking = interruptPeek();
      if (!peeking) stopMotion();
      scroller = target.closest?.('[data-scroll]') ?? null;
      return true;
    },
    tap: () => { if (v.p > 0 && v.p < DONE && !v.cancel) settle('p', 0); }, // e.g. tapped during the peek
    lock: ({ dx, dy }) => {
      mode = null;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      // Within 30° of horizontal is sideways, within 30° of vertical is vertical. In between
      // (a hand that wobbles at the start of a drag), wait for a little more movement, then go
      // by the stronger direction.
      const clear = ay <= ax * SIDEWAYS || ax <= ay * SIDEWAYS;
      if (!clear && Math.hypot(dx, dy) < SLOP * 2) return null;
      const sideways = clear ? ay <= ax * SIDEWAYS : ax >= ay;
      // The open zone right of the card is only for opening.
      if (zone === 'open' && !sideways) return false;
      const closed = v.p < PEEK + 0.01 && v.f < 0.01;
      if (sideways) {
        if (closed && hasInside(v.card)) { mode = 'open'; v.pan = v.range.max; }
        // The open spread: closes straight away when it fits; pans when it doesn't (and closes
        // only when dragged on past its left edge: js/card-layout.js panDrag).
        else if (v.p > DONE) mode = v.range.fits ? 'close' : 'pan';
      } else if (closed) {
        if (dy < 0 && hasBack(v.card)) mode = 'flip';
        else if (dy > 0) { mode = 'dismiss'; stopZoom(); }
      } else if (v.f > DONE) {
        // The back: down from the top of the Fact File turns it back; otherwise it scrolls.
        if (dy > 0 && atEdge(scroller, dy)) mode = 'unflip';
        else if (!atEdge(scroller, dy)) mode = 'scroll';
      } else if (v.p > DONE && !atEdge(scroller, dy)) mode = 'scroll'; // the open spread: pages scroll
      if (zone === 'open' && mode !== 'open') mode = null;
      // Anything but opening closes a cover left ajar by the peek.
      if (mode !== 'open' && v.p > 0 && v.p <= PEEK + 0.01) { v.p = 0; draw(); }
      if (!mode) return false;
      dir = Math.sign(sideways ? dx : dy) || 1;
      base = { p: v.p, f: v.f, z: v.z, pan: v.pan, top: scroller?.scrollTop ?? 0 };
      v.dragging = true;
      return true;
    },
    move: ({ dx, dy }) => {
      const T = travel();
      // How far towards the goal, whichever way the drag went.
      const qx = (dx * dir) / T.x, qy = (dy * dir) / T.y;
      if (mode === 'open') v.p = clamp(base.p + qx);
      if (mode === 'close') v.p = 1 - clamp(qx);
      if (mode === 'flip') v.f = clamp(-dy / T.y);
      if (mode === 'unflip') v.f = 1 - clamp(qy);
      if (mode === 'dismiss') v.z = 1 - clamp(dy / (v.L.Hs * 0.6));
      if (mode === 'pan') {
        const r = panDrag({ start: base.pan, dx, min: v.range.min, max: v.range.max, travel: T.x });
        v.pan = r.left;
        v.p = 1 - r.close;
      }
      // The card is enlarged with CSS zoom, so a finger's pixels are fewer card pixels.
      if (mode === 'scroll') { scroller.scrollTop = base.top - dy / v.zoom; return; }
      draw();
    },
    end: info => {
      // Whatever happens, the gesture ends settled: committed, sprung back or dismissed.
      const m = mode;
      mode = null;
      v.dragging = false;
      try { release(m, info); } catch (err) { springBack(); throw err; }
    },
    // No pointerup (capture lost, window lost focus, a second finger): spring back.
    cancel: () => { mode = null; v.dragging = false; springBack(); },
    // A second finger cancels a drag (the card has no pinch of its own).
    pinchStart: () => { if (mode) springBack(); mode = null; v.dragging = false; },
    pinchMove: () => {},
    pinchEnd: () => {},
  }, { slop: SLOP });

  // Back to where the gesture started.
  function springBack() {
    if (!v || !base) return;
    if (!at(v.p, base.p)) settle('p', base.p);
    else if (!at(v.f, base.f)) settle('f', base.f);
    if (!at(v.z, 1)) settle('z', 1);
    const inside = clamp(v.pan, v.range.min, v.range.max);
    if (!at(v.pan, inside)) springPan(inside);
    draw();
  }

  // Apply what the release decided (js/gesture-release.js).
  function release(mode, info) {
    const o = releaseOutcome(mode, { p: v.p, f: v.f, base, dir, travel: travel(), stageH: v.L.Hs, panLeft: v.pan, range: v.range }, info);
    if (o.dismiss) { haptic(8); dismiss(); return; }
    if (o.springBack) { springBack(); return; }
    if (!o.prop && 'pan' in o) { springPan(o.pan); return; }
    if (o.pan != null) springPan(o.pan);
    if (o.scroll) {
      // A flick keeps gliding a little.
      const el = scroller, from = el.scrollTop, to = from - (o.velocity / v.zoom) * 0.3;
      if (Math.abs(o.velocity) > 200) v.glide = tween({ from, to, duration: 500, onUpdate: x => { el.scrollTop = x; } });
      return;
    }
    if (o.prop !== 'z' && o.target !== base[o.prop]) haptic(12);
    settle(o.prop, o.target, o.velocity);
  }
}

// ---------- read aloud, credits, chrome ----------

const readPairs = () => readOrder(v.card, v.f > 0.5 ? 'back' : v.p > 0.5 ? 'open' : 'front');

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
  closePopover();
  v.card = card;
  v.built = buildBook(card, openCredits, openGlobe);
  mount(v.zoomer, v.built.pos);
  v.zoom = 0;
  const bar = buildBar(card);
  v.bar.replaceWith(bar);
  v.bar = bar;
  v.chrome = [v.bar, v.hintRow, v.dock?.el].filter(Boolean);
  v.p = 0; v.f = 0; v.hintKey = undefined; v.peeked = false; v.pan = undefined;
}

// ---------- open / switch / close ----------

// fromEl: the binder tile to zoom out of. onDismiss: called when the child closes the
// card themselves (swipe down or ←), so the app can update the address.
// restore: what js/card-return.js kept when this card was left for the globe or the full
// notebook (its side and the notebook), to come back to exactly that.
export function open(card, { fromEl, main, onDismiss, restore = null } = {}) {
  if (v) teardown();
  const scrim = h('div', { class: 'viewer__scrim' });
  const zoomer = h('div', { class: 'viewer__zoomer' });
  const hand = h('div', { class: 'viewer__hand', role: 'img', 'aria-label': label('card.hintBook'), hidden: true },
    h('span', { class: 'viewer__hand-icon', 'aria-hidden': 'true' }, '👆'));
  const stage = h('div', { class: 'viewer__stage' }, zoomer, hand);
  const hint = h('p', { class: 'viewer__hint', 'aria-live': 'polite' });
  const bar = h('div');
  const sheet = h('dialog', { class: 'sheet' });
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
  // The notebook beside the stage (not in it, so the card's gestures never see it).
  const dock = buildDock();
  const body = h('div', { class: 'viewer__body' }, stage, dock?.el);
  const hintRow = h('div', { class: 'viewer__hintrow' }, hint, dock?.tab);
  const pane = h('div', { class: 'viewer__pane' }, bar, body, hintRow);
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'data-notebook': 'collapsed' }, scrim, pane, sheet);
  // The page itself never scrolls; pages inside the card that scroll do.
  el.addEventListener('wheel', e => { if (!e.target.closest?.('[data-scroll]')) e.preventDefault(); }, { passive: false });
  // A mouse pressed on a picture would start the browser's own image drag, which cancels the
  // pointer (pointercancel) before a page turn can start. Pictures in the viewer never drag.
  el.addEventListener('dragstart', e => e.preventDefault());
  document.body.append(el);

  v = { el, pane, scrim, zoomer, stage, hand, hint, hintRow, bar, sheet, dock, main, fromEl, onDismiss, p: 0, f: 0, z: 0, cancel: null };
  setCard(card);
  // Collapsed or expanded, as this explorer left it last time (kept on this device), or as it
  // was when the card was left for the globe or the full notebook (and on that page).
  const notes = restore?.notes;
  if (dock && (notes ? notes.expanded : state.profile?.notesPanel === 'expanded')) setNotebook(true, { remember: false, layout: false, start: notes });
  if (restore?.side === 'back') v.f = 1;
  else if (restore?.side === 'inside') v.p = 1;
  if (main && fromEl) {
    const m = main.getBoundingClientRect(), r = fromEl.getBoundingClientRect();
    main.style.setProperty('transform-origin', `${r.left + r.width / 2 - m.left}px ${r.top + r.height / 2 - m.top}px`);
  }
  updateHint(); // before measuring: the hint's lines take height from the stage
  measure();
  draw();
  wireGestures();
  v.onResize = () => { measure(); draw(); };
  window.addEventListener('resize', v.onResize);

  v.zoomCancel = tween({ from: 0, to: 1, duration: 520, onUpdate: z => { v.z = z; draw(); }, onDone: () => { v.zoomCancel = null; draw(); } });
}

// Show another card in the open viewer (‹ ›), with a quick cross-fade.
export function show(card) {
  if (!v) return;
  stopMotion();
  stop();
  setCard(card);
  // An expanded notebook follows the card: its pages link to this one now.
  if (v.dock?.expanded) { setNotebook(false, { remember: false, layout: false }); setNotebook(true, { remember: false, layout: false }); }
  v.fromEl = v.main?.querySelector(`.tile[data-card="${CSS.escape(card.id)}"]`) ?? v.fromEl;
  v.z = 1;
  measure();
  draw();
  if (!reducedMotion()) v.built.root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
}

function teardown() {
  if (!v) return;
  closePopover();
  v.untrack?.(); // also removes its window listeners
  v.dock?.book?.destroy();
  stopMotion();
  stopZoom();
  stop();
  window.removeEventListener('resize', v.onResize);
  ['transform', 'transform-origin'].forEach(p => v.main?.style.removeProperty(p));
  v.el.remove();
  v = null;
}

// ---------- Field Notes: always there, collapsed or expanded ----------

// Collapsed: a kraft spine with an elastic band in the strip at the right (a small tab in the
// hint row on phones). Expanded: a fixed-width panel beside the card, or over it on phones and
// where the card would get too small beside it (js/card-layout.js dockMode). Two states only.
// Not on a grown-up's device: Field Notes stay on the explorers' device.
function buildDock() {
  if (watching()) return null;
  const expand = () => setNotebook(true);
  const spine = h('button', { class: 'nbdock__spine', type: 'button', 'aria-label': label('notes.expand'), onclick: expand },
    h('span', { class: 'nbdock__band', 'aria-hidden': 'true' }),
    h('span', { class: 'nbdock__label', 'aria-hidden': 'true' }, tx('notes.spine')));
  const tab = h('button', { class: 'nbdock__tab', type: 'button', 'aria-label': label('notes.expand'), onclick: expand },
    h('span', { 'aria-hidden': 'true' }, '📓'), tx('notes.tab'));
  const body = h('div', { class: 'nbdock__body' });
  // "Collapse ›" goes at the start of the notebook's own bar (in place of its title: the spine
  // already says Field Notes), so the panel has a single bar.
  const collapse = h('button', { class: 'btn nbdock__collapse', type: 'button', onclick: () => setNotebook(false) }, tx('notes.collapse'));
  const panel = h('section', { class: 'nbdock__panel', 'aria-label': label('notes.spine') }, body);
  const el = h('div', { class: 'nbdock', 'data-state': 'collapsed' }, spine, panel);
  return { el, spine, tab, panel, collapse, body, book: null, expanded: false };
}

// remember: keep the choice for this explorer (on this device). layout: re-measure the card
// (it shrinks beside the panel, or grows back); the open spread keeps its scale either way.
// start: where the notebook opens ({ view, scope, pageId } from its where()), else its usual place.
function setNotebook(open, { remember = true, layout = true, start = null } = {}) {
  const d = v?.dock;
  if (!d || open === d.expanded) return;
  d.expanded = open;
  d.el.dataset.state = open ? 'expanded' : 'collapsed';
  v.el.dataset.notebook = open ? 'expanded' : 'collapsed';
  if (open) {
    d.book = notebook({ cardId: v.card.id, beside: true, lead: d.collapse, start, onFull: openFullNotes });
    mount(d.body, d.book.el);
  } else {
    d.book?.destroy();
    d.book = null;
    mount(d.body);
    v.bar.querySelector('button')?.focus?.({ preventScroll: true });
  }
  if (remember && state.profile) updateProfile(state.profile.id, { notesPanel: open ? 'expanded' : 'collapsed' }).catch(() => {});
  if (layout) { measure(); draw(); }
  haptic(8);
}

export function openNotes() { setNotebook(true); }

// What to come back to (js/card-return.js): the side showing and the notebook's place.
export function snapshot() {
  if (!v) return null;
  return {
    cardId: v.card.id, side: sideOf(v), viaMap: Boolean(v.toGlobe), viaFull: Boolean(v.toFull),
    notes: v.dock ? { expanded: v.dock.expanded, ...(v.dock.book?.where() ?? {}) } : null,
  };
}

// The card's map: the globe, at this animal's range. The router keeps snapshot() as the
// viewer closes, and Back to card (or the device's back button) comes back to it.
function openGlobe(card) {
  if (!v) return;
  haptic(8);
  v.toGlobe = true;
  location.hash = `#/globe/${encodeURIComponent(card.id)}`;
}
// The full notebook, on the panel's page and still this card's. As with the globe, Back to the
// card (or the device's back button) comes back to snapshot().
function openFullNotes() {
  if (!v) return;
  v.toFull = true;
  location.hash = `#/notes/${encodeURIComponent(v.card.id)}`;
}
export function toggleNotes(open = !v?.dock?.expanded) { setNotebook(open); }

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
  // Typing in the notebook (a text box, the page's text tool) is not for the card.
  if (e.target.closest?.('input, textarea, select, [contenteditable], .nbdock')) return;
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
