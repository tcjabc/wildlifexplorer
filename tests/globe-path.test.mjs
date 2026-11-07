// The globe's outlines (js/globe.js traceRing): straight, or as gentle curves for the depth
// bands. Curves stop at clip points (the horizon, the map's edges, where outlines meet) and
// the depth bands still nest. Also keeps the depth files at the forests' density.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { traceRing, prepare, hardPoints } from '../js/globe.js';
import { DEPTH_CURVE } from '../js/layers.js';
import { decodeTopo } from '../js/topo.js';

const DEG = Math.PI / 180;
// The same basis as js/globe.js basis(), for a view of w × h px at lon, lat, zoom k.
function basisFor(lon, lat, k, w = 1180, h = 820) {
  const l = lon * DEG, p = lat * DEG, cl = Math.cos(l), sl = Math.sin(l), cp = Math.cos(p), sp = Math.sin(p);
  return { c0: cp * cl, c1: cp * sl, c2: sp, e0: -sl, e1: cl, n0: -sp * cl, n1: -sp * sl, n2: cp, cx: w / 2, cy: h / 2, r: Math.min(w, h) * 0.42 * k, w, h };
}

// A canvas stand-in that records the path.
function recorder() {
  const cmds = [];
  return {
    cmds,
    moveTo: (x, y) => cmds.push(['M', x, y]),
    lineTo: (x, y) => cmds.push(['L', x, y]),
    quadraticCurveTo: (qx, qy, x, y) => cmds.push(['Q', x, y, qx, qy]),
    arc: (cx, cy, r, a0, a1, ccw) => cmds.push(['A', cx + r * Math.cos(a1), cy + r * Math.sin(a1), cx, cy, r, a0, a1, ccw]),
    closePath: () => cmds.push(['Z']),
  };
}
// The path as polygons (curves and rim arcs sampled), for point-in-polygon tests.
function flatten(cmds) {
  const rings = []; let ring = null, x = 0, y = 0;
  for (const c of cmds) {
    if (c[0] === 'M') { ring = [[c[1], c[2]]]; rings.push(ring); }
    else if (c[0] === 'L') ring.push([c[1], c[2]]);
    else if (c[0] === 'Q') { for (const t of [0.25, 0.5, 0.75, 1]) { const u = 1 - t; ring.push([u * u * x + 2 * u * t * c[3] + t * t * c[1], u * u * y + 2 * u * t * c[4] + t * t * c[2]]); } }
    else if (c[0] === 'A') {
      const [, , , cx, cy, r, a0, a1, ccw] = c; let d = a1 - a0;
      if (ccw && d > 0) d -= 2 * Math.PI; if (!ccw && d < 0) d += 2 * Math.PI;
      for (let i = 1; i <= 12; i++) ring.push([cx + r * Math.cos(a0 + (d * i) / 12), cy + r * Math.sin(a0 + (d * i) / 12)]);
    }
    if (c[0] !== 'Z') [x, y] = [c[1], c[2]];
  }
  return rings;
}
// Distance from a point to the nearest edge of the rings.
function distance(rings, px, py) {
  let best = Infinity;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, ay] = r[j], [bx, by] = r[i], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0;
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}
function inside(rings, px, py) {
  let hit = false;
  for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
const ringOf = pts => { const r = pts.map(([lon, lat]) => [lon, lat]); return r; };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// Every rim arc starts where a straight line reached the rim, and the path then carries on
// from where the arc ended; no curve uses a point beyond the horizon.
function assertClipRules(cmds, B, label) {
  const onRim = (x, y) => near(Math.hypot(x - B.cx, y - B.cy), B.r, 1e-3 * B.r);
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    if (c[0] === 'A') {
      const before = cmds[i - 1];
      assert.ok(before && before[0] === 'L', `${label}: a line (not a curve) reaches the rim before arc ${i}`);
      assert.ok(onRim(before[1], before[2]), `${label}: that line ends on the rim`);
    }
    if (c[0] === 'Q') {
      assert.ok(Math.hypot(c[3] - B.cx, c[4] - B.cy) <= B.r * (1 + 1e-6), `${label}: curve ${i} bends round a point in sight`);
      assert.ok(Math.hypot(c[1] - B.cx, c[2] - B.cy) <= B.r * (1 + 1e-6), `${label}: curve ${i} ends in sight`);
    }
  }
}

test('straight outlines (f = 0) are plain lines, as before', () => {
  const [p] = prepare([[ringOf([[0, 0], [10, 0], [10, 10], [0, 10]])]]);
  const rec = recorder();
  assert.equal(traceRing(rec, p.rings[0], basisFor(5, 5, 1)), true);
  assert.deepEqual(rec.cmds.map(c => c[0]).join(''), 'MLLLZ');
});

