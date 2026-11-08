// What a card gesture does when the finger lifts: commit, spring back, or keep a scroll gliding.
// Plain numbers in, a decision out, so it can be tested without a page
// (tests/gesture-release.test.mjs). viewer.js applies the decision.
//
// mode: 'turn' | 'swap' | 'scroll' | anything else
//       turn: up or down, the card turning over (f, in half turns: up adds one, down takes one away;
//       the viewer calls the result 0 or 1 again). swap: sideways, to the card before or after.
// s:    { f, base, dx, travel: { x, y } } – the turn now and where the gesture started it, how far
//       the finger went sideways (px), finger travel for a whole turn or swap
// info: { vx, vy } – release speed in px/s
// Returns one of:
//   { prop: 'f', target, velocity }   spring the turn-over there (base, or base ± 1)
//   { swap: 1 | -1 }                  go to the next card (1: the finger went left) or the one before
//   { scroll: true, velocity }        let the scroll glide (velocity px/s)
//   { springBack: true }              back to where the gesture started

export const COMMIT = 0.25; // a quarter of the way is enough
export const FLICK = 1.1;   // turns (or swaps) per second: a quick flick towards the goal is enough too

const num = (x, fallback = 0) => (Number.isFinite(x) ? x : fallback);

export function releaseOutcome(mode, s, info = {}) {
  const tx = num(s?.travel?.x, 1) || 1, ty = num(s?.travel?.y, 1) || 1;
  const vx = num(info.vx), vy = num(info.vy);
  // Commit past a quarter, or on a flick towards the goal; a flick away springs back.
  const decide = (q, speed) => (speed > FLICK ? true : speed < -FLICK ? false : q > COMMIT);

  if (mode === 'turn') {
    const base = Math.round(num(s?.base)), f = num(s?.f, base);
    const way = Math.sign(f - base) || Math.sign(-vy) || 1; // up (f growing) or down
    const go = decide(Math.abs(f - base), (-vy / ty) * way);
    return { prop: 'f', target: go ? base + way : base, velocity: -vy / ty };
  }
  if (mode === 'swap') {
    const dx = num(s?.dx), way = Math.sign(dx) || Math.sign(vx) || 1;
    return decide(Math.abs(dx) / tx, (vx / tx) * way) ? { swap: -way } : { springBack: true };
  }
  if (mode === 'scroll') return { scroll: true, velocity: vy };
  return { springBack: true };
}
