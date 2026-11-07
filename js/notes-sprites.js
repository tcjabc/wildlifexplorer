// Small pictures the page is stamped with: a silhouette in one ink, one footprint, at a size near
// what the canvas needs. Drawing a page is then one drawImage per print. Making each anew (an SVG
// drawn again, a canvas every time) cost the tablet more than everything else on a full page.
// The oldest go first when they pass BUDGET: a page only ever uses a few.

const BUDGET = 6e6;   // canvas px kept, about 24 MB
const MIN_PX = 32;
const MAX_PX = 512;   // as big as a stamp gets at the closest zoom, near enough
const STRETCH = 1.2;  // a picture may be shown this much bigger than it is, unnoticed

const sprites = new Map(); // in order of use, the oldest first
let used = 0;

// The size to make one that is shown at px: a power of two, so a stamp at any size shares
// a picture. Many inks and sizes at once must still fit in BUDGET, or every one is made anew.
export function sizeFor(px) {
  let s = MIN_PX;
  while (s * STRETCH < px && s < MAX_PX) s *= 2;
  return s;
}

// Canvas px per page unit on this context.
export function pxPerUnit(ctx) {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b);
}

// paint(context, w, h) draws it, the first time.
export function sprite(key, w, h, paint) {
  const hit = sprites.get(key);
  if (hit) {
    sprites.delete(key);
    sprites.set(key, hit);
    return hit;
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d'), w, h);
  sprites.set(key, c);
  used += w * h;
  for (const [k, old] of sprites) {
    if (used <= BUDGET || old === c) break;
    sprites.delete(k);
    used -= old.width * old.height;
  }
  return c;
}
