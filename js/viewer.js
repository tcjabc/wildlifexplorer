// The card viewer: a full-screen layer over the binder.
// - Opens by zooming the camera from the tapped binder tile onto the desk, the binder growing behind
//   it, with the card filling the page.
// - The card has two states: the cover, and open (js/card-open.js): a large stage and the heading
//   grid, side by side or one above the other (js/card-layout.js openLayout). Closed or open, it
//   turns over (rotateX) to its back, the Fact File for readers (js/fact-back.js), which is the
//   size of the closed card; it turns back to whichever it was.
// - Gestures are decided by direction, from anywhere on the card (or a margin around it, never
//   the screen's right edge, where the notebook spine goes): sideways opens or closes the card
//   (the cover turns around the spine like a book, rotateY); up turns it over; down on the cover
//   goes back to the binder. On the back, down turns it back and up turns it on round. A movement
//   under the slop is a tap, so the buttons on the card keep working. A quarter of the way, or a
//   flick, is enough. The ‹ › buttons change cards.
// - The first time a closed card settles, its cover peeks open a little (once per card per
//   profile), to show that it opens, and a hand shows the swipe (and, the first few times, the
//   swipe up).
// Every gesture follows the finger; on release a spring finishes or undoes it.
// - What has more than fits ([data-scroll]: a heading's text, the back) scrolls inside the card: a
//   vertical drag there scrolls, and turns the card only from the end it is scrolled to.
//
// Field Notes: the notebook is always there, collapsed (a spine at the right, or a tab on
// phones) or expanded (a panel beside the card, or over it). Beside it the open card uses the space
// that is left (js/card-layout.js).
//
// Sharpness: the card is laid out at its real on-screen size with CSS zoom (never a small
// card scaled up). While it moves it uses 3D transforms; at rest every transform comes off
// and the cover or open card is drawn flat, so text and photos stay crisp.
import { h, mount, reducedMotion } from './dom.js';
import { tx, label, getMode } from './i18n.js';
import { state, cardsIn, isVisible, groupById, speechRate, watching, updateProfile, debugOn } from './store.js';
import { dockMode, cardLayout, fitScale, openLayout, clipLeftOf } from './card-layout.js';
import { sideOf, underOf } from './card-return.js';
import { coverPage, cardCredits } from './cardparts.js';
import { openCard } from './card-open.js';
import { factBack } from './fact-back.js';
import { cardNo, groupTitle } from './components.js';
import { track, spring, tween, clamp, lerp, haptic } from './gesture.js';
import { speak, stop, isSpeaking, speechSupported } from './speech.js';
import { playCall, stopCall } from './card-call.js';
import { notebook } from './notebook.js';
import { closePopover } from './glossary.js';
import { releaseOutcome } from './gesture-release.js';

const cssNum = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
const DONE = 0.999;
const HAND_DROP = 0.2; // the hand sits this share of the card's height below its middle
const BASE_FADE = 3;   // the open card behind the turning cover is fully there this early in the turn

let v = null; // the open viewer, or null

export const isOpen = () => v !== null;
export const openCardId = () => v?.card.id ?? null;

// ---------- building the card ----------

function buildBook(card, onCredit, onMap) {
  const onCall = playCall;
  const open = openCard(card, { onCredit, onMap, onCall });
  const left = h('div', { class: 'cpage cpage--stage', 'data-group': card.group });
  const leaf = h('div', { class: 'leaf' },
    h('div', { class: 'face face--front' }, coverPage(card, { onCredit, onMap, onCall })),
    h('div', { class: 'face face--back face--y' }, left));
  const base = h('div', { class: 'base' }, h('div', { class: 'face face--front' }, open.menu));
  const root = h('div', { class: 'card3d' }, base, leaf);
  // The back: a card of its own, where the closed card is, turning in as the book turns away.
  const backRoot = h('div', { class: 'card3d card3d--back' }, h('div', { class: 'face face--front' }, factBack(card)));
  const backPos = h('div', { class: 'card-pos' }, backRoot);
  return { pos: h('div', { class: 'card-pos' }, root), root, base, leaf, left, open, backPos, backRoot };
}

