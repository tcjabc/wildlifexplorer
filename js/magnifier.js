// The Profile page's magnifier. The photo stays clean; picking a feature draws a ring
// beside it, a thin line, and a round lens in the emptiest corner showing that feature
// enlarged, cut from the full-resolution image. All positions are percentages of the
// photo, so it works at any card size.
//
// Feature data (card.profile.callouts): x, y = where the feature is (fractions 0–1 or
// percent 0–100 of the photo's width/height), r = how much to show in the lens (radius as
// a fraction of the photo's width, default 0.08).
import { h, svg, reducedMotion } from './dom.js';

const LENS = 0.4;     // lens diameter, as a share of the photo's width
const MARGIN = 0.03;  // gap between the lens and the photo's edge
const RING = 1.25;    // the ring sits just outside the feature, not on it
const DEFAULT_R = 0.08;

const frac = v => (v > 1 ? v / 100 : v);
export const featureOf = c => ({ x: frac(c.x), y: frac(c.y), r: c.r ? frac(c.r) : DEFAULT_R });

function play(el, frames, opts) {
  if (reducedMotion() || !el.animate) return;
  el.animate(frames, { fill: 'backwards', easing: 'cubic-bezier(.2,.8,.2,1)', ...opts });
}

// pic: the photo's container (position: relative). file: the full-size image.
export function magnifier(pic, file, callouts) {
  const features = callouts.map(featureOf);
  let ratio = 0.66; // photo height / width; updated once the photo has loaded
  const photo = pic.querySelector('img');
  const setRatio = () => { if (photo?.naturalWidth) ratio = photo.naturalHeight / photo.naturalWidth; };
  setRatio();
  photo?.addEventListener('load', setRatio);

  const layer = h('div', { class: 'loupe', 'aria-hidden': 'true' });
  pic.append(layer);
  let current = null;

  // Distances in photo-width units (y scaled by the photo's shape).
  const dist = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * ratio);

  // The corner farthest from this feature (and not crowding the other features).
  function corner(f) {
    const half = LENS / 2;
    const cx = [MARGIN + half, 1 - MARGIN - half];
    const cyUnits = [MARGIN + half, ratio - MARGIN - half]; // in width units
    let best = null;
    for (const x of cx) for (const yu of cyUnits) {
      const c = { x, y: yu / ratio };
      const others = features.filter(o => o !== f);
      const crowd = others.length ? Math.min(...others.map(o => dist(o, c))) : 1;
      const score = dist(f, c) + 0.5 * crowd;
      if (!best || score > best.score) best = { ...c, score };
    }
    return best;
  }

  function close() {
    current = null;
    layer.replaceChildren();
    layer.classList.remove('is-on');
  }

  function show(i) {
    if (i === null || i === current) { close(); return; }
    current = i;
    const f = features[i];
    const lens = corner(f);
    const pctX = v => `${v * 100}%`;
    const pctY = v => `${v * 100}%`;               // fraction of the photo's height
    const ringR = f.r * RING;                       // in width units

    // Ring beside the feature.
    const ring = h('span', {
      class: 'loupe__ring',
      style: { left: pctX(f.x - ringR), top: pctY(f.y - ringR / ratio), width: pctX(ringR * 2) },
    });

    // Line from the ring's edge to the lens's edge.
    const dx = lens.x - f.x, dy = (lens.y - f.y) * ratio;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const a = { x: f.x + ux * ringR, y: f.y + (uy * ringR) / ratio };
    const b = { x: lens.x - ux * (LENS / 2), y: lens.y - (uy * (LENS / 2)) / ratio };
    const line = svg('line', {
      x1: a.x * 100, y1: a.y * 100, x2: b.x * 100, y2: b.y * 100,
      pathLength: 1, 'vector-effect': 'non-scaling-stroke',
    });
    const wire = svg('svg', { class: 'loupe__wire', viewBox: '0 0 100 100', preserveAspectRatio: 'none' }, line);

    // The lens: the full-size image, enlarged so the feature's circle fills it.
    const scale = 1 / (2 * f.r);                    // image width in lens widths
    const inner = h('img', {
      class: 'loupe__img', src: file, alt: '', decoding: 'async',
      style: {
        width: `${scale * 100}%`,
        left: `${(0.5 - f.x * scale) * 100}%`,
        top: `${(0.5 - f.y * scale * ratio) * 100}%`,
      },
    });
    const glass = h('span', {
      class: 'loupe__lens',
      // Placed by its corner, so at rest it has no transform (stays sharp).
      style: { left: pctX(lens.x - LENS / 2), top: pctY(lens.y - LENS / 2 / ratio), width: pctX(LENS) },
    }, inner);

    layer.replaceChildren(wire, ring, glass);
    layer.classList.add('is-on');

    // Ring fades in, the line draws, the lens grows out of the ring.
    play(ring, [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 200 });
    play(line, [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 220, delay: 140, easing: 'ease-out' });
    const fromX = (f.x - lens.x) * 100 / LENS, fromY = ((f.y - lens.y) * ratio) * 100 / LENS;
    play(glass, [
      { transform: `translate(${fromX}%, ${fromY}%) scale(${(ringR * 2) / LENS})`, opacity: 0.3 },
      { transform: 'none', opacity: 1 },
    ], { duration: 320, delay: 300 });
  }

  return { show, close, current: () => current, count: features.length };
}
