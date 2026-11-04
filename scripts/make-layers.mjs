#!/usr/bin/env node
// Makes the Globe's map layers (assets/layers/) and the home outline (assets/home.json)
// from big public datasets. Run: node scripts/make-layers.mjs [relief tiles night temp depth
// forests reefs home] (no names = all).
//
// Raw downloads go into data-raw/ (git-ignored) and are reused. Only the small processed
// files are committed. Sources and licences: CREDITS.md.
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import mapshaper from 'mapshaper';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data-raw');
const OUT = path.join(ROOT, 'assets/layers');
const HOME = 'TWN';        // Natural Earth ADM0_A3 of the home country
const TEMP_YEAR = 2024;    // months shown by the temperature layer

sharp.cache(false);
const big = { limitInputPixels: false };

const SOURCES = {
  relief: 'https://naciscdn.org/naturalearth/50m/raster/NE1_50M_SR_W.zip',
  height: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_21600x10800.png',
  night: 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg',
  depth: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_bathymetry_all.zip',
  reefs: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_reefs.zip',
  countries: 'https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip',
  forests: 'https://storage.googleapis.com/teow2016/Ecoregions2017.zip',
};
const GIBS = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const TEMP = [
  { layer: 'MODIS_Terra_L3_Land_Surface_Temp_Monthly_Day', colormap: 'MODIS_Land_Surface_Temp', kelvin: true },
  { layer: 'MODIS_Aqua_L3_SST_Thermal_4km_Day_Monthly', colormap: 'MODIS_Sea_Surface_Temperature', kelvin: false },
];

// ---------- downloads ----------

async function download(url, file) {
  if (existsSync(file)) return file;
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

// A zip from SOURCES, unpacked into data-raw/<name>/ (tar ships with Windows 10+ too).
async function unpacked(key) {
  const url = SOURCES[key];
  const zip = await download(url, path.join(RAW, path.basename(url)));
  const dir = zip.replace(/\.zip$/, '');
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
    execFileSync('tar', ['-xf', zip, '-C', dir]);
  }
  return dir;
}

async function find(dir, re) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const hit = await find(p, re); if (hit) return hit; }
    else if (re.test(e.name)) return p;
  }
  return null;
}

const kb = async file => `${((await readFile(file)).length / 1024).toFixed(0)} KB`;

async function webp(input, name, width, opts = {}) {
  const file = path.join(OUT, name);
  await sharp(input, big).resize(width, width / 2, { kernel: 'lanczos3' }).webp({ quality: 80, effort: 6, ...opts }).toFile(file);
  console.log(`  ${name} ${await kb(file)}`);
}

// Colours and stops from css/tokens.css, so the app and the pictures agree.
async function token(name) {
  const css = await readFile(path.join(ROOT, 'css/tokens.css'), 'utf8');
  const m = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`missing ${name} in tokens.css`);
  return m[1].trim();
}

// ---------- picture layers ----------

