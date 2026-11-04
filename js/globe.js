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

// Where to look at a range (from the card's map): its middle, zoomed so it fills about 40%
// of the view, but no closer than FIT_K_MAX so a small range (an animal found only in Taiwan)
// still shows the coasts around it. polys: [[ [lon, lat]… ]…], as rangePolygons() returns.
export const FIT_K_MAX = 8;   // at zoom 8 the view reaches about 8.6° from its centre
const FIT_SHARE = 0.4;        // of the smaller side, across the range
export function rangeFit(polys, { cap = FIT_K_MAX } = {}) {
  let x = 0, y = 0, z = 0, n = 0;
  for (const rings of polys ?? []) for (const [lon, lat] of rings[0] ?? []) { const v = toVec(lon, lat); x += v[0]; y += v[1]; z += v[2]; n++; }
  const m = Math.hypot(x, y, z);
  if (!n || m < 1e-9) return null;
  x /= m; y /= m; z /= m;
  let reach = 0; // angular radius of the range from its middle
  for (const rings of polys) for (const [lon, lat] of rings[0] ?? []) { const v = toVec(lon, lat); reach = Math.max(reach, Math.acos(clamp(x * v[0] + y * v[1] + z * v[2], -1, 1))); }
  // On screen the range reaches RADIUS × k × sin(reach) of the smaller side; make that FIT_SHARE / 2.
  const k = clamp(FIT_SHARE / 2 / (RADIUS * Math.sin(Math.min(Math.PI / 2, Math.max(reach, 1e-6)))), MIN_K, Math.max(MIN_K, cap));
  return { lon: Math.atan2(y, x) / DEG, lat: Math.asin(clamp(z, -1, 1)) / DEG, k };
}

// The globe in the room left by the side panel, the chips and a sheet: its size (fit, a share
// of its full size) and how far its middle moves (dx, dy px). It is as big as the free space
// allows (never bigger than its full size, never under 55%) and in the middle of that space,
// so on a wide screen it sits in the spare width beside the panel instead of leaving margins.
export function roomFit({ w, h, top = 0, bottom = 0, left = 0 }) {
  if (w < 2 || h < 2) return { fit: 1, dx: 0, dy: 0 };
  const freeW = Math.max(1, w - left), freeH = Math.max(1, h - top - bottom);
  return { fit: clamp(Math.min(freeW, freeH) / Math.min(w, h), 0.55, 1), dx: left / 2, dy: (top - bottom) / 2 };
}

// Where an outline may not be rounded off (edges: true, for shapes drawn with curves): the
// edges of the data's map (the antimeridian and the poles, where Natural Earth cuts its
// shapes) and the points where two outlines meet (TopoJSON arc ends, ring.joins).
const onFrame = (lon, lat) => Math.abs(lon) >= 179.9 || Math.abs(lat) >= 89.5;
export function hardPoints(ring) {
  const hard = new Uint8Array(ring.length);
  ring.forEach(([lon, lat], i) => { if (onFrame(lon, lat)) hard[i] = 1; });
  for (const i of ring.joins ?? []) hard[i] = 1;
  return hard;
}

