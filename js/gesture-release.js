// What a card gesture does when the finger lifts: commit, spring back, dismiss, or keep a
// scroll gliding. Plain numbers in, a decision out, so it can be tested without a page
// (tests/gesture-release.test.mjs). viewer.js applies the decision.
//
// mode: 'open' | 'close' | 'flip' | 'unflip' | 'dismiss' | 'scroll' | anything else
// s:    { p, f, base: { p, f }, dir, travel: { x, y }, stageH } – where the card is now, where the
//       gesture started, which way it went (±1), finger travel for a full turn, stage height
// info: { dy, vx, vy } – total vertical movement and release speed in px/s
// Returns one of:
//   { prop: 'p' | 'f' | 'z', target: 0 | 1, velocity }  spring the page turn / flip / zoom there
//   { dismiss: true }                                    zoom back into the binder
//   { scroll: true, velocity }                           let the scroll glide (velocity px/s)
//   { pan, velocity }                                    spring the open spread's left edge there
//   (a { prop: 'p' } result may also carry pan: where the spread goes if it stays open)
//   { springBack: true }                                 back to where the gesture started

export const COMMIT = 0.25;        // a quarter of the way is enough
export const FLICK = 1.1;          // turns per second: a quick flick towards the goal is enough too
export const DISMISS_SHARE = 0.18; // of the stage height dragged down: back to the binder
export const DISMISS_FLICK = 700;  // px/s down: back to the binder (up: springs back)

const num = (x, fallback = 0) => (Number.isFinite(x) ? x : fallback);

export function releaseOutcome(mode, s, info = {}) {
  const dir = num(s?.dir, 1) || 1;
  const tx = num(s?.travel?.x, 1) || 1, ty = num(s?.travel?.y, 1) || 1;
  const p = num(s?.p), f = num(s?.f);
  const dy = num(info.dy), vx = num(info.vx), vy = num(info.vy);
  // Commit past a quarter, or on a flick towards the goal; a flick away springs back.
  const decide = (q, speed) => (speed > FLICK ? true : speed < -FLICK ? false : q > COMMIT);

  if (mode === 'open' || mode === 'close') {
    const q = mode === 'open' ? p : 1 - p;
    const speed = (vx * dir) / tx;
    const target = decide(q, speed) === (mode === 'open') ? 1 : 0;
    return { prop: 'p', target, velocity: mode === 'open' ? speed : -speed };
  }
  if (mode === 'flip' || mode === 'unflip') {
    const q = mode === 'flip' ? f : 1 - f;
    const speed = mode === 'flip' ? -vy / ty : (vy * dir) / ty;
    const target = decide(q, speed) === (mode === 'flip') ? 1 : 0;
    return { prop: 'f', target, velocity: mode === 'flip' ? speed : -speed };
  }
  if (mode === 'dismiss') {
    const h = num(s?.stageH, 1) || 1;
    const commit = vy < -DISMISS_FLICK ? false : vy > DISMISS_FLICK || dy > h * DISMISS_SHARE;
    return commit ? { dismiss: true } : { prop: 'z', target: 1, velocity: -vy / (h * 0.6) };
  }
  if (mode === 'pan') {
    // Panning an open spread that doesn't fit (js/card-layout.js panDrag). Dragged on past the
    // left edge, it was closing (p below 1): commit or spring back like a close. Otherwise the
    // spread springs to the nearest place inside its edges.
    const min = num(s?.range?.min), max = num(s?.range?.max);
    const lo = Math.min(min, max), hi = Math.max(min, max);
    const closing = 1 - p;
    if (closing > 0) {
      const speed = vx / tx; // dragging right is towards closing
      return decide(closing, speed)
        ? { prop: 'p', target: 0, velocity: -speed }
        : { prop: 'p', target: 1, velocity: -speed, pan: hi };
    }
    return { pan: Math.min(hi, Math.max(lo, num(s?.panLeft, hi))), velocity: vx };
  }
  if (mode === 'scroll') return { scroll: true, velocity: vy };
  return { springBack: true };
}