// The turn-over, f: 0 the front (closed or open), 1 the back, 2 round again to the front (then 0).
// Up to half way the book shows, turning away; then the back, turning in.
const onBack = f => f >= 0.5 && f <= 1.5;

// ---------- layout and drawing ----------

// The card's space (js/card-layout.js): the stage less what the notebook takes. The closed card
// fits it (s0); the open card has a layout of its own (s1).
function measure(again = true) {
  const r = v.stage.getBoundingClientRect();
  const P = cssNum('--card-w'), H = cssNum('--card-h');
  const W = r.width, Hs = r.height;
  const share = cssNum('--nb-panel-share') || undefined;
  const mode = v.dock ? dockMode({ vw: window.innerWidth, W, Hs, P, H, share }) : 'none';
  const lay = v.dock
    ? cardLayout({ W, Hs, P, H, mode, expanded: v.dock.expanded, share })
    : { visibleW: W, s0: fitScale(W, Hs, P, H) };
  const open = openLayout({ visibleW: lay.visibleW, Hs, P, H, tap: cssNum('--tap-heading') });
  v.L = { P, H, W, Hs, s0: lay.s0, s1: open.s, open, visibleW: lay.visibleW, cx: lay.visibleW / 2, cy: Hs / 2, left: r.left, top: r.top, mode };
  // A new mode can show or hide the notebook's tab (and so change the stage's height): measure again.
  if (v.el.dataset.dock !== mode) { v.el.dataset.dock = mode; if (again) { measure(false); return; } }
  placeOpen();
  // Where the zoom starts: the tapped tile, or a small card in the middle.
  const from = v.fromEl?.isConnected ? v.fromEl.getBoundingClientRect() : null;
  v.from = from
    ? { cx: from.left + from.width / 2 - r.left, cy: from.top + from.height / 2 - r.top, k: from.width / (P * lay.s0) }
    : { cx: W / 2, cy: Hs / 2, k: 0.4 };
  v.zoomer.style.setProperty('transform-origin', `${v.L.cx}px ${v.L.cy}px`);
}

// The open card round the closed one: side by side the menu is the page under the cover, a little
// wider on short screens; stacked it reaches past the cover on every side.
function placeOpen() {
  const { open, P, H } = v.L;
  const { root, base, left } = v.built;
  const side = open.kind === 'side';
  const dx = side ? 0 : (open.w - P) / 2, dy = side ? 0 : (open.h - H) / 2;
  root.dataset.layout = open.kind;
  root.style.setProperty('--card-s', String(open.s));
  base.style.setProperty('left', `${-dx}px`);
  base.style.setProperty('right', `${side ? P - open.menuW : -dx}px`);
  base.style.setProperty('top', `${-dy}px`);
  base.style.setProperty('bottom', `${-dy}px`);
  v.built.open.place(side ? left : null);
}

const at = (x, a) => Math.abs(x - a) < 1e-4;