// Polygons ([[ [lon, lat]… ]…] in degrees) → rings of unit vectors, plus a bounding cap
// (centre and angular radius) for skipping shapes that are out of sight.
export function prepare(polys, { edges = false } = {}) {
  return polys.map(rings => {
    const vecs = rings.map(ring => {
      const out = new Float32Array(ring.length * 3);
      ring.forEach(([lon, lat], i) => out.set(toVec(lon, lat), i * 3));
      if (edges) out.hard = hardPoints(ring);
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

// assets/globe.json stores flat [lon, lat, …] arrays in hundredths of a degree. It is only
// fetched when a globe is first made (the service worker keeps it from then on), so the very
// first time needs the internet: if that fails the promise rejects and is forgotten, and the
// next call tries again.
let land = null;
export function loadLand() {
  land ??= fetch('assets/globe.json').then(r => { if (!r.ok) throw new Error(`${r.status} assets/globe.json`); return r.json(); }).then(d => {
    const unflat = flat => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i] * d.unit, flat[i + 1] * d.unit]); return out; };
    const lod = list => prepare(list.map(rings => rings.map(unflat)));
    return { far: lod(d.far), near: lod(d.near) };
  });
  land.catch(() => { land = null; });
  return land;
}

// The home country's outline (assets/home.json, same format as globe.json), drawn with a
// glow above every layer.
let homeShape = null;
function loadHome() {
  homeShape ??= fetch('assets/home.json').then(r => { if (!r.ok) throw new Error(`${r.status} assets/home.json`); return r.json(); }).then(d => {
    const unflat = flat => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i] * d.unit, flat[i + 1] * d.unit]); return out; };
    return prepare(d.polys.map(rings => rings.map(unflat)));
  });
  homeShape.catch(() => { homeShape = null; });
  return homeShape;
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
    home: v('--c-map-home'), homeEdge: v('--c-shade-strong'),
    group: g => v(`--g-${g}`),
  };
}

