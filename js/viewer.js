// The card viewer: a full-screen layer over the binder.
// - Opens by zooming the camera from the tapped binder tile onto the desk, the binder growing behind
//   it, straight to the card's final size: it never changes size after that.
// - The card has two faces of the same size: the front, to explore (js/card-open.js: the stage and
//   the heading grid), and the back, to read (js/fact-back.js: the Fact File). Where there is room
//   for two pages (js/card-layout.js openLayout) they lie side by side, both always there, and a
//   heading tapped on the front also brings its section into view on the back. Where there isn't,
//   the card is one page that turns over (rotateX): a swipe up or down, or 🔄, to the back with that
//   heading's section in view.
// - Gestures are decided by direction, from anywhere on the card (or a margin around it, never the
//   screen's right edge, where the notebook spine goes): sideways changes card (as ‹ › do), up or
//   down turns it over (one page only). A movement under the slop is a tap, so the buttons on the
//   card keep working. A quarter of the way, or a flick, is enough. Every gesture follows the
//   finger; on release a spring finishes or undoes it.
// - What has more than fits ([data-scroll]: the back, a stage view's list) scrolls inside the card: a
//   vertical drag there scrolls, and turns the card only from the end it is scrolled to.
// - As a card opens on one page, a small hand shows the swipe up, until the explorer has turned a
//   card over once (at most once a session before that).
//
// Field Notes: the notebook is always there, collapsed (a spine at the right, or a tab on
// phones) or expanded (a panel beside the card, or over it). Beside it the card uses the space
// that is left (js/card-layout.js).
//
// Sharpness: the card is laid out at its real on-screen size with CSS zoom (never a small
// card scaled up). While it moves it uses 3D transforms; at rest every transform comes off
// and it is drawn flat, so text and photos stay crisp.
import { h, mount, reducedMotion } from './dom.js';
import { tx, label, getMode } from './i18n.js';
import { state, cardsIn, isVisible, groupById, speechRate, watching, updateProfile, debugOn } from './store.js';
import { dockMode, cardLayout, openLayout, clipLeftOf } from './card-layout.js';
import { onBack, sideOf } from './card-return.js';
import { cardCredits } from './cardparts.js';
import { openCard } from './card-open.js';
import { factBack, showSection } from './fact-back.js';
import { cardNo, groupTitle } from './components.js';
import { track, spring, tween, clamp, lerp, haptic } from './gesture.js';
import { speak, stop, isSpeaking, speechSupported } from './speech.js';
import { playCall, stopCall } from './card-call.js';
import { notebook } from './notebook.js';
import { closePopover } from './glossary.js';
import { releaseOutcome } from './gesture-release.js';

const cssNum = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

let v = null; // the open viewer, or null

export const isOpen = () => v !== null;
export const openCardId = () => v?.card.id ?? null;

// ---------- building the card ----------

function buildCard(card) {
  const onMap = openGlobe;
  const front = openCard(card, { onCredit: openCredits, onMap, onCall: playCall, onHeading });
  const back = factBack(card, { onMap });
  const root = h('div', { class: 'card3d card3d--front' }, h('div', { class: 'face' }, front.el));
  const backRoot = h('div', { class: 'card3d card3d--back' }, h('div', { class: 'face' }, back));
  return { pos: h('div', { class: 'card-pos' }, root), root, front, back, backPos: h('div', { class: 'card-pos' }, backRoot), backRoot };
}

// The turn-over, f, in half turns: 0 the front, 1 the back; up adds one, down takes one away, and
// the card is called 0 or 1 again once it gets there. Each face's angle, from flat:
const frontAngle = f => 180 * (f - 2 * Math.round(f / 2));
const backAngle = f => 180 * ((f - 1) - 2 * Math.round((f - 1) / 2));
const settledSide = f => ((Math.round(f) % 2) + 2) % 2;

const twoPages = () => v.L.open.kind === 'side';

// ---------- layout and drawing ----------