test('curves stop at the horizon: the rim is reached by straight lines, never across it', () => {
  // A ring round the globe's edge as seen from lon 0: half of it is round the back.
  const pts = []; for (let a = 0; a < 360; a += 5) pts.push([90 + 40 * Math.cos(a * DEG), 40 * Math.sin(a * DEG)]);
  const [p] = prepare([[ringOf(pts)]], { edges: true });
  const B = basisFor(0, 0, 1);
  const rec = recorder();
  assert.equal(traceRing(rec, p.rings[0], B, DEPTH_CURVE), true);
  const kinds = rec.cmds.map(c => c[0]);
  assert.ok(kinds.includes('A'), 'it goes round the rim');
  assert.ok(kinds.includes('Q'), 'and is curved in sight');
  assertClipRules(rec.cmds, B, 'ring across the horizon');
});

test('curves pass exactly through hard points (the antimeridian, where outlines meet) and keep straight between them', () => {
  const ring = ringOf([[170, 0], [175, -1], [180, 0], [180, 10], [180, 20], [175, 21], [170, 20], [168, 10]]);
  const hard = hardPoints(ring);
  assert.deepEqual([...hard], [0, 0, 1, 1, 1, 0, 0, 0]);
  const [p] = prepare([[ring]], { edges: true });
  const B = basisFor(175, 10, 2);
  const rec = recorder();
  traceRing(rec, p.rings[0], B, DEPTH_CURVE);
  const straight = recorder();
  traceRing(straight, p.rings[0], B); // its points are the projected vertices
  const P = straight.cmds.filter(c => c[0] !== 'Z').map(c => [c[1], c[2]]);
  const ends = rec.cmds.filter(c => c[0] === 'L' || c[0] === 'M').map(c => [c[1], c[2]]);
  for (const i of [2, 3, 4]) assert.ok(ends.some(([x, y]) => near(x, P[i][0]) && near(y, P[i][1])), `hard point ${i} is on the path`);
  // From (180, 0) to (180, 10) to (180, 20): straight lines in a row.
  const at = i => rec.cmds.findIndex(c => (c[0] === 'L' || c[0] === 'M') && near(c[1], P[i][0]) && near(c[2], P[i][1]));
  assert.equal(rec.cmds[at(2) + 1][0], 'L'); assert.equal(at(3), at(2) + 1);
  assert.equal(rec.cmds[at(3) + 1][0], 'L'); assert.equal(at(4), at(3) + 1);
  assert.ok(rec.cmds.some(c => c[0] === 'Q'), 'the rest is curved');

  // TopoJSON: where two arcs meet is a hard point of each ring.
  const topo = {
    type: 'Topology', transform: { scale: [1, 1], translate: [0, 0] },
    arcs: [[[0, 0], [10, 0], [0, 10]], [[10, 10], [-10, 0], [0, -10]]],
    objects: { x: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', arcs: [[0, 1]], properties: {} }] } },
  };
  const [g] = decodeTopo(topo);
  const r0 = g.polys[0][0];
  assert.deepEqual(r0.map(q => q.join(',')), ['0,0', '10,0', '10,10', '0,10']);
  assert.deepEqual(r0.joins, [0, 2]);
  assert.deepEqual([...hardPoints(r0)], [1, 0, 1, 0]);
});

// ---------- the real depth bands ----------

const topo = name => decodeTopo(JSON.parse(readFileSync(new URL(`../assets/layers/${name}.topo.json`, import.meta.url), 'utf8')));
const BANDS = [200, 1000, 4000, 6000]; // js/layers.js DEPTHS: where the ocean zones meet
const VIEWS = [
  { name: 'Indian Ocean, whole globe', lon: 78, lat: -15, k: 1, file: 'depth-far' },
  // The detailed depth file from zoom 5 (js/layers.js DEPTH_NEAR_K), the far one before.
  { name: 'Pacific, zoomed in', lon: -160, lat: 22, k: 4, file: 'depth-far' },
  { name: 'Pacific, closer', lon: -160, lat: 22, k: 6, file: 'depth' },
  { name: "Taiwan's waters", lon: 121, lat: 23.5, k: 8, file: 'depth' },
];

function bandPaths(file, B, f) {
  const shapes = topo(file);
  return BANDS.map(d => {
    const polys = prepare(shapes.filter(s => s.props.depth === d).flatMap(s => s.polys), { edges: true });
    const rec = recorder();
    for (const p of polys) for (const ring of p.rings) traceRing(rec, ring, B, f);
    return rec.cmds;
  });
}

for (const view of VIEWS) {
  test(`depth bands still nest with curves, and stop at clip points: ${view.name}`, () => {
    const B = basisFor(view.lon, view.lat, view.k);
    const curved = bandPaths(view.file, B, DEPTH_CURVE);
    const straight = bandPaths(view.file, B, 0);
    curved.forEach((cmds, i) => assertClipRules(cmds, B, `${view.name}, ${BANDS[i]} m`));
    const onScreen = ([x, y]) => x >= 0 && x <= 1180 && y >= 0 && y <= 820 && Math.hypot(x - B.cx, y - B.cy) < B.r;
    for (let i = 0; i + 1 < BANDS.length; i++) {
      const outside = (paths, step) => {
        const shallow = flatten(paths[i]);
        const pts = flatten(paths[i + 1]).flat().filter(onScreen);
        let n = 0, seen = 0;
        // Really outside: not inside, and more than a pixel from the shallower outline (bands
        // share outlines where the sea floor drops steeply; points on them are on both).
        for (let j = 0; j < pts.length; j += step) { seen++; if (!inside(shallow, ...pts[j]) && distance(shallow, ...pts[j]) > 1) n++; }
        return { n, seen };
      };
      const step = 5;
      const c = outside(curved, step), s = outside(straight, step);
      if (process.env.SHOW_NESTING) console.log(`${view.name}: ${BANDS[i + 1]} in ${BANDS[i]}: curved ${c.n}/${c.seen}, straight ${s.n}/${s.seen}`);
      // Every deeper band stays inside the one above it, with curves as without.
      assert.equal(s.n, 0, `${view.name}: straight ${BANDS[i + 1]} m outside ${BANDS[i]} m at ${s.n} of ${s.seen} points`);
      assert.ok(c.n === 0,
        `${view.name}: ${BANDS[i + 1]} m outside ${BANDS[i]} m at ${c.n} of ${c.seen} points (straight: ${s.n} of ${s.seen})`);
    }
  });
}

test('the depth files have the forests\' density: no long straight edges across the oceans', () => {
  const R = Math.PI / 180;
  const arc = (a, b) => { const s1 = Math.sin((b[1] - a[1]) * R / 2), s2 = Math.sin((b[0] - a[0]) * R / 2); return 2 * Math.asin(Math.min(1, Math.sqrt(s1 * s1 + Math.cos(a[1] * R) * Math.cos(b[1] * R) * s2 * s2))) / R; };
  const frame = p => Math.abs(Math.abs(p[0]) - 180) < 0.05 || Math.abs(p[1]) > 89;
  const lengths = file => {
    const out = [];
    for (const g of topo(file)) for (const poly of g.polys) for (const r of poly) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if (!(frame(a) && frame(b))) out.push(arc(a, b));
    }
    return out.sort((x, y) => x - y);
  };
  for (const [file, median, p99, max] of [['depth', [0.15, 0.3], 1.2, 2], ['depth-far', [0.5, 0.85], 3, 4]]) {
    const l = lengths(file);
    const m = l[l.length >> 1];
    assert.ok(m >= median[0] && m <= median[1], `${file}: median ${m.toFixed(3)}°`);
    assert.ok(l[Math.floor(l.length * 0.99)] <= p99, `${file}: 99% under ${p99}°`);
    assert.ok(l[l.length - 1] <= max, `${file}: longest ${l[l.length - 1].toFixed(2)}°`);
  }
});

