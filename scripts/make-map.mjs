#!/usr/bin/env node
// Draws assets/world.svg (an equirectangular land map used for the "where in the world"
// maps) from Natural Earth's 1:110m land data, which is in the public domain.
// Run once: node scripts/make-map.mjs. The output is committed.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getJson, setUserAgent } from './lib/http.mjs';
import { readFile } from 'node:fs/promises';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson';

// Must match MAP in js/worldmap.js.
const MAP = { north: 84, south: -58, pxPerDegree: 2 };
const W = 360 * MAP.pxPerDegree;
const H = (MAP.north - MAP.south) * MAP.pxPerDegree;

const cfg = JSON.parse(await readFile(path.join(ROOT, 'scripts/build.config.json'), 'utf8'));
setUserAgent(cfg.userAgent);
const geo = await getJson(SOURCE);

const pt = ([lon, lat]) => [
  ((lon + 180) * MAP.pxPerDegree).toFixed(1),
  ((MAP.north - Math.max(MAP.south, Math.min(MAP.north, lat))) * MAP.pxPerDegree).toFixed(1),
];
const ring = coords => 'M' + coords.map(c => pt(c).join(' ')).join('L') + 'Z';

const parts = [];
for (const f of geo.features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) parts.push(poly.map(ring).join(''));
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<!-- Land: Natural Earth 1:110m (public domain), naturalearthdata.com -->
<path fill="#000" fill-rule="evenodd" d="${parts.join('')}"/>
</svg>
`;
await mkdir(path.join(ROOT, 'assets'), { recursive: true });
await writeFile(path.join(ROOT, 'assets/world.svg'), svg, 'utf8');
console.log(`wrote assets/world.svg (${(svg.length / 1024).toFixed(0)} KB, ${parts.length} land shapes)`);