// The card's space (js/card-layout.js): the stage less what the notebook takes. The card has one
// scale and one size per layout; front and back are pages of the same size, side by side or in the
// same place. front, back: where each page is, in stage px.
function measure(again = true) {
  const r = v.stage.getBoundingClientRect();
  const P = cssNum('--card-w'), H = cssNum('--card-h');
  const W = r.width, Hs = r.height;
  const share = cssNum('--nb-panel-share') || undefined;
  const mode = v.dock ? dockMode({ vw: window.innerWidth, W, Hs, P, H, share }) : 'none';
  const lay = v.dock ? cardLayout({ W, Hs, P, H, mode, expanded: v.dock.expanded, share }) : { visibleW: W };
  const open = openLayout({ visibleW: lay.visibleW, Hs, P, H, tap: cssNum('--tap-heading') });
  const s = open.s, cx = lay.visibleW / 2, cy = Hs / 2;
  const front = { x: Math.round(cx - (open.w * s) / 2), y: Math.round(cy - (open.h * s) / 2), w: open.pageW * s, h: open.h * s };
  const back = open.kind === 'side' ? { ...front, x: Math.round(front.x + open.pageW * s) } : front;
  v.L = { P, H, W, Hs, s, open, front, back, visibleW: lay.visibleW, cx, cy, left: r.left, top: r.top, mode };
  // A new mode can show or hide the notebook's tab (and so change the stage's height): measure again.
  if (v.el.dataset.dock !== mode) { v.el.dataset.dock = mode; if (again) { measure(false); return; } }
  place();
  // Where the zoom starts: the tapped tile, or a small card in the middle. The tile grows into the
  // front page, at its final size and place; the back (beside it, or behind it) comes with it.
  const from = v.fromEl?.isConnected ? v.fromEl.getBoundingClientRect() : null;
  v.from = from
    ? { cx: from.left + from.width / 2 - r.left, cy: from.top + from.height / 2 - r.top, k: from.width / front.w }
    : { cx: W / 2, cy: Hs / 2, k: 0.4 };
  v.zoomer.style.setProperty('transform-origin', `${front.x + front.w / 2}px ${front.y + front.h / 2}px`);
}

// Both pages the same size, in card px; the bar's 🔄 only where the card turns over.
function place() {
  const { open, s } = v.L;
  const { root, backRoot } = v.built;
  v.stage.dataset.layout = open.kind;
  for (const el of [root, backRoot]) {
    el.style.setProperty('--card-s', String(s));
    el.style.setProperty('zoom', String(s));
    el.style.setProperty('width', `${open.pageW}px`);
    el.style.setProperty('height', `${open.h}px`);
  }
  v.bar.querySelector('.viewer__flip')?.classList.toggle('is-hidden', open.kind === 'side');
  v.built.front.layout();
}

const at = (x, a) => Math.abs(x - a) < 1e-4;

// At rest: nothing moving, fully zoomed in, on one side, not pulled sideways.
function atRest() {
  return !v.cancel && !v.zoomCancel && !v.dragging && at(v.z, 1) && at(v.f, Math.round(v.f)) && at(v.x, 0);
}

function draw() {
  const { L, f, z, x, from } = v;
  const reduced = reducedMotion();
  const rest = atRest();

  // Binder behind: grows faster than the card (parallax), unless motion is reduced.
  const bg = 1 - (1 - z) ** 2;
  if (!reduced) v.main?.style.setProperty('transform', `scale(${1 + cssNum('--zoom-bg-scale') * bg})`);
  v.scrim.style.setProperty('opacity', String(bg));
  v.chrome.forEach(el => el.style.setProperty('opacity', String(clamp((z - 0.6) / 0.4))));

  v.stage.classList.toggle('is-3d', !rest);
  const { pos, backPos } = v.built;
  const two = twoPages();
  const pose = (el, box, angle) => {
    if (rest) {
      el.style.setProperty('left', `${box.x}px`);
      el.style.setProperty('top', `${box.y}px`);
      el.style.removeProperty('transform');
    } else {
      el.style.setProperty('left', '0px');
      el.style.setProperty('top', '0px');
      // Pulled sideways by a swipe to change card.
      el.style.setProperty('transform', `translate(${box.x + x}px, ${box.y}px)`);
    }
    // Turned about its middle (one page).
    if (rest || at(angle, 0)) el.firstChild.style.removeProperty('transform');
    else el.firstChild.style.setProperty('transform', `rotateX(${angle}deg)`);
  };
  pose(pos, L.front, two ? 0 : frontAngle(f));
  pose(backPos, L.back, two ? 0 : backAngle(f));
  // One page: the side turned away is see-through and can't be touched or reached (inert).
  const back = !two && onBack(f);
  const shown = (el, on) => { el.style.setProperty('opacity', on ? '1' : '0'); el.inert = !on; };
  shown(pos, two || !back);
  shown(backPos, two || back);
  v.stage.dataset.face = two ? 'both' : back ? 'back' : 'front';

  // Zoom from the tile: starts scaled down to the tile and grows to its real size (FLIP).
  const q = 1 - z;
  if (reduced) v.zoomer.style.setProperty('opacity', String(z));
  else if (at(z, 1)) v.zoomer.style.removeProperty('transform');
  else v.zoomer.style.setProperty('transform', `translate(${(from.cx - L.front.x - L.front.w / 2) * q}px, ${(from.cy - L.front.y - L.front.h / 2) * q}px) scale(${lerp(1, from.k, q)})`);

  updateHand(rest);
  if (rest) drawZones();
}

