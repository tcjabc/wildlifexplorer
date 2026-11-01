// Turns occurrence points into a soft range shape (GeoJSON MultiPolygon).
//
//  1. Bin the points into a grid sized to the range; drop isolated cells (outliers).
//  2. Close small gaps and grow the shape by one cell (a buffer).
//  3. Clip on the grid to land (land animals) or sea (marine animals), using Natural Earth.
//     Which one is decided by where the points themselves fall.
//  4. Islands the range mostly covers are filled with the island's real coastline
//     (so a Taiwan endemic simply fills Taiwan).
//  5. Trace the cell outlines, straighten the steps, round them off (Chaikin) and simplify.
// Never uses IUCN range maps; only the points it is given.
import { inPolygon, overlaps } from './land.mjs';

const MIN_POINTS = 20;

const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
const r3 = v => Math.round(v * 1000) / 1000;

// ---------- grid helpers ----------

function morph(mask, cols, rows, grow) {
  const out = new Uint8Array(mask.length);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let any = false, all = true;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      const v = rr >= 0 && rr < rows && cc >= 0 && cc < cols ? mask[rr * cols + cc] : 0;
      if (v) any = true; else all = false;
    }
    out[r * cols + c] = grow ? (any ? 1 : 0) : (all ? 1 : 0);
  }
  return out;
}

// Outline of the filled cells as closed rings of grid corners. Edges run with the filled
// cell on their left, so outer rings come out counter-clockwise and holes clockwise.
function traceRings(mask, cols, rows) {
  const filled = (c, r) => c >= 0 && c < cols && r >= 0 && r < rows && mask[r * cols + c] === 1;
  const edges = new Map(); // "x,y" -> [[x2, y2], …]
  const add = (x1, y1, x2, y2) => {
    const k = `${x1},${y1}`;
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push([x2, y2]);
  };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!filled(c, r)) continue;
    if (!filled(c, r - 1)) add(c, r, c + 1, r);
    if (!filled(c + 1, r)) add(c + 1, r, c + 1, r + 1);
    if (!filled(c, r + 1)) add(c + 1, r + 1, c, r + 1);
    if (!filled(c - 1, r)) add(c, r + 1, c, r);
  }
  const rings = [];
  const take = (x, y, dx, dy) => {
    const list = edges.get(`${x},${y}`);
    if (!list?.length) return null;
    // Where two cells touch only at a corner, keep turning left so each ring stays simple.
    let best = 0;
    if (list.length > 1 && dx !== undefined) {
      const turn = ([nx, ny]) => dx * (ny - y) - dy * (nx - x); // >0 left, 0 straight, <0 right
      best = list.reduce((bi, e, i) => (turn(e) > turn(list[bi]) ? i : bi), 0);
    }
    const [next] = list.splice(best, 1);
    if (!list.length) edges.delete(`${x},${y}`);
    return next;
  };
  while (edges.size) {
    const [startKey] = edges.keys();
    const [sx, sy] = startKey.split(',').map(Number);
    const ring = [[sx, sy]];
    let [x, y] = [sx, sy], dx, dy;
    for (let guard = 0; guard < 1e6; guard++) {
      const next = take(x, y, dx, dy);
      if (!next) break;
      dx = next[0] - x; dy = next[1] - y;
      [x, y] = next;
      if (x === sx && y === sy) break;
      ring.push([x, y]);
    }
    if (ring.length >= 4) rings.push(ring);
  }
  return rings;
}

// ---------- line helpers ----------

function chaikin(ring, times) {
  let pts = ring;
  for (let t = 0; t < times; t++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by], [0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by]);
    }
    pts = out;
  }
  return pts;
}

