// The numbers behind the notebook's view, plain in and out (tests/notes-view.test.mjs): which
// pages lie open, how big they are, where zoom and pan may go, and what a gesture means.
// A view is { k, x, y }: zoom (1 = the page fitted) and where the book's top left is in the
// frame, in CSS px. None of it is saved: pages keep their fixed size and vector items.

export const MAX_ZOOM = 4;
export const MAX_DPR = 1.5;  // sharper costs the baseline tablet more than it shows
const SNAP_ZOOM = 1.06;      // ending this close to the fitted page: back to it

// A second finger this soon after the first means two fingers were meant; later, it is a brush
// of the hand, and the line being drawn carries on.
const SECOND_FINGER_MS = 200;

// One press that stayed put.
const TAP_PX = 10;
const TAP_MS = 350;

// A two-finger page turn: clearly sideways, far enough, and with the fingers keeping their
// distance all the way, so a pinch can never turn the page. Their distance may change by 5%, or
// by 12 px when that is more: fingers close together wander by more than 5% of the gap.
const TURN_MIN_PX = 80;
const TURN_MAX_SCALE = 0.05;
const TURN_MAX_DRIFT_PX = 12;
const TURN_SIDEWAYS = 2.5; // sideways travel at least this many times the up-and-down travel

export const pixelRatio = dpr => Math.min(MAX_DPR, dpr || 1);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// The pages lying open with `pos` among them: pairs in list order in a spread (1–2, 3–4, …),
// otherwise that page alone. A slot past the end of the list is null (a blank page).
//   { start, at, slots }: the list index of the first slot, and the slot `pos` is in.
export function slotsFor(ids, pos, spread) {
  const p = clamp(pos, 0, Math.max(0, ids.length - 1));
  const start = spread ? p - (p % 2) : p;
  const slots = (spread ? [start, start + 1] : [start]).map(i => ids[i] ?? null);
  return { start, at: p - start, slots };
}

// CSS px per page unit for the fitted page: the whole page (or spread) in the frame, or just its
// width when the page may run taller than the frame (beside a card).
export function fitScale({ w, h, pages = 1, pad = 0, pageW, pageH, byWidth = false }) {
  const across = (w - pad * 2) / (pageW * pages);
  return byWidth ? across : Math.min(across, (h - pad * 2) / pageH);
}

// A book smaller than the frame sits in the middle; a bigger one can't leave a gap at an edge
// (past `pad`).
export function clampView({ k, x, y }, frame, book, pad = 0) {
  const axis = (v, f, b) => (b <= f - pad * 2 ? (f - b) / 2 : clamp(v, f - b - pad, pad));
  return { k, x: axis(x, frame.w, book.w * k), y: axis(y, frame.h, book.h * k) };
}

// Two fingers from `from` (their midpoint, in the frame) to `to`, `ratio` times as far apart:
// what was under the midpoint stays under it.
export function pinchView(start, from, to, ratio, frame, book, pad = 0) {
  const k = clamp(start.k * ratio, 1, MAX_ZOOM), s = k / start.k;
  return clampView({ k, x: to.x - (from.x - start.x) * s, y: to.y - (from.y - start.y) * s }, frame, book, pad);
}

export function settleView(view, frame, book, pad = 0) {
  return view.k < SNAP_ZOOM ? clampView({ ...view, k: 1 }, frame, book, pad) : view;
}

// What a finished two-finger gesture turns the page by: 1, -1, or 0 for no turn.
//   dx, dy: how far the fingers' midpoint moved. span: their distance at the start, in px.
//   peak: the largest change in that distance at any moment, as a fraction of it. zoom: the
//   view's zoom when the gesture began.
export function swipeTurn({ dx, dy, span = Infinity, peak, zoom }) {
  if (zoom > 1 || peak >= Math.max(TURN_MAX_SCALE, TURN_MAX_DRIFT_PX / span)) return 0;
  if (Math.abs(dx) < TURN_MIN_PX || Math.abs(dx) < Math.abs(dy) * TURN_SIDEWAYS) return 0;
  return dx < 0 ? 1 : -1;
}

export const secondFingerCounts = age => age < SECOND_FINGER_MS;
export const isTap = (travel, ms) => travel < TAP_PX && ms < TAP_MS;

// How the rails are laid out, by orientation alone: side rails in landscape, bands above and
// below the page in portrait. Where the screen is short (or narrow) for that, they fold into two
// columns (or two rows).
const RAIL_MIN = 640;
export const railFit = ({ w, h }) => (w > h ? (h < RAIL_MIN ? 'short' : 'tall') : (w < RAIL_MIN ? 'narrow' : 'wide'));

// Where a popover opens beside its button, inside the frame. side: the way it opens ('right',
// 'left', 'below', 'above'). Everything in CSS px from the frame's top left.
export function popPlace({ anchor, frame, w, h, side }) {
  const left = side === 'right' ? anchor.right : side === 'left' ? anchor.left - w : anchor.left;
  const top = side === 'below' ? anchor.bottom : side === 'above' ? anchor.top - h : anchor.top;
  return { left: clamp(left, 0, Math.max(0, frame.w - w)), top: clamp(top, 0, Math.max(0, frame.h - h)) };
}

// How far to lift the page so a text box clears the keyboard: its bottom just above what is still
// visible, but never so far that its top goes out of sight. box: where it is with no lift.
//   viewTop, viewBottom: the visual viewport's edges, in the same px.
export function keyboardLift({ box, viewTop, viewBottom, margin = 16 }) {
  const need = box.bottom + margin - viewBottom;
  if (need <= 0) return 0;
  return Math.max(0, Math.min(need, box.top - viewTop - margin));
}