// Add one ring (unit vectors, 3 floats a point) to a path on sink (a canvas context, or
// anything with the same path methods), cut off at the horizon: where the ring goes round
// the back it follows the rim, the shorter way, to where it comes back. Returns whether any
// of it is on the near side. B: this frame's basis (centre c, east e, north n, screen cx, cy,
// r, and the screen's size w × h).
//
// f > 0 draws the outline as gentle curves: each corner is rounded with a quadratic curve
// that takes f of the two segments either side (0.5 would round it all the way to their
// middles). Curves never reach past a clip point: a run of points is cut at the horizon,
// and at hard points (v.hard: the map's edges, where outlines meet), which are passed
// through exactly; a segment between two clip points stays straight. f = 0 draws the plain
// straight outline. (The canvas itself is cut to the globe's disc and the screen, which
// clips pixels, not the outline.)
//
// Off the screen: a stretch of points beyond one edge of the screen (by more than OFF px) is
// cut short to its two ends, when every point in it, and both ends, are beyond that same
// edge. The shortcut then stays beyond that edge, so what is filled on screen is exactly the
// same, and zoomed in (where most of a big outline is off screen) far less is drawn. The
// margin keeps every curve near the screen on its own points.
const OFF = 256;
// A corner is only rounded where that shows: when the curve takes at least BEND px of the
// shorter segment beside it. Zoomed out the segments are a few pixels long and stay straight,
// which costs far less to fill; zoomed in, where corners would show, they all curve.
const BEND = 2;
export function traceRing(sink, v, B, f = 0) {
  const { e0, e1, n0, n1, n2, c0, c1, c2, cx, cy, r } = B;
  const W = B.w ?? Infinity, H = B.h ?? Infinity;
  const n = v.length / 3;
  const hard = f > 0 ? v.hard : null;
  const depth = i => v[i * 3] * c0 + v[i * 3 + 1] * c1 + v[i * 3 + 2] * c2;
  const vis = i => depth(i) >= 0;
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
  const side = (x, y) => (x < -OFF ? 1 : x > W + OFF ? 2 : 0) | (y < -OFF ? 4 : y > H + OFF ? 8 : 0);
  const rimArc = (from, to) => {
    let d = to - from;
    d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
    sink.arc(cx, cy, r, from, to, d < 0);
  };
  const point = i => { const [x, y] = at(i); return [x, y, hard?.[i] ? 1 : 0, side(x, y)]; };
  // Walk the points keeping the edges the stretch since the last kept point has in common
  // (mask): a point is left out while it and the next one still share one of them.
  const cull = (pts, wrap = false) => {
    if (pts.length < 3 || W === Infinity) return pts;
    const out = [pts[0]];
    let mask = pts[0][3];
    const end = wrap ? pts.length : pts.length - 1;
    for (let k = 1; k < end; k++) {
      const p = pts[k], q = pts[(k + 1) % pts.length];
      if (mask & p[3] & q[3]) mask &= p[3];
      else { out.push(p); mask = p[3]; }
    }
    if (!wrap) out.push(pts[pts.length - 1]);
    return out;
  };

  let started = false;
  // A run between two clip points: straight at its ends, corners rounded in between (f > 0).
  // The pen is already at its first point (the end of the last run, or of a rim arc), except
  // at the very start.
  const run = all => {
    const pts = cull(all);
    if (!started) { sink.moveTo(pts[0][0], pts[0][1]); started = true; }
    for (let k = 1; k < pts.length - 1; k++) {
      const [x, y, h] = pts[k];
      if (h || !(f > 0)) { sink.lineTo(x, y); continue; }
      const [ax, ay] = pts[k - 1], [bx, by] = pts[k + 1];
      if (Math.min(Math.hypot(ax - x, ay - y), Math.hypot(bx - x, by - y)) * f < BEND) { sink.lineTo(x, y); continue; }
      sink.lineTo(x + (ax - x) * f, y + (ay - y) * f);
      sink.quadraticCurveTo(x, y, x + (bx - x) * f, y + (by - y) * f);
    }
    const last = pts[pts.length - 1];
    if (pts.length > 1) sink.lineTo(last[0], last[1]);
  };

  // Where to begin: a point coming back into sight (a horizon crossing), else a hard point,
  // else (all in sight, nothing hard) the ring is one closed loop.
  let start = -1, cross = false;
  for (let i = 0; i < n; i++) if (vis(i) && !vis((i + n - 1) % n)) { start = i; cross = true; break; }
  if (start < 0) {
    if (!n || !vis(0)) return false;
    if (hard) for (let i = 0; i < n; i++) if (hard[i]) { start = i; break; }
  }
  if (start < 0) {
    // Closed: leave out points as for a run, the ends wrapping round.
    const all = [];
    for (let i = 0; i < n; i++) all.push(point(i));
    const P = cull(all, true);
    const m = P.length;
    // Nothing left: the whole ring is beyond one edge of the screen, so it adds nothing there.
    if (m < 3) return false;
    if (!(f > 0)) {
      sink.moveTo(P[0][0], P[0][1]);
      for (let k = 1; k < m; k++) sink.lineTo(P[k][0], P[k][1]);
      sink.closePath();
      return true;
    }
    const corner = (k, g) => { const [x, y] = P[k], [ox, oy] = P[(k + g + m) % m]; return [x + (ox - x) * f, y + (oy - y) * f]; };
    const [sx, sy] = corner(0, -1);
    sink.moveTo(sx, sy);
    for (let k = 0; k < m; k++) {
      const [ax, ay] = corner(k, -1), [bx, by] = corner(k, 1);
      const [x, y] = P[k];
      if (k) sink.lineTo(ax, ay);
      // Too small to show: a straight corner (the same line in and out of it).
      if (Math.min(Math.hypot(ax - x, ay - y), Math.hypot(bx - x, by - y)) < BEND) sink.lineTo(x, y), sink.lineTo(bx, by);
      else sink.quadraticCurveTo(x, y, bx, by);
    }
    sink.closePath();
    return true;
  }

  let pts = [];
  let out = null; // rim angle where the ring went out of sight
  if (cross) {
    const [hx, hy] = at(start, (start + n - 1) % n);
    pts.push([hx, hy, 1, side(hx, hy)]);
  }
  for (let s = 0; s < n; s++) {
    const i = (start + s) % n, j = (start + s + 1) % n;
    const vi = vis(i), vj = vis(j);
    if (vi) {
      const p = point(i);
      pts.push(p);
      if (p[2] && pts.length > 1) { run(pts); pts = [p]; }
    }
    if (vi && !vj) {
      const [x, y] = at(i, j);
      pts.push([x, y, 1, side(x, y)]);
      run(pts);
      pts = [];
      out = Math.atan2(y - cy, x - cx);
    } else if (!vi && vj) {
      const [hx, hy] = at(j, i);
      rimArc(out, Math.atan2(hy - cy, hx - cx));
      if (j === start) break; // round the back to where the walk began
      pts = [[hx, hy, 1, side(hx, hy)]];
    }
  }
  if (pts.length) { if (!cross) pts.push(point(start)); run(pts); }
  sink.closePath();
  return true;
}

