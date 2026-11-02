// The Globe view's Earth: an orthographic projection drawn on a canvas.
// Land comes from assets/globe.json (Natural Earth, see scripts/make-globe.mjs) at two
// levels of detail: simplified coastlines while the whole globe shows, 1:50m when zoomed
// in. Every point is stored as a unit vector, so projecting it is three dot products.
// Points on the far side are pushed out to the globe's rim, which closes each shape
// along the edge; shapes wholly out of sight are skipped.
//
// Drag to spin (it glides on), pinch or scroll to zoom, double-tap to zoom in; left
// alone it turns slowly. Pins are not drawn here: on every frame the view gets a
// projector (onFrame) and places its own elements over the canvas.
import { h, reducedMotion } from './dom.js';
import { track, tween, clamp } from './gesture.js';

const DEG = Math.PI / 180;
const MIN_K = 1, MAX_K = 40;
const NEAR_K = 2.2;      // detailed coastlines from this zoom
const RADIUS = 0.42;     // globe radius at zoom 1, as a share of the smaller side
const IDLE_MS = 3500;    // start turning after this long without a touch
const SPIN = 4;          // degrees per second when turning by itself
const GLIDE = 420;       // ms: how long a flick keeps spinning
const MAX_LAT = 80;

// Where the globe was left, so it is still there after visiting another tab.
const saved = { lon: 121, lat: 18, k: 1 };

const wrap = lon => ((((lon + 180) % 360) + 360) % 360) - 180;

export function toVec(lon, lat) {
  const l = lon * DEG, p = lat * DEG, c = Math.cos(p);
  return [c * Math.cos(l), c * Math.sin(l), Math.sin(p)];
}

// Polygons ([[ [lon, lat]… ]…] in degrees) → rings of unit vectors, plus a bounding cap
// (centre and angular radius) for skipping shapes that are out of sight.
function prepare(polys) {
  return polys.map(rings => {
    const vecs = rings.map(ring => {
      const out = new Float32Array(ring.length * 3);
      ring.forEach(([lon, lat], i) => out.set(toVec(lon, lat), i * 3));
      return out;
    });
    const o = vecs[0];
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < o.length; i += 3) { x += o[i]; y += o[i + 1]; z += o[i + 2]; }
    const m = Math.hypot(x, y, z) || 1;
    x /= m; y /= m; z /= m;
    let minDot = 1;
    for (let i = 0; i < o.length; i += 3) minDot = Math.min(minDot, x * o[i] + y * o[i + 1] + z * o[i + 2]);
    return { rings: vecs, c: [x, y, z], r: Math.acos(clamp(minDot, -1, 1)) };
  });
}

// assets/globe.json stores flat [lon, lat, …] arrays in hundredths of a degree.
let land = null;
function loadLand() {
  land ??= fetch('assets/globe.json').then(r => r.json()).then(d => {
    const unflat = flat => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i] * d.unit, flat[i + 1] * d.unit]); return out; };
    const lod = list => prepare(list.map(rings => rings.map(unflat)));
    return { far: lod(d.far), near: lod(d.near) };
  });
  return land;
}

// Lines of latitude and longitude every 30°, as short segments.
const GRATICULE = (() => {
  const lines = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const l = []; for (let lat = -80; lat <= 80; lat += 4) l.push([lon, lat]); lines.push(l);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const l = []; for (let lon = -180; lon <= 180; lon += 4) l.push([lon, lat]); lines.push(l);
  }
  return lines.map(l => Float32Array.from(l.flatMap(([lon, lat]) => toVec(lon, lat))));
})();

function tokens(el) {
  const s = getComputedStyle(el);
  const v = name => s.getPropertyValue(name).trim();
  return {
    sea: v('--c-map-sea'), land: v('--c-map-land'), grid: v('--c-shine'), glow: v('--c-map-glow'),
    group: g => v(`--g-${g}`),
  };
}

