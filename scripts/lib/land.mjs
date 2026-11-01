// Natural Earth 1:50m land polygons (public domain), for clipping ranges to land or sea.
// Downloaded once into .cache/ (git-ignored).
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getJson } from './http.mjs';

const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson';

function bboxOf(rings) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return { west: w, south: s, east: e, north: n };
}

// Each polygon: { rings: [[[lon, lat], …], …], bbox }. The first ring is the coastline,
// any others are holes (big lakes).
export async function loadLand(root) {
  const file = path.join(root, '.cache/ne_50m_land.geojson');
  let geo;
  if (existsSync(file)) geo = JSON.parse(await readFile(file, 'utf8'));
  else {
    geo = await getJson(SOURCE);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(geo));
  }
  const polys = [];
  for (const f of geo.features) {
    const list = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of list) polys.push({ rings, bbox: bboxOf(rings) });
  }
  return polys;
}

// Even-odd ray casting over all rings of one polygon.
export function inPolygon(poly, x, y) {
  const b = poly.bbox;
  if (x < b.west || x > b.east || y < b.south || y > b.north) return false;
  let inside = false;
  for (const ring of poly.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export const overlaps = (a, b) => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;