// How to turn the card over: a small hand showing the swipe up, for children who can't read a hint.
// Only as a card opens (once it has zoomed in), on one page, and at most once a session, until this
// explorer has turned a card over once: then never again (js below: the swipe-up hint). It sits in
// the stage's bottom corner, away from the credit button, never takes a tap (pointer-events: none),
// plays its swipe a couple of times and is gone; anything moving, or a heading tapped, ends it at
// once and it doesn't come back. Side by side there is nothing to find: both faces are there.
// v.upHint: 'waiting' (for the card to settle), 'showing', or false.
function updateHand(rest) {
  if (rest && settledSide(v.f) === 1) noteFlipped();
  if (v.upHint === 'showing' && !rest) v.upHint = false;
  if (v.upHint === 'waiting' && rest) {
    const covered = v.dock?.expanded && v.L.mode !== 'side';
    const ok = !twoPages() && settledSide(v.f) === 0 && !covered && v.built.front.el.querySelector('.front__stage');
    v.upHint = ok ? 'showing' : false;
    if (ok) noteHintShown();
  }
  const show = v.upHint === 'showing';
  v.hand.hidden = !show;
  if (!show) return;
  const stage = v.built.front.el.querySelector('.front__stage');
  const r = stage.getBoundingClientRect(), size = cssNum('--hand-size'), travel = cssNum('--hand-travel');
  const gap = cssNum('--s-3');
  v.hand.style.setProperty('left', `${Math.round(r.right - v.L.left - gap - size / 2)}px`);
  v.hand.style.setProperty('top', `${Math.round(r.bottom - v.L.top - gap - size / 2 - travel)}px`);
  v.hand.style.setProperty('--hand-y', `${travel}px`);
}

function endHand() {
  if (!v || !v.upHint) return;
  v.upHint = false;
  v.hand.hidden = true;
}

// ---------- motion ----------

// The turn-over and the swipe have one animation slot; the zoom in/out has its own, so turning the
// card (or starting a drag) while it is still zooming in doesn't freeze the zoom.
function stopMotion() {
  v?.cancel?.(); v?.glide?.();
  if (v) { v.cancel = null; v.glide = null; }
}

function stopZoom() { v?.zoomCancel?.(); if (v) v.zoomCancel = null; }

// Spring f, x or z to a target, then run `after`.
function settle(prop, target, velocity = 0, after) {
  const zoom = prop === 'z';
  if (zoom) stopZoom(); else stopMotion();
  let finished = false; // with reduced motion a spring is over before it returns
  const cancel = spring({
    from: v[prop], to: target, velocity,
    onUpdate: n => { v[prop] = n; draw(); },
    onDone: () => {
      finished = true;
      if (zoom) v.zoomCancel = null; else { v.cancel = null; v.motion = null; }
      arrived(prop, target, after);
    },
  });
  if (finished) return;
  if (zoom) v.zoomCancel = cancel; else { v.cancel = cancel; v.motion = { prop, target, after }; }
}

// A spring has got there (or was sent there at once: finishMotion).
function arrived(prop, target, after) {
  if (prop === 'f') v.f = settledSide(target); // over the other way, or on round: 0 or 1 again
  draw();
  after?.();
}