export function createGlobe(stage, { onFrame, onTap, onInteract } = {}) {
  const canvas = h('canvas', { class: 'globe__canvas', 'aria-hidden': 'true' });
  stage.prepend(canvas);
  const ctx = canvas.getContext('2d');
  const col = tokens(stage);

  const view = { lon: saved.lon, lat: saved.lat, k: saved.k, dy: 0 };
  let size = { w: 1, h: 1, dpr: 1, r: 1 };
  let polys = null;
  let range = null;          // { polys, colour }
  let dirty = true;
  let raf = 0, last = 0;
  let lastTouch = performance.now();
  let glide = null;          // { vx, vy } in px per ms
  let flight = null;         // cancel function of a running tween
  let offset = 0;            // where view.dy is heading (room for the card sheet)
  let paused = false;
  const reduced = reducedMotion();

  loadLand().then(l => { polys = l; dirty = true; });

  // ---------- projection ----------
  let B = null; // basis for this frame: centre c, east e, north n, screen centre and radius
  function basis() {
    const l = view.lon * DEG, p = view.lat * DEG;
    const cl = Math.cos(l), sl = Math.sin(l), cp = Math.cos(p), sp = Math.sin(p);
    const r = size.r * view.k;
    const cx = size.w / 2, cy = size.h / 2 + view.dy;
    // How far from the centre the screen reaches, as an angle on the globe.
    const reach = Math.hypot(Math.max(cx, size.w - cx), Math.max(cy, size.h - cy));
    B = {
      c0: cp * cl, c1: cp * sl, c2: sp, e0: -sl, e1: cl, n0: -sp * cl, n1: -sp * sl, n2: cp,
      cx, cy, r, sight: reach >= r ? Math.PI / 2 : Math.asin(reach / r),
    };
    return B;
  }

  // [x, y, depth] on screen for a unit vector; depth < 0 is the far side.
  function project(v) {
    const X = v[0] * B.e0 + v[1] * B.e1;
    const Y = v[0] * B.n0 + v[1] * B.n1 + v[2] * B.n2;
    const Z = v[0] * B.c0 + v[1] * B.c1 + v[2] * B.c2;
    return [B.cx + B.r * X, B.cy - B.r * Y, Z];
  }

  // Screen point → [lon, lat], or null off the globe.
  function invert(px, py) {
    const b = basis();
    const X = (px - b.cx) / b.r, Y = (b.cy - py) / b.r, rr = X * X + Y * Y;
    if (rr > 1) return null;
    const Z = Math.sqrt(1 - rr);
    const x = X * b.e0 + Y * b.n0 + Z * b.c0, y = X * b.e1 + Y * b.n1 + Z * b.c1, z = Y * b.n2 + Z * b.c2;
    return [Math.atan2(y, x) / DEG, Math.asin(clamp(z, -1, 1)) / DEG];
  }

  // Add one ring to the path, cut off at the horizon: where it goes round the back, it
  // follows the rim (the shorter way) to where it comes back. Returns whether any of it
  // is on the near side.
  function trace(v) {
    const { e0, e1, n0, n1, n2, c0, c1, c2, cx, cy, r } = B;
    const n = v.length / 3;
    const depth = i => v[i * 3] * c0 + v[i * 3 + 1] * c1 + v[i * 3 + 2] * c2;
    let first = -1;
    for (let i = 0; i < n; i++) if (depth(i) >= 0) { first = i; break; }
    if (first < 0) return false;

    // Screen point of vertex i, or of the horizon crossing between vertices i and j.
    const at = (i, j = -1) => {
      let x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
      if (j >= 0) {
        const zi = depth(i), t = zi / (zi - depth(j));
        x += (v[j * 3] - x) * t; y += (v[j * 3 + 1] - y) * t; z += (v[j * 3 + 2] - z) * t;
      }
      let X = x * e0 + y * e1, Y = x * n0 + y * n1 + z * n2;
      if (j >= 0) { const m = Math.hypot(X, Y) || 1; X /= m; Y /= m; }
      return [cx + r * X, cy - r * Y];
    };

    let [px, py] = at(first);
    ctx.moveTo(px, py);
    let out = null; // angle on the rim where the ring went out of sight
    for (let s = 1; s <= n; s++) {
      const i = (first + s - 1) % n, j = (first + s) % n;
      const vi = depth(i) >= 0, vj = depth(j) >= 0;
      if (vi && vj) { [px, py] = at(j); ctx.lineTo(px, py); }
      else if (vi && !vj) { [px, py] = at(i, j); ctx.lineTo(px, py); out = Math.atan2(py - cy, px - cx); }
      else if (!vi && vj) {
        const [hx, hy] = at(j, i);
        const back = Math.atan2(hy - cy, hx - cx);
        let d = back - out;
        d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
        ctx.arc(cx, cy, r, out, back, d < 0);
        [px, py] = at(j);
        ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    return true;
  }

  const inSight = p => p.c[0] * B.c0 + p.c[1] * B.c1 + p.c[2] * B.c2 > Math.cos(Math.min(Math.PI, B.sight + p.r));

  function fillPolys(list, style, stroke) {
    ctx.fillStyle = style;
    for (const p of list) {
      if (!inSight(p)) continue;
      ctx.beginPath();
      let seen = false;
      for (const ring of p.rings) seen = trace(ring) || seen;
      if (!seen) continue;
      ctx.fill('evenodd');
      if (stroke) ctx.stroke();
    }
  }

  function draw() {
    const { w, h: ht, dpr } = size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, ht);
    const { cx, cy, r } = basis();

    // A thin glow of atmosphere outside the rim while the globe still fits on screen,
    // then the sea. No shading on the disc itself: it would read as a bowl.
    if (r < Math.max(w, ht)) {
      const g = ctx.createRadialGradient(cx, cy, r * 0.98, cx, cy, r * 1.07);
      g.addColorStop(0, col.glow);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.07, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = col.sea; ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();

    // Graticule (near side only).
    ctx.strokeStyle = col.grid; ctx.lineWidth = 1;
    ctx.beginPath();
    for (const line of GRATICULE) {
      let pen = false;
      for (let i = 0; i < line.length; i += 3) {
        const [x, y, z] = project([line[i], line[i + 1], line[i + 2]]);
        if (z < 0) { pen = false; continue; }
        if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        pen = true;
      }
    }
    ctx.stroke();

    if (polys) fillPolys(view.k >= NEAR_K ? polys.near : polys.far, col.land);

    if (range) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = range.colour; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      fillPolys(range.polys, range.colour);
      ctx.globalAlpha = 0.9;
      for (const p of range.polys) {
        if (!inSight(p)) continue;
        ctx.beginPath();
        for (const ring of p.rings) trace(ring);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    onFrame?.({ project, ctx, k: view.k, radius: r });
  }

  // ---------- the loop ----------
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(50, t - (last || t));
    last = t;
    if (glide) {
      rotateBy(glide.vx * dt, glide.vy * dt);
      const f = Math.exp(-dt / GLIDE);
      glide.vx *= f; glide.vy *= f;
      if (Math.hypot(glide.vx, glide.vy) < 0.005) glide = null;
    } else if (!flight && !paused && !reduced && t - lastTouch > IDLE_MS) {
      // Ease into the slow turn.
      const ease = Math.min(1, (t - lastTouch - IDLE_MS) / 1500);
      view.lon = wrap(view.lon - (SPIN * dt * ease) / 1000);
      dirty = true;
    }
    if (Math.abs(offset - view.dy) > 0.5) { view.dy += (offset - view.dy) * Math.min(1, dt / 90); dirty = true; }
    if (dirty) { dirty = false; draw(); }
  }

  function touched() {
    lastTouch = performance.now();
    glide = null;
    flight?.(); flight = null;
  }

  // Drag by (dx, dy) screen pixels: the ground under the finger follows it.
  function rotateBy(dx, dy) {
    const s = 1 / (size.r * view.k * DEG);
    view.lon = wrap(view.lon - (dx * s) / Math.max(0.35, Math.cos(view.lat * DEG)));
    view.lat = clamp(view.lat + dy * s, -MAX_LAT, MAX_LAT);
    dirty = true;
  }

  // Zoom so the place under (px, py) stays under it.
  function zoomAt(px, py, k) {
    const before = invert(px, py);
    view.k = clamp(k, MIN_K, MAX_K);
    const after = before && invert(px, py);
    if (after) {
      view.lon = wrap(view.lon + wrap(before[0] - after[0]));
      view.lat = clamp(view.lat + before[1] - after[1], -MAX_LAT, MAX_LAT);
    }
    dirty = true;
  }

  // ---------- input ----------
  const local = (x, y) => { const b = canvas.getBoundingClientRect(); return [x - b.left, y - b.top]; };
  const fingers = new Map();
  const midpoint = () => {
    const [a, b] = [...fingers.values()];
    return b ? local((a.x + b.x) / 2, (a.y + b.y) / 2) : [size.w / 2, size.h / 2];
  };
  const keep = e => fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  const drop = e => fingers.delete(e.pointerId);
  stage.addEventListener('pointerdown', keep);
  stage.addEventListener('pointermove', e => { if (fingers.has(e.pointerId)) keep(e); });
  stage.addEventListener('pointerup', drop);
  stage.addEventListener('pointercancel', drop);

  let prev = null, pinchK = 1;
  const untrack = track(stage, {
    start: () => { touched(); return true; },
    lock: () => { prev = { dx: 0, dy: 0 }; onInteract?.(); return true; },
    move: ({ dx, dy }) => { rotateBy(dx - prev.dx, dy - prev.dy); prev = { dx, dy }; lastTouch = performance.now(); },
    end: ({ vx, vy }) => {
      lastTouch = performance.now();
      // vx/vy are px per second.
      if (!reduced && Math.hypot(vx, vy) > 150) glide = { vx: vx / 1000, vy: vy / 1000 };
    },
    pinchStart: () => { touched(); pinchK = view.k; onInteract?.(); },
    pinchMove: ({ scale }) => { zoomAt(...midpoint(), pinchK * scale); lastTouch = performance.now(); },
    pinchEnd: () => { lastTouch = performance.now(); },
  });

  stage.addEventListener('wheel', e => {
    e.preventDefault();
    touched();
    onInteract?.();
    zoomAt(...local(e.clientX, e.clientY), view.k * Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  // Taps on the globe itself (pins handle their own). Two quick taps zoom in.
  let lastTap = null;
  stage.addEventListener('click', e => {
    if (e.target !== canvas) return;
    const [x, y] = local(e.clientX, e.clientY);
    const now = performance.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
      lastTap = null;
      zoomTo(x, y, view.k * 2.2);
      return;
    }
    lastTap = { t: now, x, y };
    touched();
    onTap?.(invert(x, y));
  });

  function zoomTo(x, y, k, duration = 380) {
    touched();
    onInteract?.();
    const from = view.k;
    const to = clamp(k, MIN_K, MAX_K);
    if (reduced) { zoomAt(x, y, to); return; }
    flight = tween({ from: 0, to: 1, duration, onUpdate: t => zoomAt(x, y, from * (to / from) ** t), onDone: () => { flight = null; } });
  }

  const ro = new ResizeObserver(([entry]) => {
    const { width: w, height: ht } = entry.contentRect;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(ht * dpr);
    size = { w, h: ht, dpr, r: Math.min(w, ht) * RADIUS };
    dirty = true;
  });
  ro.observe(stage);
  raf = requestAnimationFrame(frame);

  return {
    ready: loadLand(),
    get k() { return view.k; },
    get radius() { return size.r; },
    redraw() { dirty = true; },
    pause(on) { paused = on; if (!on) lastTouch = performance.now(); },
    // Room at the bottom (px) for the card sheet: the globe slides up to stay in view.
    setOffset(px) { offset = -px / 2; dirty = true; },
    // polys: GeoJSON-style [[ [lon, lat]… ]…] lists, or null to clear.
    setRange(list, group) { range = list ? { polys: prepare(list), colour: col.group(group) } : null; dirty = true; },
    // Turn (and zoom) to a place.
    flyTo(lon, lat, k = view.k, { duration = 700, onDone } = {}) {
      touched();
      const from = { ...view };
      const dl = wrap(lon - from.lon);
      const to = { lat: clamp(lat, -MAX_LAT, MAX_LAT), k: clamp(k, MIN_K, MAX_K) };
      const step = t => {
        view.lon = wrap(from.lon + dl * t);
        view.lat = from.lat + (to.lat - from.lat) * t;
        view.k = from.k * (to.k / from.k) ** t;
        dirty = true;
      };
      if (reduced) { step(1); onDone?.(); return; }
      flight = tween({ from: 0, to: 1, duration, ease: t => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2), onUpdate: step, onDone: () => { flight = null; onDone?.(); } });
    },
    zoomBy(f) { zoomTo(size.w / 2, size.h / 2 + view.dy, view.k * f, 260); },
    spinBy(dLon, dLat) { touched(); view.lon = wrap(view.lon + dLon); view.lat = clamp(view.lat + dLat, -MAX_LAT, MAX_LAT); dirty = true; },
    destroy() {
      cancelAnimationFrame(raf);
      flight?.();
      untrack();
      ro.disconnect();
      Object.assign(saved, { lon: view.lon, lat: view.lat, k: view.k });
    },
  };
}
