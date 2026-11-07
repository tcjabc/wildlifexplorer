// What a card gesture does when the finger lifts: commit, spring back, dismiss, or keep a
// scroll gliding. Plain numbers in, a decision out, so it can be tested without a page
// (tests/gesture-release.test.mjs). viewer.js applies the decision.
//
// mode: 'open' | 'close' | 'dismiss' | 'scroll' | anything else
// s:    { p, dir, travel: { x }, stageH } – where the card is now, which way the gesture went (±1),
//       finger travel for a full turn, stage height
// info: { dy, vx, vy } – total vertical movement and release speed in px/s
// Returns one of:
//   { prop: 'p' | 'z', target: 0 | 1, velocity }         spring the page turn / zoom there
//   { dismiss: true }                                    zoom back into the binder
//   { scroll: true, velocity }                           let the scroll glide (velocity px/s)
//   { springBack: true }                                 back to where the gesture started

export const COMMIT = 0.25;        // a quarter of the way is enough
export const FLICK = 1.1;          // turns per second: a quick flick towards the goal is enough too
export const DISMISS_SHARE = 0.18; // of the stage height dragged down: back to the binder
export const DISMISS_FLICK = 700;  // px/s down: back to the binder (up: springs back)

const num = (x, fallback = 0) => (Number.isFinite(x) ? x : fallback);

export function releaseOutcome(mode, s, info = {}) {
  const dir = num(s?.dir, 1) || 1;
  const tx = num(s?.travel?.x, 1) || 1;
  const p = num(s?.p);
  const dy = num(info.dy), vx = num(info.vx), vy = num(info.vy);
  // Commit past a quarter, or on a flick towards the goal; a flick away springs back.
  const decide = (q, speed) => (speed > FLICK ? true : speed < -FLICK ? false : q > COMMIT);

  if (mode === 'open' || mode === 'close') {
    const q = mode === 'open' ? p : 1 - p;
    const speed = (vx * dir) / tx;
    const target = decide(q, speed) === (mode === 'open') ? 1 : 0;
    return { prop: 'p', target, velocity: mode === 'open' ? speed : -speed };
  }
  if (mode === 'dismiss') {
    const h = num(s?.stageH, 1) || 1;
    const commit = vy < -DISMISS_FLICK ? false : vy > DISMISS_FLICK || dy > h * DISMISS_SHARE;
    return commit ? { dismiss: true } : { prop: 'z', target: 1, velocity: -vy / (h * 0.6) };
  }
  if (mode === 'scroll') return { scroll: true, velocity: vy };
  return { springBack: true };
}
