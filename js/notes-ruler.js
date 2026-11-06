// The ruler's geometry, plain in and out (tests/notes-ruler.test.mjs). It lies on the open book
// and is not part of any page: { x, y, r } is its centre and turn, in page units across the book
// (the right page of a spread starts at PAGE_W). Nothing here is saved.
export const RULER_L = 900;
export const RULER_H = 96;
const SNAP = 30; // this close to an edge (outside it), a line starting there follows it

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// A point in the ruler's own axes: along it, and across it from its middle.
function local({ x, y, r }, px, py) {
  const c = Math.cos(r), s = Math.sin(r), dx = px - x, dy = py - y;
  return { along: dx * c + dy * s, across: -dx * s + dy * c };
}

export const onRuler = (ruler, px, py, pad = 0) => {
  const { along, across } = local(ruler, px, py);
  return Math.abs(along) <= RULER_L / 2 + pad && Math.abs(across) <= RULER_H / 2 + pad;
};

// Which long edge a line starting here follows: 1, -1, or 0 for none. Beside an edge counts, and
// with inside (a pen, which never moves the ruler) on it too: then the nearer edge.
export function edgeAt(ruler, px, py, { inside = false } = {}) {
  const { along, across } = local(ruler, px, py);
  if (Math.abs(along) > RULER_L / 2 + SNAP) return 0;
  const gap = Math.abs(across) - RULER_H / 2;
  if (gap > SNAP || (gap < 0 && !inside)) return 0;
  return across < 0 ? -1 : 1;
}

// The point on that edge nearest (px, py), no further than the ruler's ends.
export function snapTo(ruler, edge, px, py) {
  const along = clamp(local(ruler, px, py).along, -RULER_L / 2, RULER_L / 2);
  const across = edge * (RULER_H / 2);
  const c = Math.cos(ruler.r), s = Math.sin(ruler.r);
  return [ruler.x + along * c - across * s, ruler.y + along * s + across * c];
}

// Its middle stays on the book, so it can always be reached.
export const clampRuler = (ruler, w, h) => ({ ...ruler, x: clamp(ruler.x, 0, w), y: clamp(ruler.y, 0, h) });