// The screen changed size (the device turned, a browser bar came or went) while something moved:
// everything jumps to where it was going, so nothing carries on from the old size's numbers. A
// drag is let go where it started; closing finishes closing.
function finishMotion() {
  if (v.closing) { v.finishClose?.(); return; }
  v.abortDrag?.();
  const m = v.cancel ? v.motion : null;
  stopMotion();
  v.motion = null;
  if (m) { v[m.prop] = m.target; arrived(m.prop, m.target, m.after); }
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

// ---------- the swipe-up hint ----------

// Per explorer, on this device only: once they have turned a card over (localStorage) the hand never
// shows again; until then at most once a session (sessionStorage). No storage, no hand.
const flippedKey = () => `we-flipped-${state.profile?.id ?? 'none'}`;
const shownKey = () => `we-up-hint-shown-${state.profile?.id ?? 'none'}`;
function canUpHint() {
  try { return !localStorage.getItem(flippedKey()) && !sessionStorage.getItem(shownKey()); } catch { return false; }
}
function noteHintShown() {
  try { sessionStorage.setItem(shownKey(), '1'); } catch { /* no storage */ }
}
function noteFlipped() {
  if (v.flipped) return;
  v.flipped = true;
  try { localStorage.setItem(flippedKey(), '1'); } catch { /* no storage */ }
}

// ---------- turning over, and the headings ----------

// 🔄, the arrow keys, Space and Enter: over to the other side (one page only). Up goes over the top,
// down the other way.
export function toggleFlip(way = 'up') {
  if (!v || twoPages()) return;
  haptic(10);
  closePopover();
  v.upHint = false;
  const base = Math.round(v.f);
  settle('f', base + (way === 'down' ? -1 : 1));
}

// A heading tapped on the front (js/card-open.js): its section comes into view on the back (side by
// side it glides there; on one page it is ready for when the card turns over). The lit one tapped
// again goes back to the gallery, and the back to no section.
function onHeading(id, { again }) {
  endHand();
  if (v) showSection(v.built.back, again ? null : id, { smooth: twoPages() });
}

// ---------- gestures ----------

// Gesture tuning, for young kids who aren't precise.
const SLOP = 11;          // px before a movement is a drag (less is a tap)
const SIDEWAYS = Math.tan(30 * Math.PI / 180); // within 30° of horizontal counts as sideways
const MARGIN = 40;        // px around the card that also start a gesture
const EDGE_PULL = 0.3;    // sideways with no card that way: the card follows the finger this much

// Where a gesture may start, in screen pixels:
//   card – the card itself (both pages side by side)
//   near – a margin around it
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
  const { front, back } = v.L;
  const s = v.stage.getBoundingClientRect();
  const nbLeft = notebookLeft(s);
  const fit = b => clipLeftOf({ left: Math.max(b.left, s.left), right: Math.min(b.right, s.right), top: Math.max(b.top, s.top), bottom: Math.min(b.bottom, s.bottom) }, nbLeft);
  const card = fit({ left: s.left + front.x, right: s.left + back.x + back.w, top: s.top + front.y, bottom: s.top + front.y + front.h });
  const near = fit({ left: card.left - MARGIN, right: card.right + MARGIN, top: card.top - MARGIN, bottom: card.bottom + MARGIN });
  // The notebook's own area, for the debug overlay.
  const d = v.dock;
  const nbEl = !d ? null : d.expanded ? d.panel : v.L.mode === 'phone' ? d.tab : d.spine;
  const nbRect = nbEl?.getBoundingClientRect();
  const notebookBox = nbRect && nbRect.width ? { left: nbRect.left, right: nbRect.right, top: nbRect.top, bottom: nbRect.bottom } : null;
  return { card, near, notebook: notebookBox, stage: s };
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
  mount(v.zones, box('near', z.near), box('card', z.card), box('notebook', z.notebook));
}

// The cards either side, in the binder's order.
function siblings() {
  const list = cardsIn(v.card.group).filter(isVisible);
  const i = list.indexOf(v.card);
  return { prev: list[i - 1] ?? null, next: list[i + 1] ?? null };
}
const goTo = card => { if (card) location.hash = `#/card/${encodeURIComponent(card.id)}`; };

// A touch stops whatever was moving, to take hold of it. When it turns out to move nothing (a tap,
// a scroll), the card was left where it stopped, maybe part-way or in a spring's overshoot, and
// would never come to rest: it springs on to the nearer end. A scroll keeps gliding.
function toEnds() {
  if (!v || v.cancel || v.closing || v.dragging) return;
  const glide = v.glide;
  v.glide = null;
  if (!at(v.x, 0)) settle('x', 0);
  else if (!at(v.f, Math.round(v.f))) settle('f', Math.round(v.f));
  v.glide = glide;
}

