#!/usr/bin/env node
// Draws assets/globe.json, the land shapes for the Globe view, from Natural Earth's 1:50m
// land data (public domain). Run once: node scripts/make-globe.mjs.
//
// Two levels of detail: "far" (coastlines simplified hard, tiny islands left out) is drawn
// when the whole globe is in view; "near" keeps the 1:50m detail for zooming in. Each
// polygon is a list of rings (coastline, then any lakes) as flat [lon, lat, lon, lat, …]
// arrays in hundredths of a degree.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setUserAgent } from './lib/http.mjs';
import { loadLand } from './lib/land.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LODS = [
  { name: 'far', tol: 0.35, minArea: 1.5 },   // degrees; area in square degrees
  { name: 'near', tol: 0.04, minArea: 0 },
];

const cfg = JSON.parse(await readFile(path.join(ROOT, 'scripts/build.config.json'), 'utf8'));
setUserAgent(cfg.userAgent);
const land = await loadLand(ROOT);

// Douglas–Peucker on an open line.
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

// A closed ring is split at its farthest point so the line has a real baseline.
function simplifyRing(ring, tol) {
  const pts = ring.slice(0, -1);
  if (pts.length < 4) return pts;
  let far = 0, best = -1;
  pts.forEach(([x, y], i) => { const d = Math.hypot(x - pts[0][0], y - pts[0][1]); if (d > best) { best = d; far = i; } });
  const a = simplify(pts.slice(0, far + 1), tol);
  const b = simplify([...pts.slice(far), pts[0]], tol);
  return [...a, ...b.slice(1, -1)];
}

const area = ring => Math.abs(ring.reduce((s, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length];
  return s + x * ny - nx * y;
}, 0) / 2);

const q = v => Math.round(v * 100);
const out = { source: 'Natural Earth 1:50m land (public domain), naturalearthdata.com', unit: 0.01 };
for (const lod of LODS) {
  const polys = [];
  let points = 0;
  for (const poly of land) {
    if (area(poly.rings[0]) < lod.minArea) continue;
    const rings = poly.rings.map(r => simplifyRing(r, lod.tol)).filter(r => r.length >= 3 && area(r) >= lod.minArea / 4);
    if (!rings.length) continue;
    polys.push(rings.map(r => r.flatMap(([x, y]) => [q(x), q(y)])));
    points += rings.reduce((s, r) => s + r.length, 0);
  }
  out[lod.name] = polys;
  console.log(`${lod.name}: ${polys.length} polygons, ${points} points`);
}

await mkdir(path.join(ROOT, 'assets'), { recursive: true });
const json = JSON.stringify(out);
await writeFile(path.join(ROOT, 'assets/globe.json'), json + '\n', 'utf8');
console.log(`wrote assets/globe.json (${(json.length / 1024).toFixed(0)} KB)`);
