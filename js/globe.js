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
import { createTiles, RELIEF_TILES } from './globe-tiles.js';
import { createBase } from './globe-base.js';
import { decodeTopo } from './topo.js';

const DEG = Math.PI / 180;
const MIN_K = 1, MAX_K = 40;
const NEAR_K = 2.2;      // detailed coastlines from this zoom
const RADIUS = 0.42;     // globe radius at zoom 1, as a share of the smaller side
const IDLE_MS = 20000;   // start turning after this long without a touch
const SPIN_IN_MS = 1500; // and ease into the turn over this long
const SPIN = 4;          // degrees per second when turning by itself
const GLIDE = 420;       // ms: how long a flick keeps spinning
const MAX_LAT = 80;
const PLAIN_BASE = { kind: 'flat', hill: 0.5, tiles: RELIEF_TILES }; // the plain map on the base renderer
const MAX_DPR = 1.5;     // sharper costs the baseline tablet more than it shows
const WHEEL_HOLD = 250;  // ms after a wheel turn that the globe still counts as being zoomed

// How much of its slow turn the globe is doing, 0 to 1: only fully zoomed out, and only after
// idle ms without a touch.
export function spinEase(idle, k) {
  if (k > MIN_K + 0.001 || idle <= IDLE_MS) return 0;
  return Math.min(1, (idle - IDLE_MS) / SPIN_IN_MS);
}

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
// Beside the side panel, with width to spare, the globe grows past its usual size: up to
// WIDE_SHARE of the free height as its radius (RADIUS normally), as the free space gets wider
// than it is tall, never wider than the free width allows. Taller than wide, it fills the width.
export const WIDE_SHARE = 0.47;
const FULL_WIDTH = 0.46; // beside the toolbar: the most of the free width its radius may take
export function roomFit({ w, h, top = 0, bottom = 0, left = 0 }) {
  if (w < 2 || h < 2) return { fit: 1, dx: 0, dy: 0 };
  const freeW = Math.max(1, w - left), freeH = Math.max(1, h - top - bottom);
  let r = RADIUS * Math.min(freeW, freeH);
  if (left > 0 && freeW > freeH) {
    const share = RADIUS + (WIDE_SHARE - RADIUS) * clamp((freeW / freeH - 1) / 0.25, 0, 1);
    r = Math.min(share * freeH, FULL_WIDTH * freeW);
  } else if (left > 0) r = FULL_WIDTH * freeW; // a narrow window: height to spare, so fill the width
  return { fit: clamp(r / (RADIUS * Math.min(w, h)), 0.55, WIDE_SHARE / RADIUS), dx: left / 2, dy: (top - bottom) / 2 };
}

// Day & night. sunDot: how high the sun is at a place (the sine of its height: 1 overhead, 0
// on the horizon, negative below it). The night side is darkened up to NIGHT_ALPHA, starting
// while the sun is still just up (dusk) and full once it is about 13° down; across that band
// the colour goes from twilight to night. City lights fade in through the same band.
export const NIGHT_ALPHA = 0.66;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const nightShade = sunDot => ({ alpha: NIGHT_ALPHA * smooth(0.06, -0.22, sunDot), dark: smooth(0.02, -0.3, sunDot) });
export const lightsOn = sunDot => smooth(0.03, -0.12, sunDot);

// The coastline, on every layer: a dark line COAST_LINE px wide on a light halo COAST_GLOW px wide.
// CSS px at every zoom: the canvas is scaled for the device pixel ratio, and the lines are drawn
// after the globe is projected, so nothing scales them (what non-scaling-stroke does in an SVG).
export const COAST_LINE = 1.5;
export const COAST_GLOW = 3;
// The plate boundaries: 1.5 px for the whole globe, thickening to 2.5 px by zoom 8, with a halo
// COAST_HALO px wider underneath.
export const COAST_HALO = 2;
export const coastWidth = k => 1.5 + clamp(Math.log2(Math.max(1, k)) / 3, 0, 1);
// How many lights (the brightest first) are drawn at zoom k: 1,500 for the whole globe, more as
// it zooms in, all of them from zoom 4.
export const LIGHTS_FAR = 1500;
export const lightCount = (k, n) => Math.min(n, Math.round(LIGHTS_FAR * Math.max(1, k)));

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

// The coastline as lines: each ring of the land without the
// stretches along the map's frame, where Natural Earth cuts its shapes (the antimeridian, the
// South Pole), which are not coast. Returns runs of [lon, lat] points.
export function coastRuns(ring) {
  const n = ring.length, frame = i => onFrame(...ring[i % n]);
  // A segment is coast unless both its ends are on the frame.
  const coast = i => !(frame(i) && frame(i + 1));
  let start = 0;
  while (start < n && coast(start)) start++;
  if (start === n) return [[...ring, ring[0]]]; // all coast: the closed ring
  const runs = [];
  let run = null;
  for (let k = 1; k <= n; k++) {
    const i = (start + k) % n;
    if (coast(i)) { run ??= [ring[i]]; run.push(ring[(i + 1) % n]); } else if (run) { runs.push(run); run = null; }
  }
  if (run) runs.push(run);
  return runs;
}
// Runs → unit vectors with a bounding cap, as prepare() makes for shapes.
export const prepareLines = runs => prepare(runs.map(run => [run])).map(p => ({ ...p, line: p.rings[0] }));