// At rest: nothing moving, fully zoomed in, the card fully closed or open, and on one side.
function atRest() {
  return !v.cancel && !v.zoomCancel && !v.dragging && at(v.z, 1) && (at(v.p, 0) || at(v.p, 1))
    && (at(v.f, 0) || at(v.f, 1));
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

  // Card pose: the closed card is centred in its space. Side by side the two pages are centred
  // (the card's own left edge is the spine); stacked the card stays where it is.
  const closedX = L.cx - (L.P * s) / 2;
  const openX = L.open.kind === 'side' ? L.cx - (L.open.w * s) / 2 + L.P * s : closedX;
  const x0 = lerp(closedX, openX, p);
  const y0 = L.cy - (L.H * s) / 2;
  const pos = v.built.pos;
  v.stage.classList.toggle('is-3d', !rest);
  v.built.root.classList.toggle('is-rest', rest);
  if (rest) {
    v.built.root.dataset.pose = p > 0.5 ? 'open' : 'front';
    if (v.built.root.dataset.pose === 'front' && at(z, 1)) requestAnimationFrame(peek);
    pos.style.setProperty('left', `${Math.round(x0)}px`);
    pos.style.setProperty('top', `${Math.round(y0)}px`);
    pos.style.removeProperty('transform');
    v.built.leaf.style.removeProperty('transform');
    v.built.base.style.removeProperty('opacity');
  } else {
    pos.style.setProperty('left', '0px');
    pos.style.setProperty('top', '0px');
    pos.style.setProperty('transform', `translate(${x0}px, ${y0}px) scale(${s / v.zoom})`);
    // Springs overshoot a little; the rotation is clamped so the cover never dips behind the
    // page it covers (the position still gets the bounce).
    v.built.leaf.style.setProperty('transform', `translateZ(1px) rotateY(${-180 * clamp(p)}deg)`);
    // Stacked, the open card is bigger than the cover: it fades in round it.
    if (L.open.kind === 'stacked') v.built.base.style.setProperty('opacity', String(clamp(p * BASE_FADE)));
  }
  drawTurn(rest);

  // Zoom from the tile: starts scaled down to the tile and grows to its real size (FLIP).
  const q = 1 - z;
  if (reduced) v.zoomer.style.setProperty('opacity', String(z));
  else if (at(z, 1)) v.zoomer.style.removeProperty('transform');
  else v.zoomer.style.setProperty('transform', `translate(${(from.cx - L.cx) * q}px, ${(from.cy - L.cy) * q}px) scale(${lerp(1, from.k, q)})`);

  updateHand(rest);
  if (rest) drawZones();
}

// The turn-over: the book (closed or open) turns away about its middle, then the back turns in.
// The back is laid out at the closed card's scale with CSS zoom, so at rest it is flat and sharp.
// The side turned away is see-through and can't be touched or reached (inert).
function drawTurn(rest) {
  const { L, f } = v;
  const { pos, root, backPos, backRoot } = v.built;
  backRoot.style.setProperty('zoom', String(L.s0));
  backPos.style.setProperty('left', `${Math.round(L.cx - (L.P * L.s0) / 2)}px`);
  backPos.style.setProperty('top', `${Math.round(L.cy - (L.H * L.s0) / 2)}px`);
  const back = onBack(f);
  if (rest || at(f, 0) || at(f, 1)) {
    root.style.removeProperty('transform');
    backRoot.style.removeProperty('transform');
  } else {
    root.style.setProperty('transform', `rotateX(${180 * (f > 1.5 ? f - 2 : Math.min(f, 0.5))}deg)`);
    backRoot.style.setProperty('transform', `rotateX(${180 * (clamp(f, 0.5, 1.5) - 1)}deg)`);
  }
  const shown = (el, on) => { el.style.setProperty('opacity', on ? '1' : '0'); el.inert = !on; };
  shown(pos, !back);
  shown(backPos, back);
  v.stage.dataset.face = back ? 'back' : 'front';
}

// How to open the card: a hand showing the swipe, for children who can't read a hint. It sits on
// the closed card at rest and goes as soon as anything moves.
function updateHand(rest) {
  const covered = v.dock?.expanded && v.L.mode !== 'side';
  const show = rest && at(v.p, 0) && at(v.f, 0) && !covered;
  v.hand.hidden = !show;
  if (!show) return;
  v.hand.style.setProperty('left', `${Math.round(v.L.cx)}px`);
  v.hand.style.setProperty('top', `${Math.round(v.L.cy + v.L.H * v.L.s0 * HAND_DROP)}px`);
}

// ---------- motion ----------

// Page turns have one animation slot; the zoom in/out has its own, so tapping open (or starting a
// drag) while the card is still zooming in doesn't freeze the zoom.
function stopMotion() {
  v?.cancel?.(); v?.glide?.();
  if (v) { v.cancel = null; v.glide = null; }
}

function stopZoom() { v?.zoomCancel?.(); if (v) v.zoomCancel = null; }

// Spring p, f or z to a target, then run `after`.
function settle(prop, target, velocity = 0, after) {
  const zoom = prop === 'z';
  if (zoom) stopZoom(); else stopMotion();
  let finished = false; // with reduced motion a spring is over before it returns
  const cancel = spring({
    from: v[prop], to: target, velocity,
    onUpdate: x => { v[prop] = x; draw(); },
    onDone: () => {
      finished = true;
      if (zoom) v.zoomCancel = null; else { v.cancel = null; v.motion = null; }
      arrived(prop, target, after, { replay: true });
    },
  });
  if (finished) return;
  if (zoom) v.zoomCancel = cancel; else { v.cancel = cancel; v.motion = { prop, target, after }; }
}