function simplify(points, tol) {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const len = Math.hypot(bx - ax, by - ay) || 1e-12;
    let worst = -1, dist = 0;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - points[i][1]) - (ax - points[i][0]) * (by - ay)) / len;
      if (d > dist) { dist = d; worst = i; }
    }
    if (dist > tol && worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

// Simplify a closed ring and close it the GeoJSON way (first point repeated at the end).
// A closed ring starts and ends at the same point, which would give Douglas–Peucker a
// zero-length baseline, so it is split at the point farthest from the start.
function tidyRing(ring, tol) {
  const [x0, y0] = ring[0];
  let far = 1;
  ring.forEach(([x, y], i) => { if (Math.hypot(x - x0, y - y0) > Math.hypot(ring[far][0] - x0, ring[far][1] - y0)) far = i; });
  const open = [...simplify(ring.slice(0, far + 1), tol), ...simplify([...ring.slice(far), ring[0]], tol).slice(1, -1)];
  if (open.length < 3) return null;
  const pts = open.map(([x, y]) => [r3(x), r3(y)]);
  return [...pts, pts[0]];
}

const signedArea = ring => {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return a / 2;
};

function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Outer rings (counter-clockwise) with their holes (clockwise) → MultiPolygon coordinates.
function toPolygons(rings) {
  const outers = rings.filter(r => signedArea(r) > 0).map(r => [r]);
  for (const hole of rings.filter(r => signedArea(r) < 0)) {
    const owner = outers.find(p => inRing(p[0], hole[0][0], hole[0][1]));
    if (owner) owner.push(hole);
  }
  return outers;
}

// ---------- the range ----------

// points: [[lon, lat], …]. land: polygons from loadLand(). Returns null if there is too little.
export function makeRange(points, land) {
  if (points.length < MIN_POINTS) return null;

  // Ignore the farthest 1% each way before sizing the grid.
  const lons = points.map(p => p[0]).sort((a, b) => a - b);
  const lats = points.map(p => p[1]).sort((a, b) => a - b);
  const box0 = { west: percentile(lons, 0.01), east: percentile(lons, 0.99), south: percentile(lats, 0.01), north: percentile(lats, 0.99) };
  const span = Math.max(box0.east - box0.west, box0.north - box0.south);
  const cell = Math.min(2, Math.max(0.05, span / 40));
  const pad = 3 * cell;
  const west = box0.west - pad, south = box0.south - pad;
  const cols = Math.ceil((box0.east - box0.west + 2 * pad) / cell);
  const rows = Math.ceil((box0.north - box0.south + 2 * pad) / cell);
  const gridBox = { west, south, east: west + cols * cell, north: south + rows * cell };

  // 1. Bin, then drop cells with a single record and no neighbours.
  const counts = new Uint16Array(cols * rows);
  for (const [x, y] of points) {
    const c = Math.floor((x - west) / cell), r = Math.floor((y - south) / cell);
    if (c >= 0 && c < cols && r >= 0 && r < rows) counts[r * cols + c]++;
  }
  let mask = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const n = counts[r * cols + c];
    if (!n) continue;
    let neighbours = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if ((dr || dc) && counts[(r + dr) * cols + (c + dc)]) neighbours++;
    }
    if (n >= 2 || neighbours) mask[r * cols + c] = 1;
  }
  // 2. Close gaps and buffer: grow twice, shrink once.
  mask = morph(morph(morph(mask, cols, rows, true), cols, rows, true), cols, rows, false);

  // 3. Land or sea, from where the points themselves are.
  const nearby = land.filter(p => overlaps(p.bbox, gridBox));
  const landAt = (x, y) => nearby.findIndex(p => inPolygon(p, x, y));
  const sample = points.length > 400 ? points.filter((_, i) => i % Math.ceil(points.length / 400) === 0) : points;
  const onLand = sample.filter(([x, y]) => landAt(x, y) >= 0).length / sample.length;
  const habitat = onLand >= 0.6 ? 'land' : onLand <= 0.25 ? 'sea' : 'coast';

  const cellLand = new Int32Array(cols * rows).fill(-1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    cellLand[r * cols + c] = landAt(west + (c + 0.5) * cell, south + (r + 0.5) * cell);
  }
  if (habitat === 'land') for (let i = 0; i < mask.length; i++) { if (cellLand[i] < 0) mask[i] = 0; }
  if (habitat === 'sea') for (let i = 0; i < mask.length; i++) { if (cellLand[i] >= 0) mask[i] = 0; }

  // 4. Islands mostly inside the range: use the real coastline instead of cells.
  const islands = [];
  if (habitat !== 'sea') {
    const gridArea = (gridBox.east - gridBox.west) * (gridBox.north - gridBox.south);
    nearby.forEach((poly, idx) => {
      const b = poly.bbox;
      if ((b.east - b.west) * (b.north - b.south) > gridArea * 4) return; // continents: no
      // How many cells does the whole island have, and how many are in the range?
      let total = 0;
      for (let y = b.south + cell / 2; y < b.north; y += cell) for (let x = b.west + cell / 2; x < b.east; x += cell) {
        if (inPolygon(poly, x, y)) total++;
      }
      let covered = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i] && cellLand[i] === idx) covered++;
      if (covered && covered / Math.max(1, total) >= 0.5) {
        islands.push(poly);
        for (let i = 0; i < mask.length; i++) if (cellLand[i] === idx) mask[i] = 0;
      }
    });
  }

  // 5. Outline → smooth → simplify, in degrees.
  const toDeg = ring => ring.map(([c, r]) => [west + c * cell, south + r * cell]);
  // Straighten the cell staircase first (simplify by most of a cell), then round the corners.
  const traced = traceRings(mask, cols, rows)
    .map(ring => tidyRing(toDeg(ring), cell * 0.75))
    .filter(Boolean)
    .map(ring => tidyRing(chaikin(ring.slice(0, -1), 3), cell * 0.08))
    .filter(Boolean);
  const polygons = toPolygons(traced);
  for (const poly of islands) {
    const rings = poly.rings.map(ring => tidyRing(ring.slice(0, -1), Math.min(cell * 0.1, 0.02))).filter(Boolean);
    if (rings.length) polygons.push(rings);
  }
  if (!polygons.length) return null;

  let bw = Infinity, bs = Infinity, be = -Infinity, bn = -Infinity;
  for (const poly of polygons) for (const [x, y] of poly[0]) {
    if (x < bw) bw = x; if (x > be) be = x; if (y < bs) bs = y; if (y > bn) bn = y;
  }
  return {
    geometry: { type: 'MultiPolygon', coordinates: polygons },
    bbox: { west: r3(bw), south: r3(bs), east: r3(be), north: r3(bn) },
    habitat,
    cellDegrees: r3(cell),
    islands: islands.length,
  };
}