// Topography zoom tiles: the same picture at TILE_LEVEL × TILE_LEVEL/2 px, cut into TILE × TILE
// tiles (16 × 8 of them, 22.5° each), assets/layers/relief-tiles/<row>-<col>.webp, row 0 at
// the top (90° N), column 0 at 180° W. The globe fetches only the ones in view once zoomed in
// (js/globegl.js); keep these numbers in step with RELIEF_TILES in js/layers.js.
const TILE_LEVEL = 8192, TILE = 512;
async function tiles() {
  const tif = await find(await unpacked('relief'), /.tif$/i);
  const dir = path.join(OUT, 'relief-tiles');
  await mkdir(dir, { recursive: true });
  const big8k = await sharp(tif, big).resize(TILE_LEVEL, TILE_LEVEL / 2, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = big8k.info;
  let total = 0;
  for (let row = 0; row < height / TILE; row++) {
    for (let col = 0; col < width / TILE; col++) {
      const file = path.join(dir, `${row}-${col}.webp`);
      await sharp(big8k.data, { raw: { width, height, channels } })
        .extract({ left: col * TILE, top: row * TILE, width: TILE, height: TILE })
        .webp({ quality: 80, effort: 6 }).toFile(file);
      total += (await readFile(file)).length;
    }
  }
  console.log(`  relief-tiles: ${(width / TILE) * (height / TILE)} tiles, ${(total / 1048576).toFixed(1)} MB`);
}

async function relief() {
  const tif = await find(await unpacked('relief'), /\.tif$/i);
  await webp(tif, 'relief-4k.webp', 4096);
  await webp(tif, 'relief-2k.webp', 2048);
  // Height for the bump lighting: grey, sea level 0.
  const png = await download(SOURCES.height, path.join(RAW, path.basename(SOURCES.height)));
  const file = path.join(OUT, 'height-2k.webp');
  await sharp(png, big).resize(2048, 1024, { kernel: 'lanczos3' }).greyscale().webp({ quality: 90 }).toFile(file);
  console.log(`  height-2k.webp ${await kb(file)}`);
}

// City lights as points: the picture (13,500 × 6,750, about 3 km a pixel) in cells of
// LIGHT_CELL × LIGHT_CELL pixels (0.21°); each cell's light is what its pixels have above
// the unlit land (LIGHT_BASE). The brightest LIGHTS cells are kept, each at the
// brightness-weighted middle of its lights, brightest first (the globe shows the first ones
// zoomed out and more as it zooms in). b: 1–99, the cell's light (square root, so small towns
// still show).
const LIGHT_CELL = 8, LIGHT_BASE = 60, LIGHTS = 6000;
async function night() {
  const jpg = await download(SOURCES.night, path.join(RAW, path.basename(SOURCES.night)));
  const { data, info: { width: W, height: H } } = await sharp(jpg, big).greyscale().raw().toBuffer({ resolveWithObject: true });
  const C = LIGHT_CELL, cw = Math.floor(W / C), ch = Math.floor(H / C);
  const sum = new Float64Array(cw * ch), sx = new Float64Array(cw * ch), sy = new Float64Array(cw * ch);
  for (let y = 0; y < ch * C; y++) {
    for (let x = 0; x < cw * C; x++) {
      const v = data[y * W + x] - LIGHT_BASE;
      if (v <= 0) continue;
      const i = ((y / C) | 0) * cw + ((x / C) | 0);
      sum[i] += v; sx[i] += v * (x + 0.5); sy[i] += v * (y + 0.5);
    }
  }
  const cells = [];
  for (let i = 0; i < sum.length; i++) if (sum[i] > 0) cells.push(i);
  cells.sort((a, b) => sum[b] - sum[a]);
  const kept = cells.slice(0, LIGHTS), top = sum[kept[0]];
  const points = [];
  for (const i of kept) {
    const lon = (sx[i] / sum[i] / W) * 360 - 180, lat = 90 - (sy[i] / sum[i] / H) * 180;
    points.push(Math.round(lon * 100), Math.round(lat * 100), Math.max(1, Math.round(99 * Math.sqrt(sum[i] / top))));
  }
  const file = path.join(OUT, 'lights.json');
  await writeFile(file, JSON.stringify({ source: 'NASA Earth Observatory, Black Marble 2016 (public domain)', unit: 0.01, points }) + '\n');
  console.log(`  lights.json ${kept.length} lights (of ${cells.length} lit cells), ${await kb(file)}`);
}

// GIBS colour maps → a lookup (r, g, b) => °C, null for "no data", undefined if unknown.
// LST is in kelvin, SST in °C. Colours that aren't in the map (blended where GIBS scales
// the picture) take the value of the nearest colour, if one is close.
async function colormap(name, kelvin) {
  const file = await download(`https://gibs.earthdata.nasa.gov/colormaps/v1.3/${name}.xml`, path.join(RAW, `${name}.xml`));
  const xml = await readFile(file, 'utf8');
  const key = (r, g, b) => (r << 16) | (g << 8) | b;
  const map = new Map(), entries = [];
  for (const m of xml.matchAll(/<ColorMapEntry rgb="(\d+),(\d+),(\d+)"([^>]*)>/g)) {
    const [r, g, b] = [m[1], m[2], m[3]].map(Number);
    const range = m[4].match(/ value="\[([-\d.]+),([-\d.]+)\)"/);
    if (!range || m[4].includes('nodata="true"')) { map.set(key(r, g, b), null); continue; }
    const v = (Number(range[1]) + Number(range[2])) / 2 - (kelvin ? 273.15 : 0);
    map.set(key(r, g, b), v);
    entries.push([r, g, b, v]);
  }
  return (r, g, b) => {
    const k = key(r, g, b);
    if (!map.has(k)) {
      let best, d = 30 * 30; // farther than this: leave the pixel out
      for (const [er, eg, eb, v] of entries) {
        const dd = (er - r) ** 2 + (eg - g) ** 2 + (eb - b) ** 2;
        if (dd < d) { d = dd; best = v; }
      }
      map.set(k, best);
    }
    return map.get(k);
  };
}

const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));

