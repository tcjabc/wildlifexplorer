// The Habitat stage: a picture of the animal's real home, from its own "stage": { "habitat": {
// image, credit, find } } in data/animals.json. find, when the animal is in the picture: { x, y, r },
// its middle as fractions of the picture's width and height, and how far round it a tap still finds
// it, as a fraction of the picture's shorter side. Plain data and sums, so it can be tested without a
// page (tests/habitat.test.mjs); the view itself is in js/stage-views.js.

import { stagePicture } from './stage-pictures.js';

const frac = v => typeof v === 'number' && v >= 0 && v <= 1;

// The card's habitat picture, with its find.
export function habitatOf(card) {
  const hab = card?.stage?.habitat;
  const pic = stagePicture(hab);
  if (!pic) return null;
  const f = hab.find;
  const find = f && frac(f.x) && frac(f.y) && typeof f.r === 'number' && f.r > 0 && f.r <= 1 ? { x: f.x, y: f.y, r: f.r } : null;
  return { ...pic, find };
}

// Where a picture of nw × nh lands in a box of w × h with object-fit: cover and object-position at
// (px, py), fractions: its drawn size and its top-left corner, in box px.
export function coverBox(nw, nh, w, h, px = 0.5, py = 0.5) {
  const s = Math.max(w / nw, h / nh);
  const dw = nw * s, dh = nh * s;
  return { w: dw, h: dh, left: (w - dw) * px, top: (h - dh) * py };
}

// The find on the box: its middle and radius in box px.
export function findOnBox(find, box) {
  return { x: box.left + find.x * box.w, y: box.top + find.y * box.h, r: find.r * Math.min(box.w, box.h) };
}

// Is a tap at (x, y), in box px, on the animal?
export function isFound(find, box, x, y) {
  const c = findOnBox(find, box);
  return (x - c.x) ** 2 + (y - c.y) ** 2 <= c.r ** 2;
}