// debug: show the frame rate and drawing time while the globe moves (?debug=fps).
// onLand(ok): the land loaded (true) or couldn't be fetched (false: offline the first time);
// retry() tries again.
export function createGlobe(stage, { onFrame, onTap, onInteract, onLand, debug = false } = {}) {
  // Bottom to top: sea and land, the picture layer (WebGL, made when first needed), the
  // overlay. Only the bottom canvas takes taps.
  const canvas = h('canvas', { class: 'globe__canvas', 'aria-hidden': 'true' });
  const overCanvas = h('canvas', { class: 'globe__canvas globe__canvas--over', 'aria-hidden': 'true' });
  stage.prepend(canvas, overCanvas);
  const baseCtx = canvas.getContext('2d'), overCtx = overCanvas.getContext('2d');
  let ctx = baseCtx; // the canvas being drawn on
  const col = tokens(stage);
  let layer = null;          // see setLayer
  let sphere = null;         // js/globegl.js, once a picture layer has been shown
  let home = null;
  const getHome = () => loadHome().then(p => { home = p; dirty = true; }).catch(() => {});
  getHome();

  const view = { lon: saved.lon, lat: saved.lat, k: saved.k, dx: 0, dy: 0 };
  let size = { w: 1, h: 1, dpr: 1, r: 1 };
  let polys = null;
  let range = null;          // { polys, colour }
  let dirty = true;
  let raf = 0, last = 0;
  let lastTouch = performance.now();
  let glide = null;          // { vx, vy } in px per ms
  let flight = null;         // cancel function of a running tween
  let offset = 0;            // where view.dy is heading (room for the card sheet)
  let fit = 1, fitTo = 1;    // globe size while the info panel takes room (setRoom)
  let room = null;           // { top, bottom, left } px
  let held = false;          // the card sheet has set the offset
  let offsetX = 0;           // where view.dx is heading (room for the side panel)
  function applyRoom() {
    const r = roomFit({ w: size.w, h: size.h, ...room });
    fitTo = r.fit;
    offsetX = r.dx;
    if (!held) offset = r.dy;
  }
  let paused = false;
  const reduced = reducedMotion();

  let gone = false;
  const getLand = () => loadLand().then(l => { if (gone) return; polys = l; dirty = true; onLand?.(true); }, () => { if (!gone) onLand?.(false); });
  getLand();

  // ---------- projection ----------
  let B = null; // basis for this frame: centre c, east e, north n, screen centre and radius
  function basis() {
    const l = view.lon * DEG, p = view.lat * DEG;
    const cl = Math.cos(l), sl = Math.sin(l), cp = Math.cos(p), sp = Math.sin(p);
    const r = size.r * view.k * fit;
    const cx = size.w / 2 + view.dx, cy = size.h / 2 + view.dy;
    // How far from the centre the screen reaches, as an angle on the globe.
    const reach = Math.hypot(Math.max(cx, size.w - cx), Math.max(cy, size.h - cy));
    B = {
      c0: cp * cl, c1: cp * sl, c2: sp, e0: -sl, e1: cl, n0: -sp * cl, n1: -sp * sl, n2: cp,
      cx, cy, r, w: size.w, h: size.h, sight: reach >= r ? Math.PI / 2 : Math.asin(reach / r),
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

  const trace = (v, f = 0) => traceRing(ctx, v, B, f);

  const inSight = p => p.c[0] * B.c0 + p.c[1] * B.c1 + p.c[2] * B.c2 > Math.cos(Math.min(Math.PI, B.sight + p.r));

  // curve: 0 for straight outlines, or how much of each segment a corner's curve takes.
  function fillPolys(list, style, stroke, curve = 0) {
    ctx.fillStyle = style;
    for (const p of list) {
      if (!inSight(p)) continue;
      ctx.beginPath();
      let seen = false;
      for (const ring of p.rings) seen = trace(ring, curve) || seen;
      if (!seen) continue;
      ctx.fill('evenodd');
      if (stroke) ctx.stroke();
    }
  }

  // Shapes drawn per layer: [{ polys, near?, fill }] (prepared); near is the detailed
  // version for zooming in, as with the land.
  // nearK: a layer's own zoom for its detailed shapes (the depth bands' far ones, drawn as
  // curves, are plenty until then).
  const fillAll = list => { for (const s of list ?? []) fillPolys((view.k >= (s.nearK ?? NEAR_K) && s.near) || s.polys, s.fill, false, s.curve ?? 0); };

  function draw() {
    const { w, h: ht, dpr } = size;
    ctx = baseCtx;
    for (const c of [baseCtx, overCtx]) { c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, ht); }
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

    fillAll(layer?.sea);

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
    fillAll(layer?.land);
    ctx.restore();

    // The picture layer, if any, between the two canvases.
    if (sphere) sphere.draw(B, size);

    // Above every layer: reef points, the selected range, the home outline, pin fans.
    ctx = overCtx;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (layer?.points) drawPoints(layer.points);

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
    if (home) {
      ctx.lineJoin = 'round';
      // A dark edge so it stands out on every layer, a soft glow, then the bright line.
      for (const [width, alpha, colour] of [[5, 0.45, col.homeEdge], [9, 0.3, col.home], [2.5, 1, col.home]]) {
        ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.strokeStyle = colour;
        for (const p of home) {
          if (!inSight(p)) continue;
          ctx.beginPath();
          for (const ring of p.rings) trace(ring);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    onFrame?.({ project, ctx, k: view.k, radius: r });
  }

  // Glowing dots (reefs): one soft sprite, stamped at every point on the near side.
  let sprite = null;
  function drawPoints({ vecs, colour }) {
    const d = 24;
    if (sprite?.colour !== colour) {
      const c = document.createElement('canvas');
      c.width = c.height = d * 2;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(d, d, 0, d, d, d);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.18, colour);
      grad.addColorStop(1, `${colour.slice(0, 7)}00`); // the same colour, clear (not black)
      g.fillStyle = grad;
      g.fillRect(0, 0, d * 2, d * 2);
      sprite = { c, colour };
    }
    const s = clamp(5 * Math.sqrt(view.k), 5, 22); // dot size on screen
    for (let i = 0; i < vecs.length; i += 3) {
      const [x, y, z] = project([vecs[i], vecs[i + 1], vecs[i + 2]]);
      if (z > 0) ctx.drawImage(sprite.c, x - s, y - s, s * 2, s * 2);
    }
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
    if (Math.abs(offsetX - view.dx) > 0.5) { view.dx += (offsetX - view.dx) * Math.min(1, dt / 90); dirty = true; }
    if (Math.abs(fitTo - fit) > 0.002) { fit += (fitTo - fit) * Math.min(1, dt / 90); dirty = true; }
    if (dirty) {
      dirty = false;
      if (meter) { const t0 = performance.now(); draw(); meter.frame(t, performance.now() - t0); } else draw();
    }
  }

  // ?debug=fps: frames drawn per second and how long drawing took (mean and slowest), over
  // the last second of movement, so the speed can be checked on a real tablet.
  const meter = debug ? (() => {
    const el = h('p', { class: 'globe__fps', 'aria-hidden': 'true' });
    stage.append(el);
    let from = 0, frames = 0, sum = 0, max = 0, prev = 0;
    return {
      el,
      frame(t, ms) {
        if (t - prev > 1500) { from = t; frames = 0; sum = 0; max = 0; } // it had stopped moving
        prev = t;
        frames++; sum += ms; max = Math.max(max, ms);
        if (t - from >= 1000) {
          el.textContent = `${Math.round((frames * 1000) / (t - from))} fps · draw ${(sum / frames).toFixed(1)} ms (max ${max.toFixed(1)})`;
          from = t; frames = 0; sum = 0; max = 0;
        }
      },
    };
  })() : null;

  function touched() {
    lastTouch = performance.now();
    glide = null;
    flight?.(); flight = null;
  }

  // Drag by (dx, dy) screen pixels: the ground under the finger follows it.
  function rotateBy(dx, dy) {
    const s = 1 / (size.r * view.k * fit * DEG);
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
    for (const c of [canvas, overCanvas]) { c.width = Math.round(w * dpr); c.height = Math.round(ht * dpr); }
    size = { w, h: ht, dpr, r: Math.min(w, ht) * RADIUS };
    applyRoom();
    dirty = true;
  });
  ro.observe(stage);
  raf = requestAnimationFrame(frame);

  return {
    ready: loadLand(),
    get k() { return view.k; },
    get radius() { return size.r * fit; },
    redraw() { dirty = true; },
    retry() { if (!polys) getLand(); if (!home) getHome(); },
    // ?debug=fps only: draw n frames in a row, turning 1° each, and time them (ms), to compare
    // drawing cost without depending on the display's frame rate.
    ...(debug && {
      bench(n = 60) {
        const times = [];
        for (let i = 0; i < n; i++) { view.lon = wrap(view.lon + 1); const t0 = performance.now(); draw(); baseCtx.getImageData(0, 0, 1, 1); overCtx.getImageData(0, 0, 1, 1); times.push(performance.now() - t0); } // reading a pixel back waits until the frame is really drawn
        times.sort((x, y) => x - y);
        return { mean: times.reduce((s, x) => s + x, 0) / n, median: times[n >> 1], p95: times[Math.floor(n * 0.95)], max: times[n - 1] };
      },
    }),
    pause(on) { paused = on; if (!on) lastTouch = performance.now(); },
    // Room at the bottom (px) for the card sheet: the globe slides up to stay in view.
    setOffset(px) { held = px > 0; offset = -px / 2; dirty = true; },
    // Space the globe keeps clear: top (the chips), bottom (a sheet), left (the side panel), px.
    setRoom(top, bottom, left = 0) { room = top || bottom || left ? { top, bottom, left } : null; applyRoom(); dirty = true; },
    // polys: GeoJSON-style [[ [lon, lat]… ]…] lists, or null to clear.
    setRange(list, group) { range = list ? { polys: prepare(list), colour: col.group(group) } : null; dirty = true; },
    // A map layer, or null for the plain globe:
    //   sea:    [{ polys, near?, fill }] drawn on the sea, under the land (prepared with prepare())
    //   land:   [{ polys, near?, fill }] drawn on the land
    //   points: { vecs, colour } glowing dots above everything (flat unit vectors)
    //   raster: a js/globegl.js spec, drawn above sea and land
    // Resolves when the layer is showing; rejects if its pictures can't be shown.
    async setLayer(next) {
      layer = next;
      dirty = true;
      if (next?.raster && !sphere) {
        const { createSphere } = await import('./globegl.js');
        const glCanvas = h('canvas', { class: 'globe__canvas globe__canvas--gl', 'aria-hidden': 'true' });
        sphere = createSphere(glCanvas);
        if (!sphere) throw new Error('WebGL 2 is not available');
        overCanvas.before(glCanvas);
      }
      await sphere?.set(next?.raster ?? null);
      dirty = true;
    },
    // Change the picture layer's settings (e.g. where the sun is) without reloading it.
    updateRaster(patch) { sphere?.update(patch); dirty = true; },
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
    zoomBy(f) { zoomTo(size.w / 2 + view.dx, size.h / 2 + view.dy, view.k * f, 260); },
    spinBy(dLon, dLat) { touched(); view.lon = wrap(view.lon + dLon); view.lat = clamp(view.lat + dLat, -MAX_LAT, MAX_LAT); dirty = true; },
    destroy() {
      gone = true;
      cancelAnimationFrame(raf);
      flight?.();
      untrack();
      ro.disconnect();
      sphere?.destroy();
      Object.assign(saved, { lon: view.lon, lat: view.lat, k: view.k });
    },
  };
}