// Small holes (a month of clouds over a rainforest) take the average of their
// neighbours, one pixel further in on each pass. Big empty areas (polar night) stay.
function fillGaps(px, W, H, passes) {
  for (let pass = 0; pass < passes; pass++) {
    const src = Buffer.from(px);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      if (src[o + 3]) continue;
      let n = 0, r = 0, g = 0, b = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = (x + dx + W) % W;
        if (yy < 0 || yy >= H) continue;
        const q = (yy * W + xx) * 4;
        if (src[q + 3]) { n++; r += src[q]; g += src[q + 1]; b += src[q + 2]; }
      }
      if (n >= 3) { px[o] = r / n; px[o + 1] = g / n; px[o + 2] = b / n; px[o + 3] = 255; }
    }
  }
}

async function temp() {
  // "-30 #3b2a8f, -15 #2f6fd6, …": °C and colour.
  const stops = (await token('--c-temp-scale')).split(',').map(s => {
    const [v, c] = s.trim().split(/\s+/);
    return { v: Number(v), rgb: hex(c) };
  });
  const paint = v => {
    if (v <= stops[0].v) return stops[0].rgb;
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1], b = stops[i];
      if (v <= b.v) { const t = (v - a.v) / (b.v - a.v); return a.rgb.map((x, k) => Math.round(x + (b.rgb[k] - x) * t)); }
    }
    return stops.at(-1).rgb;
  };
  const maps = await Promise.all(TEMP.map(t => colormap(t.colormap, t.kelvin)));
  const W = 2048, H = 1024;
  for (let month = 1; month <= 12; month++) {
    const mm = String(month).padStart(2, '0');
    const out = Buffer.alloc(W * H * 4);
    let missing = 0;
    // Sea first, then land on top (land has no sea values and the other way round).
    for (const [i, t] of [...TEMP.entries()].reverse()) {
      const q = new URLSearchParams({
        SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: '1.3.0', LAYERS: t.layer, STYLES: '', CRS: 'EPSG:4326',
        BBOX: '-90,-180,90,180', WIDTH: W, HEIGHT: H, FORMAT: 'image/png', TRANSPARENT: 'TRUE', TIME: `${TEMP_YEAR}-${mm}-01`,
      });
      const png = await download(`${GIBS}?${q}`, path.join(RAW, `${t.layer}_${TEMP_YEAR}-${mm}.png`));
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const valueOf = maps[i];
      for (let p = 0, o = 0; p < data.length; p += info.channels, o += 4) {
        if (data[p + 3] < 128) continue;
        const v = valueOf(data[p], data[p + 1], data[p + 2]);
        if (v === null) continue;
        if (v === undefined) { missing++; continue; }
        const [r, g, b] = paint(v);
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
      }
    }
    fillGaps(out, W, H, 4);
    const file = path.join(OUT, `temp-${mm}.webp`);
    await sharp(out, { raw: { width: W, height: H, channels: 4 } }).webp({ quality: 78, alphaQuality: 60, effort: 6 }).toFile(file);
    console.log(`  temp-${mm}.webp ${await kb(file)}${missing ? ` (${missing} pixels with unknown colours skipped)` : ''}`);
  }
}

// ---------- shapes (mapshaper) ----------

async function ms(commands) {
  await mapshaper.runCommands(commands);
}

async function depth() {
  const dir = await unpacked('depth');
  // Natural Earth has a polygon layer per depth (0, 200, 1000 … 10000 m), each covering
  // everything at least that deep. These four are where the ocean's zones meet (NOAA /
  // National Weather Service JetStream, Layers of the Ocean): sunlight 0–200 m, twilight
  // 200–1,000 m, midnight 1,000–4,000 m, the abyss 4,000–6,000 m, trenches below 6,000 m.
  const keep = [200, 1000, 4000, 6000];
  const files = [];
  for (const d of keep) files.push(await find(dir, new RegExp(`_${d}\\.shp$`)));
  // Two levels of detail, like assets/globe.json: "far" while the whole globe shows. The
  // source has no stair-steps (it is drawn from contours, every segment under 0.5°), so it goes
  // straight to mapshaper's weighted simplification, kept at the forests' density: near about
  // 0.23° between points (99% of segments under 1°, none over 2°), far about 0.7° (none over
  // 4°). Keeping fewer points left long straight edges across the oceans; tests/layers.test.mjs
  // holds the files to these numbers.
  const out = path.join(OUT, 'depth.topo.json'), far = path.join(OUT, 'depth-far.topo.json');
  await ms(`-i combine-files ${files.map(f => `"${f}"`).join(' ')} -merge-layers force name=depth ` +
    `-filter-fields depth -simplify 12% keep-shapes -filter-islands min-area=8000km2 -filter-slivers min-area=8000km2 ` +
    `-filter remove-empty -o "${out}" format=topojson quantization=8000 ` +
    `-simplify 2% keep-shapes -filter-islands min-area=60000km2 -filter-slivers min-area=60000km2 -filter remove-empty -o "${far}" format=topojson quantization=4000`);
  console.log(`  depth.topo.json ${await kb(out)}, depth-far.topo.json ${await kb(far)}`);
}