// A spring has got there (or was sent there at once: finishMotion).
function arrived(prop, target, after, { replay }) {
  if (prop === 'f' && target === 2) v.f = 0; // turned on round: the front again
  draw();
  // The comparison animation plays as the card finishes opening (not when a turn of the device
  // finishes it early).
  if (replay && prop === 'p' && target === 1) v.built.open.replay();
  // Shut, the card has nothing more to say.
  if (prop === 'p' && target === 0) { stop(); stopCall(); }
  after?.();
}

// The screen changed size (the device turned, a browser bar came or went) while something moved:
// everything jumps to where it was going, so nothing carries on from the old size's numbers. A
// drag is let go where it started; the peek shuts; closing finishes closing.
function finishMotion() {
  if (v.closing) { v.finishClose?.(); return; }
  v.abortDrag?.();
  if (v.peeking) { v.peeking = false; stopMotion(); v.p = 0; }
  const m = v.cancel ? v.motion : null;
  stopMotion();
  v.motion = null;
  if (m) { v[m.prop] = m.target; arrived(m.prop, m.target, m.after, { replay: false }); }
  if (v.zoomCancel) { stopZoom(); v.z = 1; }
}

// Lay the card out again for the stage's new size, at most once a frame, with no animation.
function relayout() {
  if (!v || v.layoutFrame) return;
  v.layoutFrame = requestAnimationFrame(() => {
    if (!v) return;
    v.layoutFrame = 0;
    const r = v.stage.getBoundingClientRect();
    const same = v.L && r.width === v.L.W && r.height === v.L.Hs && r.left === v.L.left && r.top === v.L.top;
    if (same) return;
    finishMotion();
    if (!v) return; // it was closing: now it's closed
    measure();
    draw();
  });
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
  if (reducedMotion() || peekedCards().has(v.card.id)) return;
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

// The swipe up: the first few times a profile opens a card, the hand shows it once, after its first
// sideways swipe (kept on this device only).
const UP_HINTS = 3;
const upKey = () => `we-up-hint-${state.profile?.id ?? 'none'}`;
function takeUpHint() {
  try {
    const n = Number(localStorage.getItem(upKey())) || 0;
    if (n >= UP_HINTS) return false;
    localStorage.setItem(upKey(), String(n + 1));
    return true;
  } catch { return false; }
}
function wireHand(hand, icon) {
  icon.addEventListener('animationiteration', () => {
    if (!v?.upHint) return;
    v.upHint = false;
    hand.dataset.move = 'up';
    hand.setAttribute('aria-label', label('card.hintFlip'));
  });
  icon.addEventListener('animationend', () => {
    delete hand.dataset.move;
    hand.setAttribute('aria-label', label('card.hintBook'));
  });
}

export function toggleOpen() {
  if (!v || v.f > 0.01) return;
  haptic(10);
  settle('p', v.p > 0.5 ? 0 : 1);
}

// 🔄 and the arrow keys: over to the back, and back again (up goes on round, down turns back).
export function toggleFlip(way = 'up') {
  if (!v) return;
  if (interruptPeek()) { v.p = 0; draw(); } // a cover left ajar by the peek shuts first
  haptic(10);
  closePopover();
  if (!onBack(v.f)) settle('f', 1);
  else settle('f', way === 'down' ? 0 : 2);
}

// ---------- gestures ----------

// Gesture tuning, for young kids who aren't precise.
const SLOP = 11;          // px before a movement is a drag (less is a tap)
const SIDEWAYS = Math.tan(30 * Math.PI / 180); // within 30° of horizontal counts as sideways
const MARGIN = 40;        // px around the card that also start a gesture
const OPEN_REACH = 0.5;   // the open zone reaches this share of a card's width to its right
const CLOSE_MARGIN = 80;  // px around the open card that also start closing it

// Where a gesture may start, in screen pixels:
//   card – the card itself (both sides when open)
//   near – a margin around it (wider around the open card, for closing)
//   open – the space right of the closed card: opening only
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
  const back = onBack(v.f);
  const r = (back ? v.built.backRoot : v.built.root).getBoundingClientRect();
  const s = v.stage.getBoundingClientRect();
  const isOpen = v.p > 0.5 && !back;
  const nbLeft = notebookLeft(s);
  const fit = b => clipLeftOf({ left: Math.max(b.left, s.left), right: Math.min(b.right, s.right), top: Math.max(b.top, s.top), bottom: Math.min(b.bottom, s.bottom) }, nbLeft);
  const b = v.built.base.getBoundingClientRect();
  const stacked = v.L.open.kind === 'stacked';
  const card = fit(!isOpen ? r : { left: stacked ? b.left : r.left - r.width, right: b.right, top: b.top, bottom: b.bottom });
  const m = isOpen ? CLOSE_MARGIN : MARGIN;
  const near = fit({ left: card.left - m, right: card.right + m, top: card.top - m, bottom: card.bottom + m });
  const closed = v.p < PEEK + 0.01 && !back;
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

// A touch stops whatever was moving, to take hold of it. When it turns out to move nothing (a tap,
// a scroll), the card was left where it stopped, maybe part-way or in a spring's overshoot, and
// would never come to rest: it springs on to the nearer end. A scroll keeps gliding.
function toEnds() {
  if (!v || v.cancel || v.closing || v.dragging) return;
  const glide = v.glide;
  v.glide = null;
  if (!at(v.p, 0) && !at(v.p, 1)) settle('p', v.p > 0.5 ? 1 : 0);
  else if (!at(v.f, 0) && !at(v.f, 1)) settle('f', Math.round(clamp(v.f, 0, 2)));
  v.glide = glide;
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
  // A finger's pixels in the scrolled page's pixels: the back has the closed card's scale.
  const scale = () => (onBack(v.f) ? v.L.s0 : v.zoom);
  // The device turned mid-drag: let go, back where the drag started. The rest of this touch does
  // nothing (no mode), and its release finds the card already there.
  v.abortDrag = () => {
    if (!mode) return;
    mode = null;
    v.dragging = false;
    if (base) { v.p = base.p; v.f = base.f; v.z = 1; }
  };

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
    tap: () => toEnds(), // e.g. tapped during the peek, or while the card was still settling
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
      const back = at(v.f, 1), front = at(v.f, 0);
      const closed = v.p < PEEK + 0.01 && front;
      if (sideways) {
        if (closed) mode = 'open';
        else if (v.p > DONE && front) mode = 'close';
      } else if (back) {
        // The back: its text scrolls; from the top, down turns it back; from the end, up turns it on.
        if (!atEdge(scroller, dy)) mode = 'scroll';
        else mode = dy > 0 ? 'unflip' : 'over';
      } else if (closed) {
        if (dy < 0) mode = 'flip';
        else if (dy > 0) { mode = 'dismiss'; stopZoom(); }
      } else if (v.p > DONE && front) {
        // The open card: its text scrolls; up from the end of it (or off it) turns the card over.
        if (!atEdge(scroller, dy)) mode = 'scroll';
        else if (dy < 0) mode = 'flip';
      }
      if (zone === 'open' && mode !== 'open') mode = null;
      // Anything but opening closes a cover left ajar by the peek.
      if (mode !== 'open' && v.p > 0 && v.p <= PEEK + 0.01) { v.p = 0; draw(); }
      if (!mode) return false;
      if (mode === 'flip' || mode === 'unflip' || mode === 'over') closePopover();
      dir = Math.sign(sideways ? dx : dy) || 1;
      base = { p: v.p, f: v.f, z: v.z, top: scroller?.scrollTop ?? 0 };
      v.dragging = true;
      return true;
    },
    move: ({ dx, dy }) => {
      const T = travel();
      // How far towards the goal, whichever way the drag went.
      const qx = (dx * dir) / T.x;
      if (mode === 'open') v.p = clamp(base.p + qx);
      if (mode === 'close') v.p = 1 - clamp(qx);
      if (mode === 'flip') v.f = clamp(-dy / T.y);
      if (mode === 'unflip') v.f = 1 - clamp(dy / T.y);
      if (mode === 'over') v.f = 1 + clamp(-dy / T.y);
      if (mode === 'dismiss') v.z = 1 - clamp(dy / (v.L.Hs * 0.6));
      // The card is enlarged with CSS zoom, so a finger's pixels are fewer card pixels.
      if (mode === 'scroll') { scroller.scrollTop = base.top - dy / scale(); return; }
      draw();
    },
    end: info => {
      // Whatever happens, the gesture ends settled: committed, sprung back or dismissed.
      const m = mode;
      mode = null;
      v.dragging = false;
      try { release(m, info); } catch (err) { springBack(); throw err; }
      toEnds();
    },
    // No pointerup (capture lost, window lost focus, a second finger): spring back.
    cancel: () => { mode = null; v.dragging = false; springBack(); toEnds(); },
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
    draw();
  }

  // Apply what the release decided (js/gesture-release.js).
  function release(mode, info) {
    const o = releaseOutcome(mode, { p: v.p, f: v.f, dir, travel: travel(), stageH: v.L.Hs }, info);
    if (o.dismiss) { haptic(8); dismiss(); return; }
    if (o.springBack) { springBack(); return; }
    if (o.scroll) {
      // A flick keeps gliding a little.
      const el = scroller, from = el.scrollTop, to = from - (o.velocity / scale()) * 0.3;
      if (Math.abs(o.velocity) > 200) v.glide = tween({ from, to, duration: 500, onUpdate: x => { el.scrollTop = x; } });
      return;
    }
    if (o.prop !== 'z' && o.target !== base[o.prop]) haptic(12);
    settle(o.prop, o.target, o.velocity);
  }
}

