// Turning a cut-out mask into a small SVG outline, and the simple shapes that refine one
// (scripts/make-figures.mjs). Plain geometry, no dependencies: points are [x, y] arrays.

// The outer edge of a 0/1 mask (one shape, holes already filled), walked along the pixel edges
// with the shape on the right. Corners only, in pixel-corner coordinates.
export function trace(mask, w, h) {
  const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const s = mask.indexOf(1);
  if (s < 0) return [];
  const sx = s % w, sy = (s - sx) / w;
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
  // The pixels ahead-left and ahead-right of a vertex, heading right, down, left, up.
  const ahead = (x, y, d) => (d === 0 ? [x, y - 1, x, y] : d === 1 ? [x, y, x - 1, y] : d === 2 ? [x - 1, y, x - 1, y - 1] : [x - 1, y - 1, x, y - 1]);
  let x = sx, y = sy, d = 0;
  const pts = [[x, y]];
  for (let guard = 4 * (w + 1) * (h + 1); guard > 0; guard--) {
    x += DX[d]; y += DY[d];
    if (x === sx && y === sy) break;
    const [lx, ly, rx, ry] = ahead(x, y, d);
    const nd = !at(rx, ry) ? (d + 1) % 4 : at(lx, ly) ? (d + 3) % 4 : d;
    if (nd !== d) { pts.push([x, y]); d = nd; }
  }
  return pts;
}

// Ramer–Douglas–Peucker on a closed outline: no point of the original is more than eps away.
export function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  const rdp = a => {
    if (a.length < 3) return a;
    const [x1, y1] = a[0], [x2, y2] = a[a.length - 1];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    let best = 0, bi = 0;
    for (let i = 1; i < a.length - 1; i++) {
      const dd = Math.abs(dy * a[i][0] - dx * a[i][1] + x2 * y1 - y2 * x1) / len;
      if (dd > best) { best = dd; bi = i; }
    }
    if (best <= eps) return [a[0], a[a.length - 1]];
    return rdp(a.slice(0, bi + 1)).slice(0, -1).concat(rdp(a.slice(bi)));
  };
  // Split the loop at the point farthest from the first, so both halves are open curves.
  let far = 0, fi = 0;
  pts.forEach((p, i) => { const dd = Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]); if (dd > far) { far = dd; fi = i; } });
  return rdp(pts.slice(0, fi + 1)).slice(0, -1).concat(rdp(pts.slice(fi).concat([pts[0]])).slice(0, -1));
}

// Points every `step` along a closed outline (so it can be bent without long straight edges).
export function resample(pts, step) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
  }
  return out;
}

// A closed, smooth path: quadratic curves through the midpoints, each point their control.
// Coordinates are rounded to whole units (the figures are drawn 1000 units on their long side).
export function smoothPath(pts) {
  const P = pts.map(([x, y]) => [Math.round(x), Math.round(y)]);
  const n = P.length;
  const mid = (a, b) => [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)];
  const xy = p => `${p[0]} ${p[1]}`;
  let d = `M${xy(mid(P[n - 1], P[0]))}`;
  for (let i = 0; i < n; i++) d += `Q${xy(P[i])} ${xy(mid(P[i], P[(i + 1) % n]))}`;
  return `${d.replace(/ -/g, '-')}Z`;
}

// Points along a quadratic or cubic Bézier curve (3 or 4 control points).
export function bezier(c, n = 32) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    if (c.length === 3) out.push([0, 1].map(k => u * u * c[0][k] + 2 * u * t * c[1][k] + t * t * c[2][k]));
    else out.push([0, 1].map(k => u * u * u * c[0][k] + 3 * u * u * t * c[1][k] + 3 * u * t * t * c[2][k] + t * t * t * c[3][k]));
  }
  return out;
}

// A tapering stroke along a centre line, as a closed outline: w0 wide at the start, w1 at the end,
// with a round tip at the end (a tail, a branch).
export function taper(line, w0, w1) {
  const n = line.length, left = [], right = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const half = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    left.push([line[i][0] - (dy / len) * half, line[i][1] + (dx / len) * half]);
    right.push([line[i][0] + (dy / len) * half, line[i][1] - (dx / len) * half]);
  }
  // The round tip: a half circle from the left edge to the right one, around the last point.
  const [ex, ey] = line[n - 1], [px, py] = line[n - 2];
  const along = Math.atan2(ey - py, ex - px), cap = [];
  for (let k = 1; k < 8; k++) {
    const t = along + Math.PI / 2 - (Math.PI * k) / 8;
    cap.push([ex + Math.cos(t) * (w1 / 2), ey + Math.sin(t) * (w1 / 2)]);
  }
  return left.concat(cap, right.reverse());
}

// Bends a horizontal strip (a straight piece of hair) along a centre curve, tapering it:
// x runs along the strip from x0 to x1 around the line y = yc. curve(t) gives [y offset, …]
// as a fraction of the length for t in 0…1; width(t) scales the thickness.
export function bend(pts, { x0, x1, yc }, curve, width) {
  const L = x1 - x0;
  const at = t => [x0 + t * L, yc + curve(t) * L];
  return pts.map(([x, y]) => {
    const t = Math.min(1, Math.max(0, (x - x0) / L));
    const [cx, cy] = at(t);
    const e = 1e-3, a = at(Math.max(0, t - e)), b = at(Math.min(1, t + e));
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const off = (y - yc) * width(t);
    return [cx - (dy / len) * off, cy + (dx / len) * off];
  });
}

// The box around a set of outlines and circles ([cx, cy, r]).
export function bounds(outlines, circles = []) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const o of outlines) for (const [x, y] of o) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  for (const [cx, cy, r] of circles) { x0 = Math.min(x0, cx - r); y0 = Math.min(y0, cy - r); x1 = Math.max(x1, cx + r); y1 = Math.max(y1, cy + r); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}