function wireGestures() {
  let mode = null, base = null, scroller = null;
  const where = (x, y) => {
    const z = gestureZones();
    return inBox(z.card, x, y) ? 'card' : inBox(z.near, x, y) ? 'near' : null;
  };
  const atEdge = (el, dy) => !el || el.scrollHeight <= el.clientHeight + 1
    || (dy > 0 ? el.scrollTop <= 0 : el.scrollTop + el.clientHeight >= el.scrollHeight - 1);
  // Finger travel for a whole turn (most of a 4:5 page's height) or a change of card (its width).
  const travel = () => ({ x: v.L.front.w, y: Math.min(v.L.front.h, (v.L.front.w * v.L.H) / v.L.P) * 0.7 });
  // The card is enlarged with CSS zoom, so a finger's pixels are fewer card pixels.
  const scale = () => v.L.s;
  // The device turned mid-drag: let go, back where the drag started. The rest of this touch does
  // nothing (no mode), and its release finds the card already there.
  v.abortDrag = () => {
    if (!mode) return;
    mode = null;
    v.dragging = false;
    if (base) { v.f = base.f; v.x = 0; }
  };

  v.untrack = track(v.stage, {
    start: ({ x, y, target }) => {
      if (v.closing || target.closest?.('[data-swipe], .gloss-pop')) return false;
      if (!where(x, y)) return false;
      stopMotion();
      scroller = target.closest?.('[data-scroll]') ?? null;
      return true;
    },
    tap: () => toEnds(), // e.g. tapped while the card was still settling
    lock: ({ dx, dy }) => {
      mode = null;
      const ax = Math.abs(dx), ay = Math.abs(dy);
      // Within 30° of horizontal is sideways, within 30° of vertical is vertical. In between
      // (a hand that wobbles at the start of a drag), wait for a little more movement, then go
      // by the stronger direction.
      const clear = ay <= ax * SIDEWAYS || ax <= ay * SIDEWAYS;
      if (!clear && Math.hypot(dx, dy) < SLOP * 2) return null;
      const sideways = clear ? ay <= ax * SIDEWAYS : ax >= ay;
      if (sideways) mode = 'swap';
      else if (!atEdge(scroller, dy)) mode = 'scroll';
      else if (!twoPages()) mode = 'turn';
      if (!mode) return false;
      if (mode === 'turn') { closePopover(); v.upHint = false; }
      base = { f: Math.round(v.f), top: scroller?.scrollTop ?? 0, ...siblings() };
      v.dragging = true;
      return true;
    },
    move: ({ dx, dy }) => {
      const T = travel();
      if (mode === 'swap') {
        // Towards a card that isn't there, the card only gives a little.
        const there = dx < 0 ? base.next : base.prev;
        v.x = there ? dx : dx * EDGE_PULL;
      }
      if (mode === 'turn') v.f = clamp(base.f - dy / T.y, base.f - 1, base.f + 1);
      if (mode === 'scroll') { scroller.scrollTop = base.top - dy / scale(); return; }
      draw();
    },
    end: info => {
      // Whatever happens, the gesture ends settled: committed or sprung back.
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
    if (!at(v.x, 0)) settle('x', 0);
    else if (!at(v.f, base.f)) settle('f', base.f);
    draw();
  }

  // Apply what the release decided (js/gesture-release.js).
  function release(mode, info) {
    const o = releaseOutcome(mode, { f: v.f, base: base?.f, dx: v.x, travel: travel() }, info);
    if (o.swap) {
      const to = o.swap > 0 ? base.next : base.prev;
      if (!to) { springBack(); return; }
      haptic(12);
      goTo(to);
      return;
    }
    if (o.springBack) { springBack(); return; }
    if (o.scroll) {
      // A flick keeps gliding a little.
      const el = scroller, from = el.scrollTop, to = from - (o.velocity / scale()) * 0.3;
      if (Math.abs(o.velocity) > 200) v.glide = tween({ from, to, duration: 500, onUpdate: n => { el.scrollTop = n; } });
      return;
    }
    if (o.target !== base.f) haptic(12);
    settle(o.prop, o.target, o.velocity);
  }
}

// ---------- the bar, the card's name read aloud, credits ----------

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
  const { prev, next } = siblings();
  const nav = (target, key, glyph) => h('button', {
    class: ['btn btn--icon', !target && 'is-hidden'], type: 'button', 'aria-label': label(key),
    onclick: () => goTo(target),
  }, glyph);
  return h('div', { class: 'viewer__bar', 'data-group': card.group },
    h('button', { class: 'btn btn--icon', type: 'button', 'aria-label': label('card.back'), onclick: () => dismiss() }, '←'),
    h('span', { class: 'viewer__group' }, groupTitle(g)),
    h('span', { class: 'viewer__no' }, cardNo(card.number)),
    h('span', { class: 'spacer' }),
    readButton(),
    h('button', { class: 'btn btn--icon viewer__flip', type: 'button', 'aria-label': label('card.turnOver'), onclick: () => toggleFlip() }, '🔄'),
    nav(prev, 'card.prev', '‹'),
    nav(next, 'card.next', '›'));
}

function setCard(card) {
  closePopover();
  stopCall();
  v.built?.front.destroy();
  v.card = card;
  v.built = buildCard(card);
  mount(v.zoomer, v.built.pos, v.built.backPos);
  const bar = buildBar(card);
  v.bar.replaceWith(bar);
  v.bar = bar;
  v.chrome = [v.bar, v.hintRow, v.dock?.el].filter(Boolean);
  v.f = 0; v.x = 0;
}

// ---------- open / switch / close ----------

// fromEl: the binder tile to zoom out of. onDismiss: called when the child closes the
// card themselves (←, Escape), so the app can update the address.
// restore: what js/card-return.js kept when this card was left for the globe or the full
// notebook (its side, its heading and the notebook), to come back to exactly that.
export function open(card, { fromEl, main, onDismiss, restore = null } = {}) {
  if (v) teardown();
  const scrim = h('div', { class: 'viewer__scrim' });
  const zoomer = h('div', { class: 'viewer__zoomer' });
  const handIcon = h('span', { class: 'viewer__hand-icon', 'aria-hidden': 'true' }, '👆');
  const hand = h('div', { class: 'viewer__hand', role: 'img', 'aria-label': label('card.hintFlip'), hidden: true }, handIcon);
  // It plays its swipe --hand-plays times, then it is over.
  handIcon.addEventListener('animationend', () => endHand());
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
  // pointer (pointercancel) before a swipe can start. Pictures in the viewer never drag.
  el.addEventListener('dragstart', e => e.preventDefault());
  document.body.append(el);

  v = { el, pane, scrim, zoomer, stage, hand, hintRow, bar, sheet, dock, main, fromEl, onDismiss, f: 0, x: 0, z: 0, cancel: null };
  setCard(card);
  v.upHint = !reducedMotion() && canUpHint() ? 'waiting' : false;
  // Collapsed or expanded, as this explorer left it last time (kept on this device), or as it
  // was when the card was left for the globe or the full notebook (and on that page).
  const notes = restore?.notes;
  if (dock && (notes ? notes.expanded : state.profile?.notesPanel === 'expanded')) setNotebook(true, { remember: false, layout: false, start: notes });
  if (restore?.side === 'back') v.f = 1;
  if (restore?.heading) { v.built.front.select(restore.heading, { quiet: true }); showSection(v.built.back, restore.heading, { smooth: false }); }
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

// Show another card in the open viewer (‹ ›, a swipe sideways), with a quick cross-fade.
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
  if (!reducedMotion()) [v.built.root, v.built.backRoot].forEach(el => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' }));
}

function teardown() {
  if (!v) return;
  closePopover();
  v.untrack?.(); // also removes its window listeners
  v.dock?.book?.destroy();
  v.built.front.destroy();
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
    cardId: v.card.id, side: sideOf(v), heading: v.built.front.selected(), viaMap: Boolean(v.toGlobe), viaFull: Boolean(v.toFull),
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
  v.x = 0;
  v.f = settledSide(v.f);
  measure();
  const start = { f: v.f, z: v.z };
  return new Promise(resolve => {
    // A turn of the device while it closes: closed at once (finishMotion).
    v.finishClose = () => { stopZoom(); teardown(); resolve(); };
    v.zoomCancel = tween({
      from: 0, to: 1, duration: 420,
      // On one page, the front is what goes back into the tile.
      onUpdate: u => { v.f = start.f * (1 - u); v.z = start.z * (1 - u); draw(); },
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
    const { prev, next } = siblings();
    goTo(e.key === 'ArrowLeft' ? prev : next);
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    // Not while a page inside the card has the keys to scroll with.
    if (e.target.closest?.('[data-scroll]') || twoPages()) return;
    e.preventDefault();
    toggleFlip(e.key === 'ArrowUp' ? 'up' : 'down');
  } else if (e.key === ' ' || e.key === 'Enter') {
    if (e.target.closest?.('button, a') || twoPages()) return;
    e.preventDefault();
    toggleFlip();
  }
}