test('leaving out points far off the screen never changes what is filled on screen', () => {
  const land = JSON.parse(readFileSync(new URL('../assets/globe.json', import.meta.url), 'utf8'));
  const unflat = flat => { const out = []; for (let i = 0; i < flat.length; i += 2) out.push([flat[i] * land.unit, flat[i + 1] * land.unit]); return out; };
  const landNear = prepare(land.near.map(rings => rings.map(unflat)));
  for (const view of VIEWS) {
    const B = basisFor(view.lon, view.lat, view.k), open = { ...B, w: undefined, h: undefined };
    const layers = [
      ...BANDS.map(d => [`${d} m`, prepare(topo(view.file).filter(s => s.props.depth === d).flatMap(s => s.polys), { edges: true }), DEPTH_CURVE]),
      ['land', landNear, 0],
    ];
    for (const [name, polys, f] of layers) {
      for (const p of polys) {
        const a = recorder(), b = recorder();
        for (const ring of p.rings) { traceRing(a, ring, B, f); traceRing(b, ring, open, f); }
        if (!b.cmds.length) continue;
        const culled = flatten(a.cmds), whole = flatten(b.cmds);
        for (let gx = 0; gx <= 1180; gx += 59) for (let gy = 0; gy <= 820; gy += 41) {
          if (Math.hypot(gx - B.cx, gy - B.cy) >= B.r) continue;
          assert.equal(inside(culled, gx, gy), inside(whole, gx, gy), `${view.name}, ${name}: (${gx}, ${gy})`);
        }
      }
    }
  }
});

test('the depth bands are the ocean zones: 200, 1,000, 4,000 and 6,000 m, each with a label in both languages', async () => {
  const { DEPTHS } = await import('../js/layers.js');
  assert.deepEqual(DEPTHS, [200, 1000, 4000, 6000]);
  for (const file of ['depth', 'depth-far']) {
    const levels = [...new Set(topo(file).map(s => s.props.depth))].sort((a, b) => a - b);
    assert.deepEqual(levels, DEPTHS, file);
  }
  for (const lang of ['en', 'zh-TW']) {
    const s = JSON.parse(readFileSync(new URL(`../lang/${lang}.json`, import.meta.url), 'utf8'));
    for (let i = 0; i <= DEPTHS.length; i++) assert.ok(s[`layer.depth.${i}`], `${lang} layer.depth.${i}`);
  }
});
