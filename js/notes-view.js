// The numbers behind the notebook's view, plain in and out (tests/notes-view.test.mjs): which
// page lies where, how big it is, where zoom and pan may go, and what a gesture means.
// A view is { k, x, y }: zoom (1 = the page fitted) and where the page's top left is in the
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

// A two-finger page turn: clearly in one direction, far enough, and with the fingers keeping their
// distance all the way, so a pinch can never turn the page. Their distance may change by 5%, or
// by 12 px when that is more: fingers close together wander by more than 5% of the gap.
const TURN_MIN_PX = 80;
const TURN_MAX_SCALE = 0.05;
const TURN_MAX_DRIFT_PX = 12;
const TURN_STRAIGHT = 2.5; // travel along the turn at least this many times the travel across it

// Beside a card, fingers this many times further apart than they started open the full notebook.
const FULL_RATIO = 1.3;

// A list of this many pages or more shows the whole stack.
const FULL_STACK = 12;

// CSS px beside the page for a tab with a label on it.
const TAB_FULL = 84;
const TAB_NARROW = 60;
const EDGE_GAP = 4; // the book never quite touches the side of the screen

export const pixelRatio = dpr => Math.min(MAX_DPR, dpr || 1);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// CSS px per page unit for the fitted page beside a card: the whole page in the frame, or just its
// width when the page may run taller than the frame.
export function fitScale({ w, h, pad = 0, pageW, pageH, byWidth = false }) {
  const across = (w - pad * 2) / pageW;
  return byWidth ? across : Math.min(across, (h - pad * 2) / pageH);
}

// Where the page lies on the desk: as big as it can be inside the desk's margins, which the cover,
// the spiral and the page edges all stay within, so none of them costs the page anything.
//   w, h: the desk. top, bottom, side: its margins. right: room wanted to its right, for the tabs:
//   the page moves left for it, as far as its margin allows, with a gap for the book's edge.
//   keep: room that must be left there, even if the page has to be a little smaller for it.
export function bookBox({ w, h, top, bottom, side, pageW, pageH, right = 0, keep = 0 }) {
  const k = Math.min((w - side * 2) / pageW, (w - side - EDGE_GAP - keep) / pageW, (h - top - bottom) / pageH);
  const width = Math.max(10, Math.floor(pageW * k)), height = Math.max(10, Math.floor(pageH * k));
  const centred = (w - width) / 2;
  const left = Math.max(Math.min(side + EDGE_GAP, centred), Math.min(centred, w - width - Math.max(right, keep)));
  return { width, height, left: Math.round(left), top: Math.round(top + (h - top - bottom - height) / 2) };
}

// How the index tabs fit beside the page, by the room there is. full: a label across on a wide tab.
// narrow: the same on a narrower one, in shorter lines. stub: no room for words: a colour and an
// initial, a finger wide over the page.
export const tabFit = room => (room >= TAB_FULL ? 'full' : room >= TAB_NARROW ? 'narrow' : 'stub');

// The tabs that fit: the first (the contents) always, the ones nearest the place, and "more".
//   entries: all of them. at: the index of the place. capacity: how many fit.
export function tabsShown(entries, at, capacity) {
  if (entries.length <= capacity) return entries;
  const room = Math.max(1, capacity - 2), rest = entries.slice(1);
  const from = clamp(clamp(at - 1, 0, rest.length - 1) - Math.floor(room / 2), 0, rest.length - room);
  return [entries[0], ...rest.slice(from, from + room), { id: 'more' }];
}

// Rows on pages. A heading never ends a page. first: how many fit on the first page, under its title.
export function paginate(rows, { perPage, first = perPage }) {
  const pages = [[]];
  let room = first;
  for (const row of rows) {
    if (room < 1 || (row.head && room < 2)) { pages.push([]); room = perPage; }
    pages[pages.length - 1].push(row);
    room--;
  }
  return pages;
}

// Where the tool in hand can lie on the desk beside the roll, at a slight angle, measured: { x, y, turn }
// (its middle, in the screen's px; turn in radians from standing tip up), or null where nothing has the
// room for it, and it stays in the roll.
//   w, h: the screen. roll, book: { left, top, right, bottom }. len, wide: the tool. near: the height
//   it would rather lie at.
export function deskSpot({ w, h, roll, book, len, wide, near = h / 2, gap = 8, tilt = 0.14 }) {
  const long = len * Math.cos(tilt) + wide * Math.sin(tilt), short = len * Math.sin(tilt) + wide * Math.cos(tilt);
  const beside = { left: roll.right + gap, right: book.left - gap, top: gap, bottom: h - gap };
  if (beside.right - beside.left >= short && beside.bottom - beside.top >= long) {
    return { x: (beside.left + beside.right) / 2, y: clamp(near, beside.top + long / 2, beside.bottom - long / 2), turn: tilt };
  }
  const under = { left: roll.right + gap, right: w - gap, top: book.bottom + gap, bottom: h - gap };
  if (under.right - under.left >= long && under.bottom - under.top >= short) {
    return { x: (under.left + under.right) / 2, y: (under.top + under.bottom) / 2, turn: Math.PI / 2 - tilt };
  }
  return null;
}

// How much of the stack lies above the spiral (pages turned) and below the page (pages to come), each
// out of 1. A long list fills the stack; a short one is a thin book.
export function stackDepth(pos, n) {
  if (n < 2) return { before: 0, after: 0 };
  const full = Math.min(1, n / FULL_STACK);
  return { before: (full * pos) / (n - 1), after: (full * (n - 1 - pos)) / (n - 1) };
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
//   view's zoom when the gesture began. axis: 'y' in the book (pages flip up: a swipe up is the next
//   page), 'x' in the panel beside a card, where two fingers going up and down pan the page.
export function swipeTurn({ dx, dy, span = Infinity, peak, zoom, axis = 'y' }) {
  if (zoom > 1 || peak >= Math.max(TURN_MAX_SCALE, TURN_MAX_DRIFT_PX / span)) return 0;
  const along = axis === 'y' ? dy : dx, across = axis === 'y' ? dx : dy;
  if (Math.abs(along) < TURN_MIN_PX || Math.abs(along) < Math.abs(across) * TURN_STRAIGHT) return 0;
  return along < 0 ? 1 : -1;
}

// Whether a view at zoom k counts as the fitted page.
export const atFit = k => k < SNAP_ZOOM;
// A pinch outward from the fitted page, far enough. Zoomed in already, a pinch only zooms.
export const pinchOpensFull = (zoom, ratio) => atFit(zoom) && ratio >= FULL_RATIO;

// Where a page lands in the full notebook, near enough for the panel to grow towards it.
//   w, h: the screen. roll, tray: their widths beside the desk, or in portrait their heights.
//   top, bottom, side: the desk's margins.
export function fullPageBox({ w, h, roll, tray, ...rest }) {
  const land = w > h;
  const b = bookBox({ ...rest, w: land ? w - roll - tray : w, h: land ? h : h - roll - tray });
  return { ...b, left: b.left + (land ? roll : 0), top: b.top + (land ? 0 : tray) };
}

export const secondFingerCounts = age => age < SECOND_FINGER_MS;
export const isTap = (travel, ms) => travel < TAP_PX && ms < TAP_MS;

// How the roll and the tray are laid out, by orientation alone: beside the book in landscape, the
// tray above it and the roll below in portrait. Where the screen is short (or narrow) for that, they
// fold into two columns (or two rows).
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