// assets/globe.json stores flat [lon, lat, …] arrays in hundredths of a degree. It is only
// fetched when a globe is first made (the service worker keeps it from then on), so the very
// first time needs the internet: if that fails the promise rejects and is forgotten, and the
// next call tries again.
let land = null;
export function loadLand() {
  land ??= fetch('assets/globe.json').then(r => { if (!r.ok) throw new Error(`${r.status} assets/globe.json`); return r.json(); }).then(d => {
    const unflat = flat => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i] * d.unit, flat[i + 1] * d.unit]); return out; };
    const far = d.far.map(rings => rings.map(unflat)), near = d.near.map(rings => rings.map(unflat));
    const coast = list => prepareLines(list.flatMap(rings => rings.flatMap(coastRuns)));
    return { far: prepare(far), near: prepare(near), coast: { far: coast(far), near: coast(near) } };
  });
  land.catch(() => { land = null; });
  return land;
}

// The home country's outline, above every layer: one line in its own colour on the coastline's
// halo, CSS px at every zoom, and nothing else marks it. Every country's is in one file, the same
// for everyone, so no request says where an explorer is from (CLAUDE.md, SECURITY). Only the
// explorer's own is decoded and drawn: with none set, Taiwan's. A code with no shape draws nothing.
// Lines, not shapes: a big country goes over the horizon, and is cut along the map's frame, and
// neither is its border.
export const HOME_LINE = 2.5;
export const HOME_GLOW = 4;
export const DEFAULT_HOME = 'TW';
export const HOME_OUTLINES = 'assets/layers/home.topo.json';
const homes = new Map();
export function loadHome(code) {
  if (!homes.has(code)) {
    const shape = fetch(HOME_OUTLINES).then(r => { if (!r.ok) throw new Error(`${r.status} ${HOME_OUTLINES}`); return r.json(); })
      .then(topo => prepareLines(decodeTopo(topo, p => p.code === code).flatMap(c => c.polys.flat()).flatMap(coastRuns)));
    shape.catch(() => homes.delete(code));
    homes.set(code, shape);
  }
  return homes.get(code);
}

// Lines of latitude and longitude every 30°, as short segments; the equator on its own, a little
// stronger. Faint, and only while the whole globe shows: gridFade, and --map-grid-* in the tokens.
const gridLine = l => Float32Array.from(l.flatMap(([lon, lat]) => toVec(lon, lat)));
const parallel = lat => { const l = []; for (let lon = -180; lon <= 180; lon += 4) l.push([lon, lat]); return gridLine(l); };
const GRATICULE = (() => {
  const lines = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const l = []; for (let lat = -80; lat <= 80; lat += 4) l.push([lon, lat]); lines.push(gridLine(l));
  }
  for (const lat of [-60, -30, 30, 60]) lines.push(parallel(lat));
  return lines;
})();
const EQUATOR = [parallel(0)];

// How much of the grid shows at zoom k: all of it fully zoomed out, none from goneK on.
export const gridFade = (k, goneK) => Math.min(1, Math.max(0, (goneK - k) / (goneK - MIN_K)));