// ---------- the card's name, credits, chrome ----------

function readButton() {
  if (!speechSupported) return null;
  const icon = h('span', { 'aria-hidden': 'true' }, '🔊');
  const btn = h('button', { class: 'btn btn--icon btn--read', type: 'button', 'aria-label': label('card.readAloud') }, icon);
  const idle = () => { btn.classList.remove('is-speaking'); icon.textContent = '🔊'; };
  btn.addEventListener('click', () => {
    if (btn.classList.contains('is-speaking') && isSpeaking()) { stop(); return; }
    btn.classList.add('is-speaking');
    icon.textContent = '⏹';
    speak([v.card.name], { mode: getMode(), rate: speechRate(), onend: idle }); // the only thing on a card that speaks
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
    h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('card.open'), onclick: toggleOpen }, '📖'),
    h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('card.turnOver'), onclick: () => toggleFlip() }, '🔄'),
    nav(siblings[i - 1], 'card.prev', '‹'),
    nav(siblings[i + 1], 'card.next', '›'));
}

function setCard(card) {
  closePopover();
  stopCall();
  v.built?.open.destroy();
  v.card = card;
  v.built = buildBook(card, openCredits, openGlobe);
  mount(v.zoomer, v.built.pos, v.built.backPos);
  v.zoom = 0;
  const bar = buildBar(card);
  v.bar.replaceWith(bar);
  v.bar = bar;
  v.chrome = [v.bar, v.hintRow, v.dock?.el].filter(Boolean);
  v.p = 0; v.f = 0; v.peeked = false;
}

