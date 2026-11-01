#!/usr/bin/env node
// Draws assets/world.svg, the land shape used by every "where in the world" map, from
// Natural Earth's 1:50m land data (public domain). Run once: node scripts/make-map.mjs.
//
// Coordinates are twentieths of a degree: x = longitude × 20, y = −latitude × 20, so a map can
// zoom to any area just by setting its viewBox (see js/worldmap.js). The path has id="land"
// and no fill of its own, so the app colours it from the design tokens.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, setUserAgent } from './lib/http.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson';
const UNIT = 20;   // map units per degree (0.05° ≈ 5 km): smooth even zoomed in on Taiwan

const cfg = JSON.parse(await readFile(path.join(ROOT, 'scripts/build.config.json'), 'utf8'));
setUserAgent(cfg.userAgent);
const geo = await getJson(SOURCE);

// Integer points with relative moves ("l dx dy") keep the path short.
function ring(coords) {
  const pts = [];
  for (const [lon, lat] of coords) {
    const p = [Math.round(lon * UNIT), Math.round(-lat * UNIT)];
    const prev = pts.at(-1);
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) pts.push(p);
  }
  if (pts.length < 3) return '';
  const [first, ...rest] = pts;
  let d = `M${first[0]} ${first[1]}l`, [x, y] = first;
  d += rest.map(([px, py]) => { const s = `${px - x} ${py - y}`; x = px; y = py; return s; }).join(' ');
  return d + 'z';
}

const parts = [];
for (const f of geo.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) parts.push(poly.map(ring).join(''));
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-3600 -1680 7200 2840">
<!-- Land: Natural Earth 1:50m (public domain), naturalearthdata.com. x = longitude × 20, y = −latitude × 20. -->
<path id="land" fill-rule="evenodd" d="${parts.join('')}"/>
</svg>
`;
await mkdir(path.join(ROOT, 'assets'), { recursive: true });
await writeFile(path.join(ROOT, 'assets/world.svg'), svg, 'utf8');
console.log(`wrote assets/world.svg (${(svg.length / 1024).toFixed(0)} KB, ${parts.length} land shapes)`);