function tokens(el) {
  const s = getComputedStyle(el);
  const v = name => s.getPropertyValue(name).trim();
  return {
    sea: v('--c-map-sea'), land: v('--c-map-land'), glow: v('--c-map-glow'),
    grid: v('--c-map-grid'), gridOpacity: Number(v('--map-grid-opacity')), equatorOpacity: Number(v('--map-equator-opacity')), gridGoneK: Number(v('--map-grid-gone-k')),
    home: v('--c-map-home'), coast: v('--c-map-coast'), coastHalo: v('--c-map-coast-halo'),
    coastPastOpacity: Number(v('--map-coast-past-opacity')), coastPastDash: parseFloat(v('--map-coast-past-dash')),
    currentDash: parseFloat(v('--map-current-dash')), currentGap: parseFloat(v('--map-current-gap')), currentArrow: parseFloat(v('--map-current-arrow')),
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
// onBase(ok): the base renderer stopped (its context was lost) or came back, so the layer is shown again.
// homeCountry: the explorer's, an ISO code, or null for Taiwan.
// noBase: no WebGL base layer, the 2D canvas draws everything (?debug=2d, to try the fallback).
export function createGlobe(stage, { onFrame, onTap, onInteract, onLand, onBase, homeCountry = null, debug = false, noBase = false } = {}) {
  // Bottom to top: the base layer (WebGL, js/globe-base.js), the 2D canvas for what lies on it, and
  // the overlay. Without the base renderer the 2D canvas draws sea and land itself, with the picture
  // layers (js/globegl.js, made when first needed) between it and the overlay. Only the 2D canvas
  // takes taps.
  const canvas = h('canvas', { class: 'globe__canvas', 'aria-hidden': 'true' });
  const overCanvas = h('canvas', { class: 'globe__canvas globe__canvas--over', 'aria-hidden': 'true' });
  stage.prepend(canvas, overCanvas);
  const baseCtx = canvas.getContext('2d'), overCtx = overCanvas.getContext('2d');
  let ctx = baseCtx; // the canvas being drawn on
  const col = tokens(stage);
  let layer = null;          // see setLayer
  let sphere = null;         // js/globegl.js, once a picture layer has been shown
  let base = null;           // js/globe-base.js, under everything; null without WebGL
  let tiles = null;          // js/globe-tiles.js, once a layer with zoom tiles has been shown
  let tilesFor = null;       // the renderer they go to
  let home = null;
  let seaLevel = 0;          // Topography's sea level, m (seaLevel())
  function setSea(m) {
    seaLevel = Math.min(0, m);
    base?.seaLevel(seaLevel);
    sphere?.seaLevel(seaLevel);
    dirty = true;
  }
  const getHome = () => loadHome(homeCountry || DEFAULT_HOME).then(p => { home = p; dirty = true; }).catch(() => {});

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
  let spinning = false;      // turning by itself this frame
  let wheelAt = -Infinity;   // the last wheel zoom
  const reduced = reducedMotion();

  let gone = false;
  if (!noBase) {
    const el = h('canvas', { class: 'globe__canvas globe__canvas--gl', 'aria-hidden': 'true', hidden: true });
    base = createBase(el, {
      colours: col, shade: 'assets/layers/shade-2k.webp', still: reduced,
      onChange: ok => { tiles?.clear(); dirty = true; onBase?.(ok); }, onDraw: () => { dirty = true; },
    });
    if (base) stage.prepend(el);
  }
  // The land first: it is what the globe opens with. The base renderer's textures follow, and until
  // they are here the 2D canvas draws it.
  const getLand = () => loadLand().then(l => {
    if (gone) return;
    polys = l;
    dirty = true;
    onLand?.(true);
    base?.set(layer?.base ?? PLAIN_BASE).then(() => { useTiles(layer); dirty = true; }).catch(() => {});
  }, () => { if (!gone) onLand?.(false); });
  getLand();

  // What goes under a layer on the base renderer: its own, or the plain map. None for a raster.
  const baseOf = l => (base && !l?.raster ? l?.base ?? PLAIN_BASE : null);
  // Zoom tiles for this layer, on the renderer that shows it.
  function useTiles(next) {
    const wanted = baseOf(next)?.tiles ?? next?.raster?.tiles, to = baseOf(next) ? base : sphere;
    if (wanted && tilesFor !== to) { tiles?.clear(); tiles = createTiles(to, () => { dirty = true; }, wanted); tilesFor = to; }
    if (!wanted) tiles?.clear();
  }

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
  // edge: an outline colour (reefs).
  const fillAll = list => {
    for (const s of list ?? []) {
      if (s.edge) { ctx.strokeStyle = s.edge; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; }
      fillPolys((view.k >= (s.nearK ?? NEAR_K) && s.near) || s.polys, s.fill, Boolean(s.edge), s.curve ?? 0);
    }
  };

  function strokeGrid(lines, opacity) {
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    for (const line of lines) {
      let pen = false;
      for (let i = 0; i < line.length; i += 3) {
        const [x, y, z] = project([line[i], line[i + 1], line[i + 2]]);
        if (z < 0) { pen = false; continue; }
        if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        pen = true;
      }
    }
    ctx.stroke();
  }

  function draw() {
    const { w, h: ht, dpr } = size;
    ctx = baseCtx;
    for (const c of [baseCtx, overCtx]) { c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, ht); }
    const { cx, cy, r } = basis();
    const gl = base?.ready();
    if (gl) {
      if (baseOf(layer)?.tiles) tiles?.update(B, view.k);
      if (base.draw(B, size, view.k)) dirty = true;
    }

    // A thin glow of atmosphere outside the rim while the globe still fits on screen,
    // then the sea. No shading on the disc itself: it would read as a bowl.
    if (!gl && r < Math.max(w, ht)) {
      const g = ctx.createRadialGradient(cx, cy, r * 0.98, cx, cy, r * 1.07);
      g.addColorStop(0, col.glow);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.07, 0, Math.PI * 2); ctx.fill();
    }
    if (!gl) {
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = col.sea; ctx.fill();
    }

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();

    fillAll(layer?.sea);

    // Graticule (near side only). A picture covers it, on either renderer.
    const grid = gridFade(view.k, col.gridGoneK);
    if (grid > 0 && !['picture', 'months'].includes(layer?.base?.kind)) {
      ctx.strokeStyle = col.grid; ctx.lineWidth = 1;
      strokeGrid(GRATICULE, col.gridOpacity * grid);
      strokeGrid(EQUATOR, col.equatorOpacity * grid);
      ctx.globalAlpha = 1;
    }

    if (polys && !gl) fillPolys(view.k >= NEAR_K ? polys.near : polys.far, col.land);
    fillAll(layer?.land);
    if (layer?.currents) drawCurrents(layer.currents); else currentsShown = [];
    if (layer?.night) drawNight(gl || !layer.night.lightsOnly ? layer.night : { ...layer.night, lightsOnly: false });
    ctx.restore();

    // The picture layer, if any, between the two canvases.
    if (sphere) {
      if (layer?.raster?.tiles) tiles?.update(B, view.k);
      if (sphere.draw(B, size)) dirty = true;
    }

    // Above every layer: the coastline, the selected range, the home
    // outline, pin fans.
    ctx = overCtx;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
    if (polys?.coast) drawCoast(view.k >= NEAR_K ? polys.coast.near : polys.coast.far);
    if (layer?.plates) drawPlates(layer.plates);
    if (layer?.volcanoes) drawVolcanoes(layer.volcanoes); else volcShown = [];

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
      tracedLines(home);
      ctx.strokeStyle = col.coastHalo; ctx.lineWidth = HOME_GLOW;
      ctx.stroke();
      ctx.strokeStyle = col.home; ctx.lineWidth = HOME_LINE;
      ctx.stroke();
    }
    ctx.restore();

    onFrame?.({ project, ctx, k: view.k, radius: r });
  }

  // The coastline: a clear dark line (picture layers' own coasts blur when zoomed in), on a light
  // halo so it reads on dark mountains and light deserts, on red and on blue, and small islands
  // don't sink into a hot sea. Lines stop at the horizon. With the sea lower than today it is where
  // the coast is now: faint and dashed, over what used to be land.
  function drawCoast(lines) {
    const past = seaLevel < 0;
    tracedLines(lines, past ? [col.coastPastDash, col.coastPastDash] : null);
    if (past) ctx.globalAlpha = col.coastPastOpacity;
    // One path, stroked twice: the halo, then the line.
    ctx.strokeStyle = col.coastHalo; ctx.lineWidth = COAST_GLOW;
    ctx.stroke();
    ctx.strokeStyle = col.coast; ctx.lineWidth = COAST_LINE;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Lines (prepareLines) as one path, stopping at the horizon. dash: [on, off] px, or null.
  function tracedLines(lines, dash = null) {
    ctx.lineJoin = 'round';
    ctx.lineCap = dash ? 'butt' : 'round';
    ctx.beginPath();
    for (const p of lines) {
      if (!inSight(p)) continue;
      const v = p.line, d = dash && { on: true, left: dash[0] };
      let pen = false, px = 0, py = 0;
      for (let i = 0; i < v.length; i += 3) {
        const Z = v[i] * B.c0 + v[i + 1] * B.c1 + v[i + 2] * B.c2;
        if (Z < 0) { pen = false; continue; }
        const x = B.cx + B.r * (v[i] * B.e0 + v[i + 1] * B.e1), y = B.cy - B.r * (v[i] * B.n0 + v[i + 1] * B.n1 + v[i + 2] * B.n2);
        if (pen && d) dashed(px, py, x, y, d, dash);
        else if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        pen = true; px = x; py = y;
      }
    }
  }
  // One segment of a dashed line: only the "on" parts of the dash pattern, as short lines (a canvas
  // line dash costs far more to draw on a phone or tablet). d: { on, left }, carried from segment to
  // segment so the pattern runs on round corners.
  function dashed(px, py, x, y, d, dash) {
    const dx = x - px, dy = y - py, len = Math.hypot(dx, dy);
    let t = 0;
    while (len - t > 1e-6) {
      const step = Math.min(len - t, d.left);
      if (d.on) { ctx.moveTo(px + (dx * t) / len, py + (dy * t) / len); ctx.lineTo(px + (dx * (t + step)) / len, py + (dy * (t + step)) / len); }
      t += step; d.left -= step;
      if (d.left <= 1e-6) { d.on = !d.on; d.left = d.on ? dash[0] : dash[1]; }
    }
  }

  // Ocean depth's currents: { list (js/layers.js currentLines), warm, cold, halo, phase }. Each a
  // line of dashes the way the water flows, red-orange when warm, blue when cold, on a light halo,
  // with a small arrowhead every --map-current-arrow px, so it shows the way standing still too
  // (reduced motion). Dashes and arrowheads are spaced by how far along the current they are on
  // the globe, so they keep their place as it turns; phase (px) moves them on. Made as short lines
  // (no canvas line dash), one path per colour. The pieces drawn are kept for currentAt (a tap).
  let currentsShown = [];    // [{ p, x0, y0, x1, y1 }] stage px
  function drawCurrents({ list, warm, cold, halo, phase = 0 }) {
    const { w, h: ht, r } = B, M = 40, lw = coastWidth(view.k) + 0.5, head = lw * 2.2;
    const on = col.currentDash, P = on + col.currentGap, A = col.currentArrow;
    const out = (x, y) => (x < -M ? 1 : x > w + M ? 2 : 0) | (y < -M ? 4 : y > ht + M ? 8 : 0);
    currentsShown = [];
    for (const hot of [false, true]) {
      ctx.beginPath();
      for (const p of list) {
        if (p.warm !== hot || !inSight(p)) continue;
        const v = p.line;
        let pen = false, px = 0, py = 0, ps = 0, po = 0;
        for (let i = 0, k = 0; i < v.length; i += 3, k++) {
          const Z = v[i] * B.c0 + v[i + 1] * B.c1 + v[i + 2] * B.c2;
          if (Z < 0) { pen = false; continue; }
          const x = B.cx + r * (v[i] * B.e0 + v[i + 1] * B.e1), y = B.cy - r * (v[i] * B.n0 + v[i + 1] * B.n1 + v[i + 2] * B.n2);
          const sk = p.arc[k] * r, o = out(x, y);
          if (pen && !(po & o) && sk > ps) {
            const len = Math.hypot(x - px, y - py) || 1, ux = (x - px) / len, uy = (y - py) / len;
            const at = t => [px + (x - px) * t, py + (y - py) * t], frac = d => (d - ps) / (sk - ps);
            for (let n = Math.ceil((ps - phase - on) / P); n * P + phase < sk; n++) {
              const a = Math.max(ps, n * P + phase), b = Math.min(sk, n * P + phase + on);
              if (b > a) { ctx.moveTo(...at(frac(a))); ctx.lineTo(...at(frac(b))); }
            }
            for (let n = Math.ceil((ps - phase) / A); n * A + phase < sk; n++) {
              const [cx, cy] = at(frac(n * A + phase));
              ctx.moveTo(cx - ux * head - uy * head * 0.8, cy - uy * head + ux * head * 0.8);
              ctx.lineTo(cx, cy);
              ctx.lineTo(cx - ux * head + uy * head * 0.8, cy - uy * head - ux * head * 0.8);
            }
            currentsShown.push({ p, x0: px, y0: py, x1: x, y1: y });
          }
          pen = true; px = x; py = y; ps = sk; po = o;
        }
      }
      ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
      ctx.strokeStyle = halo; ctx.lineWidth = lw + 2.5;
      ctx.stroke();
      ctx.strokeStyle = hot ? warm : cold; ctx.lineWidth = lw;
      ctx.stroke();
    }
  }

  // Plates & Volcanoes: the plate boundaries, in three styles, and each major plate's arrow.
  //   apart (pulling apart): a double line, a light stripe between two red ones;
  //   crash (crashing together): a line with teeth on the side of the plate on top (side 1:
  //     left walking along the line, -1 right, 0 both);
  //   slide (sliding past): a dashed line.
  // Lines go into one path per style, built from the points on the near side and on screen; a
  // stretch beyond one edge of the screen lifts the pen (as traceRing does for shapes).
  // plates: { far, near: [{ kind, side, line, c, r }], motion: [{ v, ahead, speed }], colour,
  // halo, gap (the stripe in a double line), arrow, arrowEdge }.
  const TOOTH_GAP = 16, TOOTH = 4; // px between teeth, and their size (times the line width / 1.5)
  const TOOTH_TURNS = 32;
  // A tooth s px long pointing the way of turn (of TOOTH_TURNS round), its base in the middle of
  // the picture; drawn at the device's pixel ratio so it stays sharp.
  const toothSprites = new Map();
  function toothSprite(s, turn, colour) {
    const key = `${s}|${turn}|${colour}|${size.dpr}`;
    if (!toothSprites.has(key)) {
      const box = Math.ceil(s * 2 + 4), c = document.createElement('canvas');
      c.width = c.height = Math.ceil(box * size.dpr);
      const g = c.getContext('2d'), a = (turn / TOOTH_TURNS) * 2 * Math.PI, nx = Math.cos(a), ny = Math.sin(a);
      g.scale(size.dpr, size.dpr);
      g.translate(box / 2, box / 2);
      g.beginPath();
      g.moveTo(ny * s * 0.6, -nx * s * 0.6); g.lineTo(nx * s, ny * s); g.lineTo(-ny * s * 0.6, nx * s * 0.6); g.closePath();
      g.fillStyle = colour; g.fill();
      if (toothSprites.size > 400) toothSprites.clear();
      toothSprites.set(key, { c, size: box });
    }
    return toothSprites.get(key);
  }
  // dash: [on, off] px: the dashes are made as short lines (dashed()).
  function platePath(list, kind, teeth, dash) {
    const { w, h: ht } = B, M = 40;
    const out = (x, y) => (x < -M ? 1 : x > w + M ? 2 : 0) | (y < -M ? 4 : y > ht + M ? 8 : 0);
    ctx.beginPath();
    for (const p of list) {
      if (p.kind !== kind || !inSight(p)) continue;
      const v = p.line;
      let px = 0, py = 0, pen = false, po = 0, along = TOOTH_GAP / 2;
      const d = dash && { on: true, left: dash[0] }; // the dash pattern: on or off, and how much of it is left
      for (let i = 0; i < v.length; i += 3) {
        const Z = v[i] * B.c0 + v[i + 1] * B.c1 + v[i + 2] * B.c2;
        if (Z < 0) { pen = false; continue; }
        const x = B.cx + B.r * (v[i] * B.e0 + v[i + 1] * B.e1), y = B.cy - B.r * (v[i] * B.n0 + v[i + 1] * B.n1 + v[i + 2] * B.n2);
        const o = out(x, y);
        if (pen && (po & o)) { px = x; py = y; po = o; continue; } // both beyond the same edge
        if (pen && d) dashed(px, py, x, y, d, dash);
        else if (pen) {
          ctx.lineTo(x, y);
          if (teeth) {
            // Teeth every TOOTH_GAP px along the line, on the side of the plate on top.
            const dx = x - px, dy = y - py, len = Math.hypot(dx, dy);
            for (; along < len; along += TOOTH_GAP) teeth.push(px + (dx * along) / len, py + (dy * along) / len, dx / len, dy / len, p.side);
            along -= len;
          }
        } else ctx.moveTo(x, y);
        pen = true; px = x; py = y; po = o;
      }
    }
  }
  function drawPlates({ far, near, motion, colour, halo, gap, arrow, arrowEdge }) {
    const list = view.k >= NEAR_K ? near : far, w = coastWidth(view.k);
    ctx.lineJoin = 'bevel'; ctx.lineCap = 'butt';
    const stroke = (style, width) => { ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke(); };
    // Sliding past: dashed.
    platePath(list, 'slide', null, [w * 3, w * 2.5]);
    stroke(halo, w + COAST_HALO); stroke(colour, w);
    // Pulling apart: two lines with a light stripe between them (a wide line, then the stripe
    // over it; cutting the middle out with destination-out cost about 10 fps on a tablet).
    platePath(list, 'apart');
    stroke(colour, w * 3 + 1); stroke(gap, w);
    // Crashing together: a line and its teeth.
    const teeth = [];
    platePath(list, 'crash', teeth);
    stroke(halo, w + COAST_HALO); stroke(colour, w);
    // The teeth: one small picture per direction (TOOTH_TURNS of them), stamped (many little
    // filled paths cost a tablet far more to draw).
    const s = Math.round(((TOOTH * w) / 1.5) * 2) / 2;
    for (let i = 0; i < teeth.length; i += 5) {
      const x = teeth[i], y = teeth[i + 1], ux = teeth[i + 2], uy = teeth[i + 3], side = teeth[i + 4];
      for (const sd of side ? [side] : [1, -1]) {
        // To the left of the way along, on screen (y down): (uy, -ux) for side 1.
        const turn = Math.round((Math.atan2(-ux * sd, uy * sd) / (2 * Math.PI)) * TOOTH_TURNS + TOOTH_TURNS) % TOOTH_TURNS;
        const img = toothSprite(s, turn, colour), half = img.size / 2;
        ctx.drawImage(img.c, x - half, y - half, img.size, img.size);
      }
    }
    // Each major plate's arrow: which way it moves, the longer the faster.
    for (const m of motion) {
      const [x, y, z] = project(m.v);
      if (z < 0.2) continue;
      const [x2, y2] = project(m.ahead);
      const dx = x2 - x, dy = y2 - y, d = Math.hypot(dx, dy);
      if (d < 1e-6) continue;
      const L = ARROW_PX * Math.min(1, m.speed / ARROW_TOP) * Math.max(0.35, z), ux = dx / d, uy = dy / d;
      drawArrow(x - (ux * L) / 2, y - (uy * L) / 2 + ARROW_BELOW, ux, uy, L, arrow, arrowEdge);
    }
  }
  // The longest arrow (px), at ARROW_TOP mm/yr; its middle ARROW_BELOW px under the plate's name.
  const ARROW_PX = 56, ARROW_TOP = 75, ARROW_BELOW = 44;

  // Volcanoes: small triangles. The whole globe shows the notable ones (erupted since 1964, and
  // Taiwan's); from zoom VOLC_ALL_K all of them. Where each was drawn is kept for volcanoAt().
  const VOLC_ALL_K = 2.5, VOLC_HIT = 22; // px: half a 44 px touch target
  let volcShown = [];
  function drawVolcanoes({ list, fill, edge }) {
    const all = view.k >= VOLC_ALL_K, { w, h: ht } = B;
    volcShown = [];
    const big = volcSprite(7, fill, edge), small = volcSprite(5, fill, edge);
    for (const v of list) {
      if (!v.notable && !all) break; // the notable ones come first
      const [x, y, z] = project(v.v);
      if (z < 0.05 || x < -20 || y < -20 || x > w + 20 || y > ht + 20) continue;
      const img = v.notable ? big : small;
      ctx.drawImage(img.c, x - img.size / 2, y - img.size / 2, img.size, img.size);
      volcShown.push({ v, x, y });
    }
  }
  // A volcano triangle (s px from its middle to its top) with its edge, as a small picture.
  const volcSprites = new Map();
  function volcSprite(s, fill, edge) {
    const key = `${s}|${fill}|${edge}|${size.dpr}`;
    if (!volcSprites.has(key)) {
      const box = Math.ceil(s * 2 + 6), c = document.createElement('canvas');
      c.width = c.height = Math.ceil(box * size.dpr);
      const g = c.getContext('2d');
      g.scale(size.dpr, size.dpr);
      g.translate(box / 2, box / 2);
      g.beginPath(); g.moveTo(0, -s); g.lineTo(s * 0.95, s * 0.7); g.lineTo(-s * 0.95, s * 0.7); g.closePath();
      g.lineJoin = 'round'; g.lineWidth = 2; g.strokeStyle = edge; g.stroke();
      g.fillStyle = fill; g.fill();
      volcSprites.set(key, { c, size: box });
    }
    return volcSprites.get(key);
  }
  function drawArrow(x, y, ux, uy, L, fill, edge) {
    const hw = 3.5, head = 11, hh = 8; // half width of the shaft, head length and half width (px)
    const nx = -uy, ny = ux, bx = x + ux * (L - head), by = y + uy * (L - head);
    ctx.beginPath();
    ctx.moveTo(x + nx * hw, y + ny * hw);
    ctx.lineTo(bx + nx * hw, by + ny * hw);
    ctx.lineTo(bx + nx * hh, by + ny * hh);
    ctx.lineTo(x + ux * L, y + uy * L);
    ctx.lineTo(bx - nx * hh, by - ny * hh);
    ctx.lineTo(bx - nx * hw, by - ny * hw);
    ctx.lineTo(x - nx * hw, y - ny * hw);
    ctx.closePath();
    ctx.lineWidth = 2; ctx.strokeStyle = edge; ctx.stroke();
    ctx.fillStyle = fill; ctx.fill();
  }

  // A soft glow: white in the middle, the colour, then clear. One per colour, stamped.
  const sprites = new Map();
  function glow(colour) {
    if (!sprites.has(colour)) {
      const d = 24;
      const c = document.createElement('canvas');
      c.width = c.height = d * 2;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(d, d, 0, d, d, d);
      grad.addColorStop(0, '#fff');
      grad.addColorStop(0.18, colour);
      grad.addColorStop(1, `${colour.slice(0, 7)}00`); // the same colour, clear (not black)
      g.fillStyle = grad;
      g.fillRect(0, 0, d * 2, d * 2);
      sprites.set(colour, c);
    }
    return sprites.get(colour);
  }

  // Day & night: the night side darkened, with its twilight band, worked out on a small
  // buffer (one value every NIGHT_PX px, smoothed up to the screen and clipped to the globe),
  // then the city lights glowing through it, added onto what is below (no WebGL).
  // night: { sun (unit vector), lights: { vecs, b (0–1), brightest first }, shade, twilight
  // ([r, g, b] 0–255), light (colour) }.
  const NIGHT_PX = 4, LUT_N = 1024;
  let shadeBuf = null, lut = null;
  // nightShade for sunDot -1…1 in LUT_N steps, as one RGBA pixel each (in the buffer's byte
  // order), so each buffer pixel is a single write.
  function shadeLut(shade, twilight) {
    const key = `${shade}|${twilight}`;
    if (lut?.key === key) return lut.px;
    const bytes = new Uint8ClampedArray(LUT_N * 4);
    for (let i = 0; i < LUT_N; i++) {
      const { alpha, dark } = nightShade((i / (LUT_N - 1)) * 2 - 1);
      for (let c = 0; c < 3; c++) bytes[i * 4 + c] = twilight[c] + (shade[c] - twilight[c]) * dark;
      bytes[i * 4 + 3] = 255 * alpha;
    }
    lut = { key, px: new Uint32Array(bytes.buffer) };
    return lut.px;
  }
  function drawNight({ sun, lights, shade, twilight, light, lightsOnly }) {
    const { cx, cy, r, w, h: ht } = B;
    if (!lightsOnly) nightSide(sun, shade, twilight);
    drawLights(sun, lights, light);
  }
  function nightSide(sun, shade, twilight) {
    const { cx, cy, r, w, h: ht } = B;
    const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(w, Math.ceil(cx + r)), y1 = Math.min(ht, Math.ceil(cy + r));
    if (x1 <= x0 || y1 <= y0) return;
    const bw = Math.ceil((x1 - x0) / NIGHT_PX) + 2, bh = Math.ceil((y1 - y0) / NIGHT_PX) + 2;
    if (shadeBuf?.c.width !== bw || shadeBuf.c.height !== bh) {
      const c = document.createElement('canvas');
      c.width = bw; c.height = bh;
      const g = c.getContext('2d');
      const img = g.createImageData(bw, bh);
      shadeBuf = { c, g, img, px: new Uint32Array(img.data.buffer) };
    }
    const px = shadeBuf.px, table = shadeLut(shade, twilight), toLut = (LUT_N - 1) / 2;
    // The sun in screen terms: east, north and towards the viewer.
    const Se = sun[0] * B.e0 + sun[1] * B.e1;
    const Sn = sun[0] * B.n0 + sun[1] * B.n1 + sun[2] * B.n2;
    const Sc = sun[0] * B.c0 + sun[1] * B.c1 + sun[2] * B.c2;
    for (let j = 0, o = 0; j < bh; j++) {
      const Y0 = (cy - (y0 + (j - 0.5) * NIGHT_PX)) / r;
      for (let i = 0; i < bw; i++, o++) {
        let X = (x0 + (i - 0.5) * NIGHT_PX - cx) / r, Y = Y0, Z = 0;
        const rr = X * X + Y * Y;
        if (rr > 1) { const m = 1 / Math.sqrt(rr); X *= m; Y *= m; } // off the rim: as at the rim
        else Z = Math.sqrt(1 - rr);
        const dot = X * Se + Y * Sn + Z * Sc;
        px[o] = table[((dot < -1 ? -1 : dot > 1 ? 1 : dot) + 1) * toLut | 0];
      }
    }
    shadeBuf.g.putImageData(shadeBuf.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shadeBuf.c, 0, 0, bw, bh, x0 - NIGHT_PX, y0 - NIGHT_PX, bw * NIGHT_PX, bh * NIGHT_PX);
  }
  // The lights: the brightest first, more of them zoomed in; on the near side, on screen,
  // and only where the sun is down (fading in through the twilight).
  function drawLights(sun, lights, light) {
    const { cx, cy, r, w, h: ht } = B;
    const sprite = glow(light), { vecs, b } = lights;
    const n = lightCount(view.k, b.length), s0 = clamp(2.4 * Math.sqrt(view.k), 2.4, 10);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0, j = 0; i < n; i++, j += 3) {
      const vx = vecs[j], vy = vecs[j + 1], vz = vecs[j + 2];
      const Z = vx * B.c0 + vy * B.c1 + vz * B.c2;
      if (Z <= 0) continue;
      const on = lightsOn(vx * sun[0] + vy * sun[1] + vz * sun[2]);
      if (on <= 0) continue;
      const x = cx + r * (vx * B.e0 + vy * B.e1), y = cy - r * (vx * B.n0 + vy * B.n1 + vz * B.n2);
      const s = s0 * (0.6 + 0.9 * b[i]);
      if (x < -s || y < -s || x > w + s || y > ht + s) continue;
      ctx.globalAlpha = on * (0.35 + 0.65 * b[i]);
      ctx.drawImage(sprite, x - s, y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------- the loop ----------
  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(50, t - (last || t));
    last = t;
    spinning = false;
    if (glide) {
      rotateBy(glide.vx * dt, glide.vy * dt);
      const f = Math.exp(-dt / GLIDE);
      glide.vx *= f; glide.vy *= f;
      if (Math.hypot(glide.vx, glide.vy) < 0.005) glide = null;
    } else if (!flight && !paused && !reduced) {
      const ease = spinEase(t - lastTouch, view.k);
      spinning = ease > 0;
      if (ease) {
        view.lon = wrap(view.lon - (SPIN * dt * ease) / 1000);
        dirty = true;
      }
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
          el.textContent = `${Math.round((frames * 1000) / (t - from))} fps · draw ${(sum / frames).toFixed(1)} ms (max ${max.toFixed(1)}) · ${base?.ready() ? 'webgl base' : 'current'} · dpr ${size.dpr}`;
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
    wheelAt = performance.now();
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
    onTap?.(invert(x, y), { x, y });
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
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    for (const c of [canvas, overCanvas]) { c.width = Math.round(w * dpr); c.height = Math.round(ht * dpr); }
    size = { w, h: ht, dpr, r: Math.min(w, ht) * RADIUS };
    applyRoom();
    dirty = true;
  });
  ro.observe(stage);
  raf = requestAnimationFrame(frame);

  return {
    ready: loadLand(),
    // Whether the base layers come from js/globe-base.js just now: only then has a layer's gpu() any use.
    get usesBase() { return Boolean(base && !base.lost); },
    get k() { return view.k; },
    get radius() { return size.r * fit; },
    // Being moved, or moving by itself: a finger on it, gliding on, flying or zooming somewhere, a
    // wheel just turned, or its slow turn. (Day & night's clock waits for it.)
    get moving() { return fingers.size > 0 || Boolean(glide || flight) || spinning || performance.now() - wheelAt < WHEEL_HOLD; },
    redraw() { dirty = true; },
    retry() { if (!polys) getLand(); if (!home) getHome(); },
    // Fetch the home outlines: in idle time, once the globe has drawn.
    loadHome: getHome,
    // ?debug=fps only: draw n frames in a row, turning 1° each, and time them (ms), to compare
    // drawing cost without depending on the display's frame rate.
    ...(debug && {
      // The volcanoes drawn in the last frame, where (stage px): for tests.
      volcanoesShown: () => volcShown.map(s => ({ en: s.v.name.en, x: s.x, y: s.y })),
      // [x, y, depth] of a place on the stage now: for checking the picture against the outlines.
      at(lon, lat) { basis(); return project(toVec(lon, lat)); },
      // Where Day & night has the sun just now, or null.
      sun: () => layer?.night?.sun ?? null,
      // Topography's sea level just now, m.
      level: () => seaLevel,
      // Ocean depth's currents: where their dashes are (phase, px) and how many pieces were drawn.
      currents: () => (layer?.currents ? { phase: layer.currents.phase ?? 0, drawn: currentsShown.length } : null),
      bench(n = 60) {
        const times = [];
        for (let i = 0; i < n; i++) { view.lon = wrap(view.lon + 1); const t0 = performance.now(); draw(); baseCtx.getImageData(0, 0, 1, 1); overCtx.getImageData(0, 0, 1, 1); times.push(performance.now() - t0); } // reading a pixel back waits until the frame is really drawn
        times.sort((x, y) => x - y);
        return { mean: times.reduce((s, x) => s + x, 0) / n, median: times[n >> 1], p95: times[Math.floor(n * 0.95)], max: times[n - 1] };
      },
    }),
    pause(on) { paused = on; if (!on) lastTouch = performance.now(); },
    // A touch somewhere else on the Globe screen (the toolbar, a chip): stop turning, for now.
    noteTouch() { lastTouch = performance.now(); },
    // Room at the bottom (px) for the card sheet: the globe slides up to stay in view.
    setOffset(px) { held = px > 0; offset = -px / 2; dirty = true; },
    // Space the globe keeps clear: top (the chips), bottom (a sheet), left (the side panel), px.
    setRoom(top, bottom, left = 0) { room = top || bottom || left ? { top, bottom, left } : null; applyRoom(); dirty = true; },
    // polys: GeoJSON-style [[ [lon, lat]… ]…] lists, or null to clear.
    setRange(list, group) { range = list ? { polys: prepare(list), colour: col.group(group) } : null; dirty = true; },
    // A map layer, or null for the plain globe:
    //   sea:    [{ polys, near?, fill, edge? }] drawn on the sea, under the land (prepare())
    //   land:   [{ polys, near?, fill }] drawn on the land
    //   night:  { sun, lights, shade, twilight, light }: day & night (drawNight)
    //   plates: { far, near, motion, colour, halo, gap, arrow, arrowEdge }: plate boundaries (drawPlates)
    //   raster: a js/globegl.js spec, drawn above sea and land; with tiles (js/globe-tiles.js
    //           RELIEF_TILES), sharper pictures fetched for the view once zoomed in
    //   base:   a js/globe-base.js layer, under the 2D canvases; with tiles, as for raster. A layer
    //           with none has the plain map there, and what it has lies on top
    // Resolves when the layer is showing; rejects if its pictures can't be shown.
    async setLayer(next) {
      layer = next;
      setSea(0);
      dirty = true;
      await base?.set(next?.base ?? PLAIN_BASE);
      if (next?.raster && !sphere) {
        const { createSphere } = await import('./globegl.js');
        const glCanvas = h('canvas', { class: 'globe__canvas globe__canvas--gl', 'aria-hidden': 'true' });
        sphere = createSphere(glCanvas, { still: reduced, onLoad: () => { dirty = true; } });
        if (!sphere) throw new Error('WebGL 2 is not available');
        overCanvas.before(glCanvas);
      }
      await sphere?.set(next?.raster ?? null);
      useTiles(next);
      dirty = true;
    },
    // Topography: the sea level, m (0 today; below 0 the sea it leaves is land, and the coast dashed).
    seaLevel: m => setSea(m),
    // Temperature: to this place in the year (js/globe-months.js), morphing over ms, or at once.
    month(pos, ms = 0) { base?.month(pos, ms); dirty = true; },
    // Fetch the months in idle time, this one first.
    loadMonths(first) { base?.loadMonths(first); },
    // Change the layer's settings (e.g. where the sun is) without reloading it.
    updateLayer(patch) {
      if (layer?.night) Object.assign(layer.night, patch);
      if (layer?.currents && 'phase' in patch) layer.currents.phase = patch.phase;
      base?.update(patch);
      if (layer?.raster) sphere?.update(patch);
      dirty = true;
    },
    // The current drawn nearest (x, y) on the stage, within a 44 px touch target: { id, name, lon, lat }
    // (the point on it nearest the tap), or null.
    currentAt(x, y) {
      let best = null, bd = VOLC_HIT * VOLC_HIT;
      for (const s of currentsShown) {
        const dx = s.x1 - s.x0, dy = s.y1 - s.y0, t = clamp(((x - s.x0) * dx + (y - s.y0) * dy) / (dx * dx + dy * dy || 1), 0, 1);
        const qx = s.x0 + dx * t, qy = s.y0 + dy * t, d = (qx - x) ** 2 + (qy - y) ** 2;
        if (d < bd) { bd = d; best = { s, qx, qy }; }
      }
      const ll = best && invert(best.qx, best.qy);
      return ll ? { id: best.s.p.id, name: best.s.p.name, lon: ll[0], lat: ll[1] } : null;
    },
    // The volcano drawn nearest (x, y) on the stage, within a 44 px touch target, or null.
    volcanoAt(x, y) {
      let best = null, bd = VOLC_HIT * VOLC_HIT;
      for (const s of volcShown) { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bd) { bd = d; best = s.v; } }
      return best;
    },
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
      base?.destroy();
      Object.assign(saved, { lon: view.lon, lat: view.lat, k: view.k });
    },
  };
}