async function forests() {
  const shp = await find(await unpacked('forests'), /Ecoregions2017\.shp$/);
  // RESOLVE biomes: 1–3 tropical & subtropical forests, 14 mangroves, 4–5 temperate
  // forests, 6 boreal forest (taiga). These are where forests grow naturally.
  const out = path.join(OUT, 'forests.topo.json'), far = path.join(OUT, 'forests-far.topo.json');
  await ms(`-i "${shp}" -filter "[1,2,3,4,5,6,14].includes(BIOME_NUM)" ` +
    `-each "kind = BIOME_NUM <= 3 || BIOME_NUM == 14 ? 'tropical' : BIOME_NUM <= 5 ? 'temperate' : 'boreal'" ` +
    `-dissolve2 kind -simplify 1.2% keep-shapes -filter-islands min-area=3000km2 -filter-slivers min-area=3000km2 ` +
    `-filter remove-empty -o "${out}" format=topojson quantization=8000 ` +
    `-simplify 0.1% keep-shapes -filter-islands min-area=30000km2 -filter-slivers min-area=30000km2 -filter remove-empty -o "${far}" format=topojson quantization=4000`);
  console.log(`  forests.topo.json ${await kb(out)}, forests-far.topo.json ${await kb(far)}`);
}

// Natural Earth's reefs are lines along each reef. As areas: everything within REEF_NEAR of a
// line, joined where they touch (so the Great Barrier Reef reads as one long chain of reefs),
// then simplified. The far file (the whole globe) uses REEF_FAR, so reefs still show as a band
// at that size.
const REEF_NEAR = 8000, REEF_FAR = 25000; // m
async function reefs() {
  const shp = await find(await unpacked('reefs'), /ne_10m_reefs.shp$/);
  const out = path.join(OUT, 'reefs.topo.json'), far = path.join(OUT, 'reefs-far.topo.json');
  for (const [radius, file, keep, q] of [[REEF_NEAR, out, '10%', 8000], [REEF_FAR, far, '4%', 4000]]) {
    await ms(`-i "${shp}" -buffer radius=${radius} -dissolve2 -each "kind = 'reef'" -filter-fields kind ` +
      `-simplify ${keep} keep-shapes -o "${file}" format=topojson quantization=${q}`);
  }
  console.log(`  reefs.topo.json ${await kb(out)}, reefs-far.topo.json ${await kb(far)}`);
}

async function home() {
  const shp = await find(await unpacked('countries'), /ne_10m_admin_0_countries\.shp$/);
  const tmp = path.join(RAW, 'home.json');
  await ms(`-i "${shp}" -filter "ADM0_A3 == '${HOME}'" -simplify 20% keep-shapes -filter-islands min-area=20km2 -o "${tmp}" format=geojson`);
  const geo = JSON.parse(await readFile(tmp, 'utf8'));
  const polys = [];
  for (const f of geo.features) {
    const list = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of list) polys.push(rings.map(r => r.slice(0, -1).flatMap(([x, y]) => [Math.round(x * 100), Math.round(y * 100)])));
  }
  const file = path.join(ROOT, 'assets/home.json');
  await writeFile(file, JSON.stringify({ source: `Natural Earth 1:10m countries (public domain), ${HOME}`, unit: 0.01, polys }) + '\n');
  console.log(`  home.json ${polys.length} polygons, ${await kb(file)}`);
}

// ---------- main ----------

const STEPS = { relief, tiles, night, temp, depth, forests, reefs, home };
const wanted = process.argv.slice(2);
for (const w of wanted) if (!STEPS[w]) throw new Error(`Unknown layer "${w}" (have: ${Object.keys(STEPS).join(', ')})`);
await mkdir(RAW, { recursive: true });
await mkdir(OUT, { recursive: true });
for (const [name, step] of Object.entries(STEPS)) {
  if (wanted.length && !wanted.includes(name)) continue;
  console.log(name);
  await step();
}