// ---------- open / switch / close ----------

// fromEl: the binder tile to zoom out of. onDismiss: called when the child closes the
// card themselves (swipe down or ←), so the app can update the address.
// restore: what js/card-return.js kept when this card was left for the globe or the full
// notebook (its side, its heading and the notebook), to come back to exactly that.
export function open(card, { fromEl, main, onDismiss, restore = null } = {}) {
  if (v) teardown();
  const scrim = h('div', { class: 'viewer__scrim' });
  const zoomer = h('div', { class: 'viewer__zoomer' });
  const handIcon = h('span', { class: 'viewer__hand-icon', 'aria-hidden': 'true' }, '👆');
  const hand = h('div', { class: 'viewer__hand', role: 'img', 'aria-label': label('card.hintBook'), hidden: true }, handIcon);
  wireHand(hand, handIcon);
  const stage = h('div', { class: 'viewer__stage' }, zoomer, hand);
  const bar = h('div');
  const sheet = h('dialog', { class: 'sheet' });
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
  // The notebook beside the stage (not in it, so the card's gestures never see it).
  const dock = buildDock();
  const body = h('div', { class: 'viewer__body' }, stage, dock?.el);
  const hintRow = h('div', { class: 'viewer__hintrow' }, dock?.tab);
  const pane = h('div', { class: 'viewer__pane' }, bar, body, hintRow);
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'data-notebook': 'collapsed' }, scrim, pane, sheet);
  // The page itself never scrolls; pages inside the card that scroll do.
  el.addEventListener('wheel', e => { if (!e.target.closest?.('[data-scroll]')) e.preventDefault(); }, { passive: false });
  // A mouse pressed on a picture would start the browser's own image drag, which cancels the
  // pointer (pointercancel) before a page turn can start. Pictures in the viewer never drag.
  el.addEventListener('dragstart', e => e.preventDefault());
  document.body.append(el);

  v = { el, pane, scrim, zoomer, stage, hand, hintRow, bar, sheet, dock, main, fromEl, onDismiss, p: 0, f: 0, z: 0, cancel: null };
  v.upHint = !reducedMotion() && takeUpHint();
  setCard(card);
  // Collapsed or expanded, as this explorer left it last time (kept on this device), or as it
  // was when the card was left for the globe or the full notebook (and on that page).
  const notes = restore?.notes;
  if (dock && (notes ? notes.expanded : state.profile?.notesPanel === 'expanded')) setNotebook(true, { remember: false, layout: false, start: notes });
  if (restore?.side === 'inside' || restore?.under === 'inside') v.p = 1;
  if (restore?.side === 'back') v.f = 1;
  if (restore?.heading) v.built.open.select(restore.heading, { quiet: true });
  if (main && fromEl) {
    const m = main.getBoundingClientRect(), r = fromEl.getBoundingClientRect();
    main.style.setProperty('transform-origin', `${r.left + r.width / 2 - m.left}px ${r.top + r.height / 2 - m.top}px`);
  }
  measure();
  draw();
  wireGestures();
  // Every change of size: the desk itself (a ResizeObserver, which also sees the notebook and the
  // hint row come and go), the window, and the visual viewport (phones' browser bars).
  v.onResize = relayout;
  window.addEventListener('resize', v.onResize);
  window.visualViewport?.addEventListener('resize', v.onResize);
  v.watch = typeof ResizeObserver === 'function' ? new ResizeObserver(relayout) : null;
  v.watch?.observe(v.stage);

  let zoomed = false; // with reduced motion it is over before it returns
  const cancel = tween({ from: 0, to: 1, duration: 520, onUpdate: z => { v.z = z; draw(); }, onDone: () => { zoomed = true; v.zoomCancel = null; draw(); } });
  if (!zoomed) v.zoomCancel = cancel;
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
  v.built.open.destroy();
  stopMotion();
  stopZoom();
  stop();
  stopCall();
  window.removeEventListener('resize', v.onResize);
  window.visualViewport?.removeEventListener('resize', v.onResize);
  v.watch?.disconnect();
  if (v.layoutFrame) cancelAnimationFrame(v.layoutFrame);
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
// (it shrinks beside the panel, or grows back).
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

// What to come back to (js/card-return.js): the side showing, its heading and the notebook's place.
export function snapshot() {
  if (!v) return null;
  return {
    cardId: v.card.id, side: sideOf(v), under: underOf(v), heading: v.built.open.selected(), viaMap: Boolean(v.toGlobe), viaFull: Boolean(v.toFull),
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
    // A turn of the device while it closes: closed at once (finishMotion).
    v.finishClose = () => { stopZoom(); teardown(); resolve(); };
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
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    // Not while a page inside the card has the keys to scroll with.
    if (e.target.closest?.('[data-scroll]')) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' || onBack(v.f)) toggleFlip(e.key === 'ArrowUp' ? 'up' : 'down');
  } else if (e.key === ' ' || e.key === 'Enter') {
    if (e.target.closest?.('button, a')) return;
    e.preventDefault();
    toggleOpen();
  }
}
