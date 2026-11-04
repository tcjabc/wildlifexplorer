// Gesture building blocks: pointer tracking with velocity, a damped spring for
// release animations, and haptic ticks. No libraries.
import { reducedMotion } from './dom.js';

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;

// Small vibration where supported (Android). iPad Safari has no navigator.vibrate.
export function haptic(ms = 8) {
  try { navigator.vibrate?.(ms); } catch { /* not supported */ }
}

// Animate a number from `from` to `to` with a damped spring, starting with `velocity`
// (units per second, e.g. from a flick). With reduced motion it jumps straight there.
// Returns a function that cancels the animation.
export function spring({ from, to, velocity = 0, stiffness = 260, damping = 26, onUpdate, onDone }) {
  if (reducedMotion()) {
    onUpdate(to);
    onDone?.();
    return () => {};
  }
  let x = from, v = velocity, last = performance.now(), raf = 0, stopped = false;
  const step = now => {
    if (stopped) return;
    // Fixed small sub-steps keep the integration stable on slow frames.
    let dt = Math.min(0.064, (now - last) / 1000);
    last = now;
    while (dt > 0) {
      const h = Math.min(dt, 1 / 240);
      const a = -stiffness * (x - to) - damping * v;
      v += a * h;
      x += v * h;
      dt -= h;
    }
    if (Math.abs(x - to) < 0.0005 && Math.abs(v) < 0.01) {
      onUpdate(to);
      onDone?.();
      return;
    }
    onUpdate(x);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

// Ease-out tween for things that should glide, not wobble (fly-to-binder, zoom).
export function tween({ from = 0, to = 1, duration = 420, ease = t => 1 - (1 - t) ** 3, onUpdate, onDone }) {
  if (reducedMotion()) {
    onUpdate(to);
    onDone?.();
    return () => {};
  }
  const start = performance.now();
  let raf = 0, stopped = false;
  const step = now => {
    if (stopped) return;
    const t = clamp((now - start) / duration);
    onUpdate(lerp(from, to, ease(t)));
    if (t < 1) raf = requestAnimationFrame(step); else onDone?.();
  };
  raf = requestAnimationFrame(step);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}

// Velocity from the last ~100 ms of pointer samples, in px per second.
function velocityOf(samples) {
  const now = samples.at(-1);
  const old = samples.find(s => now.t - s.t < 100) ?? samples[0];
  const dt = (now.t - old.t) / 1000;
  return dt > 0 ? { vx: (now.x - old.x) / dt, vy: (now.y - old.y) / dt } : { vx: 0, vy: 0 };
}

// Track one- and two-finger gestures on `el`.
// handlers.start(info) -> return false to ignore this pointer sequence
//   info: { x, y, target, pointers }
// handlers.lock({ dx, dy, axis }) -> return false to give up, null to decide later (asked
//   again on each move once the pointer has moved `slop` px), anything else to start dragging
// handlers.move({ dx, dy, x, y })
// handlers.end({ dx, dy, vx, vy })
// handlers.tap({ x, y }) -> the pointer went up before moving `slop` px (the click still happens)
// handlers.pinchStart({ dist }) / pinchMove({ dist, scale }) / pinchEnd({ scale, velocity })
export function track(el, handlers, { slop = 8 } = {}) {
  const pointers = new Map();
  let mode = null; // null | 'pending' | 'drag' | 'pinch'
  let start = null, samples = [], pinch = null;

  const distance = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const finishDrag = () => {
    if (mode === 'drag') {
      const last = samples.at(-1);
      handlers.end?.({ dx: last.x - start.x, dy: last.y - start.y, ...velocityOf(samples) });
    }
    mode = null;
  };

  const down = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && handlers.pinchStart) {
      // A second finger turns any drag into a pinch.
      if (mode === 'drag') handlers.cancel?.();
      mode = 'pinch';
      pinch = { dist: distance(), samples: [{ t: performance.now(), d: distance() }] };
      for (const id of pointers.keys()) try { el.setPointerCapture(id); } catch { /* gone */ }
      handlers.pinchStart({ dist: pinch.dist });
      return;
    }
    if (pointers.size > 1) return;
    samples = [];
    if (handlers.start?.({ x: e.clientX, y: e.clientY, target: e.target, pointerType: e.pointerType }) === false) {
      mode = null;
      return;
    }
    mode = 'pending';
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    samples = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
  };

  const move = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (mode === 'pinch' && pointers.size >= 2) {
      const d = distance();
      pinch.samples.push({ t: performance.now(), d });
      if (pinch.samples.length > 12) pinch.samples.shift();
      handlers.pinchMove?.({ dist: d, delta: d - pinch.dist, scale: d / pinch.dist });
      e.preventDefault();
      return;
    }
    if (e.pointerId !== start?.id) return;
    const dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (mode === 'pending') {
      if (Math.hypot(dx, dy) < slop) return;
      const axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      const decided = handlers.lock?.({ dx, dy, axis, x: start.x, y: start.y });
      if (decided === false) { mode = null; return; }
      if (decided === null) return; // not sure yet: ask again on the next move
      mode = 'drag';
      try { el.setPointerCapture(e.pointerId); } catch { /* gone */ }
    }
    if (mode !== 'drag') return;
    samples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (samples.length > 20) samples.shift();
    handlers.move?.({ dx, dy, x: e.clientX, y: e.clientY });
    e.preventDefault();
  };

  const up = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (mode === 'pinch') {
      if (pointers.size < 2) {
        const s = pinch.samples, a = s[0], b = s.at(-1);
        const dt = (b.t - a.t) / 1000;
        handlers.pinchEnd?.({ delta: b.d - pinch.dist, scale: b.d / pinch.dist, velocity: dt > 0 ? (b.d - a.d) / dt : 0 });
        mode = 'done-pinch';
      }
      if (pointers.size === 0) mode = null;
      return;
    }
    if (e.pointerId === start?.id) {
      if (mode === 'pending') handlers.tap?.({ x: start.x, y: start.y });
      finishDrag();
    }
    if (pointers.size === 0 && mode === 'done-pinch') mode = null;
  };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  // Stop the click that follows a real drag from also counting as a tap.
  el.addEventListener('click', e => { if (samples.length > 2 && dragged()) { e.stopPropagation(); e.preventDefault(); } }, true);
  const dragged = () => {
    const a = samples[0], b = samples.at(-1);
    return a && b && Math.hypot(b.x - a.x, b.y - a.y) >= slop;
  };
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}
