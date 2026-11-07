#!/usr/bin/env node
// Makes the Globe's map layers and the home outlines (assets/layers/) from big public datasets.
// Run: node scripts/make-layers.mjs [relief tiles night temp depth forests reefs plates volcanoes
// home base] (no names = all).
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
import { DEPTHS } from '../js/layers.js';
import { decodeTopo } from '../js/topo.js';
import { toByte } from '../js/globe-months.js';
import { CODES } from '../js/countries.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data-raw');
const OUT = path.join(ROOT, 'assets/layers');
const HOME_SIMPLIFY = '40%'; // of a country's points kept: at the coastline's level of detail
const HOME_QUANTIZATION = 36000; // steps across the map: a hundredth of a degree, like assets/globe.json
const TEMP_YEAR = 2024;    // months shown by the temperature layer

sharp.cache(false);
const big = { limitInputPixels: false };

const SOURCES = {
  relief: 'https://naciscdn.org/naturalearth/50m/raster/NE1_50M_SR_W.zip',
  height: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73934/gebco_08_rev_elev_21600x10800.png',
  night: 'https://assets.science.nasa.gov/content/dam/science/esd/eo/images/imagerecords/144000/144898/BlackMarble_2016_3km.jpg',
  depth: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_bathymetry_all.zip',
  reefs: 'https://naciscdn.org/naturalearth/10m/physical/ne_10m_reefs.zip',
  countries: 'https://naciscdn.org/naturalearth/50m/cultural/ne_50m_admin_0_countries.zip',
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

// ---------- the WebGL base layers (js/globe-base.js) ----------

// Land as a mask, from the very outlines the coastline is drawn from, so the two line up.
async function landMask(W, H) {
  const d = JSON.parse(await readFile(path.join(ROOT, 'assets/globe.json'), 'utf8'));
  const x = lon => (((lon * d.unit + 180) / 360) * W).toFixed(2), y = lat => (((90 - lat * d.unit) / 180) * H).toFixed(2);
  const ring = f => { let p = ''; for (let i = 0; i < f.length; i += 2) p += `${i ? 'L' : 'M'}${x(f[i])} ${y(f[i + 1])}`; return `${p}Z`; };
  const paths = d.near.map(rings => `<path fill-rule="evenodd" d="${rings.map(ring).join('')}"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#000"/><g fill="#fff">${paths}</g></svg>`;
  return sharp(Buffer.from(svg)).extractChannel(0).raw().toBuffer();
}

// shade-2k.webp: red is the hillshade (128 is flat, so the sea changes nothing), green the land
// mask. The hillshade is Natural Earth's shaded relief in grey with its broad tints taken out
// (all but what changes within a few pixels), which leaves the mountains and not the deserts.
const SHADE_BLUR = 10, SHADE_GAIN = 2.2;
async function shade(W, H) {
  const tif = await find(await unpacked('relief'), /\.tif$/i);
  // extractChannel: raw output is otherwise three channels, whatever went in.
  const sharpGrey = await sharp(tif, big).resize(W, H, { kernel: 'lanczos3' }).greyscale().extractChannel(0).raw().toBuffer();
  const soft = await sharp(sharpGrey, { raw: { width: W, height: H, channels: 1 } }).blur(SHADE_BLUR).extractChannel(0).raw().toBuffer();
  const mask = await landMask(W, H);
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    const land = mask[i] / 255;
    out[i * 3] = Math.max(0, Math.min(255, Math.round(128 + (sharpGrey[i] - soft[i]) * SHADE_GAIN * land)));
    out[i * 3 + 1] = mask[i];
  }
  const file = path.join(OUT, 'shade-2k.webp');
  await sharp(out, { raw: { width: W, height: H, channels: 3 } }).webp({ nearLossless: true, quality: 40, effort: 6 }).toFile(file);
  console.log(`  shade-2k.webp ${await kb(file)}`);
}

// Polygons ([[ [lon, lat]… ]…]) as an SVG path on a W × H map.
const svgPath = (polys, W, H) => polys.map(rings => rings.map(r => `M${r.map(([lon, lat]) => `${(((lon + 180) / 360) * W).toFixed(2)} ${(((90 - lat) / 180) * H).toFixed(2)}`).join('L')}Z`).join('')).join('');
const topoShapes = async name => decodeTopo(JSON.parse(await readFile(path.join(OUT, `${name}.topo.json`), 'utf8')));
const painted = (W, H, back, parts) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="${back}"/>${parts}</svg>`));

// forests-2k.webp: how much of each pixel is each kind of forest, one kind to a channel.
async function forestMask(W, H) {
  const shapes = await topoShapes('forests');
  const part = (kind, fill) => `<path fill="${fill}" fill-rule="evenodd" d="${svgPath(shapes.filter(f => f.props.kind === kind).flatMap(f => f.polys), W, H)}"/>`;
  const file = path.join(OUT, 'forests-2k.webp');
  await painted(W, H, '#000', part('tropical', '#f00') + part('temperate', '#0f0') + part('boreal', '#00f')).webp({ lossless: true, effort: 6 }).toFile(file);
  console.log(`  forests-2k.webp ${await kb(file)}`);
}

// depth-2k.webp: the ocean zone, as a number: the middle of its fifth of the scale, so the shader's
// five bands draw the edges where the zones meet, smooth at any zoom.
async function depthMap(W, H) {
  const shapes = await topoShapes('depth');
  const grey = z => { const b = 1 + Math.round(((z + 0.5) / 5) * 254); return `rgb(${b},${b},${b})`; };
  const parts = DEPTHS.map((d, i) => `<path fill="${grey(i + 1)}" fill-rule="evenodd" d="${svgPath(shapes.filter(f => f.props.depth === d).flatMap(f => f.polys), W, H)}"/>`).join('');
  const data = await painted(W, H, grey(0), parts).extractChannel(0).raw().toBuffer();
  const file = path.join(OUT, 'depth-2k.webp');
  await sharp(data, { raw: { width: W, height: H, channels: 1 } }).webp({ lossless: true, effort: 6 }).toFile(file);
  console.log(`  depth-2k.webp ${await kb(file)}`);
}

// temp-months-1…3.webp: the twelve months as numbers, not colours, one to a channel, four to a file
// (js/globe-months.js), so the shader can mix two months and colour them after. They are read back
// through the colour scale, since the raw files are big and not kept, and small enough to fetch in
// idle time. Places with no reading in a month (sea ice in its winter) take the nearest reading, so a
// month never has a hole to fall through while it morphs.
const MONTH_W = 720, MONTH_H = 360;
async function tempMonths() {
  const stops = (await token('--c-temp-scale')).split(',').map(s => { const [v, c] = s.trim().split(/\s+/); return { v: Number(v), rgb: hex(c) }; });
  const scale = [];
  for (let v = stops[0].v; v <= stops.at(-1).v; v += 0.5) {
    const i = Math.max(1, stops.findIndex(st => v <= st.v)), a = stops[i - 1], b = stops[i], t = (v - a.v) / (b.v - a.v);
    scale.push({ v, rgb: a.rgb.map((x, k) => x + (b.rgb[k] - x) * t) });
  }
  // Every colour to its place on the scale, at 6 bits a channel.
  const table = new Float32Array(64 ** 3).fill(NaN);
  const valueOf = (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    if (Number.isNaN(table[key])) {
      let best = Infinity;
      for (const st of scale) {
        const d = (st.rgb[0] - r) ** 2 + (st.rgb[1] - g) ** 2 + (st.rgb[2] - b) ** 2;
        if (d < best) { best = d; table[key] = st.v; }
      }
    }
    return table[key];
  };
  const N = MONTH_W * MONTH_H, out = [0, 1, 2].map(() => Buffer.alloc(N * 4));
  for (let month = 1; month <= 12; month++) {
    const { data, info: { width: W, height: H } } = await sharp(path.join(OUT, `temp-${String(month).padStart(2, '0')}.webp`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const sum = new Float32Array(N), n = new Uint16Array(N);
    for (let y = 0; y < H; y++) {
      const cy = Math.min(MONTH_H - 1, Math.floor((y * MONTH_H) / H));
      for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4;
        if (data[p + 3] < 128) continue;
        const c = cy * MONTH_W + Math.min(MONTH_W - 1, Math.floor((x * MONTH_W) / W));
        sum[c] += valueOf(data[p], data[p + 1], data[p + 2]);
        n[c]++;
      }
    }
    const v = Float32Array.from(sum, (t, i) => (n[i] ? t / n[i] : NaN));
    // Gaps fill inwards from their edges, the map wrapping round at 180°.
    for (let gaps = true; gaps;) {
      gaps = false;
      const next = v.slice();
      for (let y = 0; y < MONTH_H; y++) {
        for (let x = 0; x < MONTH_W; x++) {
          const i = y * MONTH_W + x;
          if (!Number.isNaN(v[i])) continue;
          let t = 0, k = 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const yy = y + dy;
            if (yy < 0 || yy >= MONTH_H) continue;
            const u = v[yy * MONTH_W + ((x + dx + MONTH_W) % MONTH_W)];
            if (!Number.isNaN(u)) { t += u; k++; }
          }
          if (k) next[i] = t / k; else gaps = true;
        }
      }
      v.set(next);
    }
    const file = out[Math.floor((month - 1) / 4)], ch = (month - 1) % 4;
    for (let i = 0; i < N; i++) file[i * 4 + ch] = toByte(v[i]);
  }
  for (const [i, data] of out.entries()) {
    const file = path.join(OUT, `temp-months-${i + 1}.webp`);
    await sharp(data, { raw: { width: MONTH_W, height: MONTH_H, channels: 4 } }).webp({ lossless: true, effort: 6 }).toFile(file);
    console.log(`  temp-months-${i + 1}.webp ${await kb(file)}`);
  }
}

async function base() {
  await shade(2048, 1024);
  await forestMask(2048, 1024);
  await depthMap(2048, 1024);
  await tempMonths();
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

// ---------- plates (PB2002) ----------

// Peter Bird's PB2002 (GIS version by Hugo Ahlenius, Nordpil; ODC-By 1.0) and Bird's plate
// motion poles. Steps (about 45 km each) are joined into runs of one boundary and one kind:
//   apart: spreading ridges and rifts (OSR, CRB); crash: subduction and collision (SUB, OCB,
//   CCB); slide: transforms (OTF, CTF).
// side (crash only): which side of the run, walking along it, the plate that stays on top is
// on: 1 left, -1 right, 0 both (a collision with no plate diving). In PB2002's names "A/B" means
// B dives under A, "A\B" that A dives under B.
const PB = 'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/';
const POLES = 'http://peterbird.name/oldFTP/PB2002/PB2002_poles.dat.txt';
const KIND = { OSR: 'apart', CRB: 'apart', SUB: 'crash', OCB: 'crash', CCB: 'crash', OTF: 'slide', CTF: 'slide' };
// The major plates that get a name and an arrow. Eurasia's pieces next to Taiwan (Yangtze,
// Sunda) are named as the Eurasian Plate too (Bird splits them off; school maps don't).
const MAJOR = ['PA', 'NA', 'EU', 'AF', 'AN', 'IN', 'AU', 'SA', 'NZ', 'PS', 'AR', 'CA', 'CO', 'SC', 'JF', 'SO'];
const LABEL_AS = { YA: 'EU', SU: 'EU' };
const PLATES_FAR_TOL = 0.6; // degrees: the far file, for the whole globe

// Point in polygon (rings of [lon, lat]), even-odd.
function inRings(rings, lon, lat) {
  let inside = false;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [xi, yi] = r[i], [xj, yj] = r[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
const ringsOf = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat();

// Douglas-Peucker on [lon, lat] points (degrees), keeping both ends.
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > worst) { worst = d; at = i; } }
    if (worst > tol) { keep[at] = 1; stack.push([a, at], [at, b]); }
  }
  // No segment longer than LONGEST: on the globe a straight segment between two far points
  // would cut the corner.
  const LONGEST = 3;
  // Walking along, keep a point whenever skipping it would make the segment from the last
  // kept point to the next one too long.
  const far = (a, b) => Math.hypot(pts[b][0] - pts[a][0], pts[b][1] - pts[a][1]) > LONGEST;
  let last = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    if (!keep[i] && far(last, i + 1)) keep[i] = 1;
    if (keep[i]) last = i;
  }
  return pts.filter((_, i) => keep[i]);
}

async function plates() {
  const get = async name => JSON.parse(await readFile(await download(`${PB}${name}.json`, path.join(RAW, `${name}.json`)), 'utf8'));
  const steps = await get('PB2002_steps'), platesGeo = await get('PB2002_plates');
  const shapes = new Map();
  for (const f of platesGeo.features) shapes.set(f.properties.Code, [...(shapes.get(f.properties.Code) ?? []), ...ringsOf(f.geometry)]);
  const inPlate = (code, lon, lat) => inRings(shapes.get(code) ?? [], lon, lat);

  // Runs: consecutive steps of one boundary and kind that join up.
  const runs = [];
  let run = null;
  for (const { properties: p } of steps.features) {
    const kind = KIND[p.STEPCLASS];
    if (!kind) throw new Error(`unknown step class ${p.STEPCLASS}`);
    const a = [p.STARTLONG, p.STARTLAT], b = [p.FINALLONG, p.FINALLAT];
    const joins = run && run.name === p.PLATEBOUND && run.kind === kind
      && Math.abs(run.pts.at(-1)[0] - a[0]) < 1e-3 && Math.abs(run.pts.at(-1)[1] - a[1]) < 1e-3;
    if (!joins) { run = { name: p.PLATEBOUND, kind, pts: [a] }; runs.push(run); }
    if (Math.abs(a[0] - b[0]) > 180) {
      // Across 180°: end the run on the line and go on from the other side.
      const e = a[0] > 0 ? 180 : -180, bx = b[0] + (a[0] > 0 ? 360 : -360);
      const lat = a[1] + ((b[1] - a[1]) * (e - a[0])) / (bx - a[0]);
      run.pts.push([e, lat]);
      run = { name: p.PLATEBOUND, kind, pts: [[-e, lat]] }; runs.push(run);
    }
    run.pts.push(b);
  }
  // Which side the plate on top is on, from the plate shapes a little off the run's middle.
  for (const r of runs) {
    r.side = 0;
    if (r.kind !== 'crash' || r.name[2] === '-') continue;
    const top = r.name[2] === '/' ? r.name.slice(0, 2) : r.name.slice(3, 5);
    // The plate on top, or else the one diving under it on the other side; tried at the
    // middle segment first, then others (the plate shapes are cut at 180°).
    const under = r.name[2] === '/' ? r.name.slice(3, 5) : r.name.slice(0, 2);
    const n = r.pts.length - 1, tries = [...new Set([n >> 1, n >> 2, (3 * n) >> 2, 0, n - 1])];
    for (const m of tries) {
      const [x0, y0] = r.pts[m], [x1, y1] = r.pts[m + 1];
      const L = Math.hypot(x1 - x0, y1 - y0) || 1e-9, nx = -(y1 - y0) / L, ny = (x1 - x0) / L; // to the left
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      for (const d of [0.25, 0.5, 1, 2]) {
        if (inPlate(top, cx + nx * d, cy + ny * d) || inPlate(under, cx - nx * d, cy - ny * d)) { r.side = 1; break; }
        if (inPlate(top, cx - nx * d, cy - ny * d) || inPlate(under, cx + nx * d, cy + ny * d)) { r.side = -1; break; }
      }
      if (r.side) break;
    }
    if (!r.side) console.warn(`  plates: no side found for ${r.name}`);
  }
  // Points in 0.01°, each after the first as the step from the one before (smaller numbers).
  const flat = pts => {
    const q = pts.map(([x, y]) => [Math.round(x * 100), Math.round(y * 100)]);
    return q.flatMap(([x, y], i) => (i ? [x - q[i - 1][0], y - q[i - 1][1]] : [x, y]));
  };
  const K = { apart: 'a', crash: 'c', slide: 's' };
  const write = async (name, list) => {
    const file = path.join(OUT, name);
    await writeFile(file, JSON.stringify({ source: 'PB2002, Bird (2003), GIS by Ahlenius / Nordpil (ODC-By 1.0)', unit: 0.01, delta: true, kinds: { a: 'apart', c: 'crash', s: 'slide' }, lines: list }) + '\n');
    return kb(file);
  };
  const near = await write('plates.json', runs.map(r => [K[r.kind], r.side, ...flat(r.pts)]));
  const far = await write('plates-far.json', runs.map(r => [K[r.kind], r.side, ...flat(simplify(r.pts, PLATES_FAR_TOL))]));

  // Plate motion with no net rotation: Bird's poles are relative to the Pacific; the net
  // rotation of the whole shell, (3 / 8 pi) sum of the integral of (w - r (r.w)) dA over every
  // plate, is taken off.
  const DEG = Math.PI / 180;
  const poleText = await readFile(await download(POLES, path.join(RAW, 'PB2002_poles.dat.txt')), 'latin1');
  const omega = new Map();
  for (const line of poleText.split(/\r?\n/)) {
    const m = line.match(/^([A-Z]{2})\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
    if (!m) continue;
    const [lat, lon, rate] = [Number(m[2]), Number(m[3]), (Number(m[4]) * DEG) / 1e6]; // rad/yr
    omega.set(m[1], [rate * Math.cos(lat * DEG) * Math.cos(lon * DEG), rate * Math.cos(lat * DEG) * Math.sin(lon * DEG), rate * Math.sin(lat * DEG)]);
  }
  const G = 0.5, cellOf = new Map(); // the plate of each 0.5° cell
  const net = [0, 0, 0];
  let area = 0;
  for (let lat = -90 + G / 2; lat < 90; lat += G) {
    const dA = Math.cos(lat * DEG) * (G * DEG) ** 2;
    for (let lon = -180 + G / 2; lon < 180; lon += G) {
      let code = null;
      for (const [c] of shapes) if (inPlate(c, lon, lat)) { code = c; break; }
      if (!code || !omega.has(code)) continue;
      cellOf.set(`${lon},${lat}`, code);
      const r = [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)];
      const w = omega.get(code), d = w[0] * r[0] + w[1] * r[1] + w[2] * r[2];
      for (let k = 0; k < 3; k++) net[k] += (w[k] - r[k] * d) * dA;
      area += dA;
    }
  }
  console.log(`  plates: cells cover ${((area / (4 * Math.PI)) * 100).toFixed(1)} % of the sphere`);
  for (let k = 0; k < 3; k++) net[k] *= 3 / (8 * Math.PI);
  const nnr = code => omega.get(code).map((w, k) => w - net[k]);
  // Each major plate's label: the cell deepest inside it (farthest from its edge).
  const R = 6371e6; // mm
  const motion = [];
  for (const code of [...MAJOR, ...Object.keys(LABEL_AS)]) {
    const cells = [...cellOf].filter(([, c]) => c === code).map(([k]) => k.split(',').map(Number));
    const edge = cells.filter(([lon, lat]) => [[G, 0], [-G, 0], [0, G], [0, -G]].some(([dx, dy]) => cellOf.get(`${lon + dx},${lat + dy}`) !== code));
    let best = null;
    for (const [lon, lat] of cells) {
      if (Math.abs(lat) > 75) continue;
      let d = Infinity;
      for (const [ex, ey] of edge) {
        const c = Math.sin(lat * DEG) * Math.sin(ey * DEG) + Math.cos(lat * DEG) * Math.cos(ey * DEG) * Math.cos((lon - ex) * DEG);
        d = Math.min(d, Math.acos(Math.min(1, c)));
        if (best && d < best.d) break;
      }
      if (!best || d > best.d) best = { lon, lat, d };
    }
    const w = nnr(code), { lon, lat } = best;
    const r = [Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.cos(lat * DEG) * Math.sin(lon * DEG), Math.sin(lat * DEG)];
    const v = [w[1] * r[2] - w[2] * r[1], w[2] * r[0] - w[0] * r[2], w[0] * r[1] - w[1] * r[0]].map(x => x * R);
    const east = [-Math.sin(lon * DEG), Math.cos(lon * DEG), 0];
    const north = [-Math.sin(lat * DEG) * Math.cos(lon * DEG), -Math.sin(lat * DEG) * Math.sin(lon * DEG), Math.cos(lat * DEG)];
    const ve = v[0] * east[0] + v[1] * east[1], vn = v[0] * north[0] + v[1] * north[1] + v[2] * north[2];
    motion.push({ code, name: LABEL_AS[code] ?? code, lon, lat, reach: Math.round((best.d / DEG) * 10) / 10, east: Math.round(ve * 10) / 10, north: Math.round(vn * 10) / 10 });
  }
  const mfile = path.join(OUT, 'plates-motion.json');
  await writeFile(mfile, JSON.stringify({ source: 'PB2002 poles (Bird 2003), turned into a no-net-rotation frame here; label points deepest inside each plate', unit: 'mm/yr', plates: motion }) + '\n');
  for (const m of motion) console.log(`  ${m.code} ${m.lon},${m.lat} reach ${m.reach}° ${Math.hypot(m.east, m.north).toFixed(0)} mm/yr toward ${((Math.atan2(m.east, m.north) / DEG + 360) % 360).toFixed(0)}°`);
  console.log(`  plates.json ${await near}, plates-far.json ${await far}, plates-motion.json ${await kb(mfile)}, ${runs.length} runs`);
}

// ---------- volcanoes (NOAA NCEI) ----------

// NOAA NCEI's Volcano Locations Database (public domain in the US; obtained from the
// Smithsonian Global Volcanism Program), from its HazEL API, 200 a page. Its last-eruption
// codes (GVP's): D1 1964 or later, D2 1900-1963, D3 1800-1899, D4 1700-1799, D5 1500-1699,
// D6 1-1499 CE, D7 BCE (Holocene), U undated but probably Holocene, ? uncertain Holocene,
// Q Quaternary with only hot springs and fumaroles since. zh names: Wikidata (CC0), by GVP
// volcano number (P1886), zh-tw or else zh-hant labels only (never Simplified).
// data/volcano-overrides.json (hand-written, with sources) wins over both.
const NCEI = 'https://www.ngdc.noaa.gov/hazel/hazard-service/api/v1/volcanolocs';
const WIKIDATA = 'https://query.wikidata.org/sparql';
const LAST = { D1: 'D1', D2: 'D2', D3: 'D3', D4: 'D4', D5: 'D5', D6: 'D6', D7: 'D7', '?': 'maybe', Q: 'Q' }; // anything else: 'U'
// NCEI's country names as ISO 3166 codes (their names come from the browser, js/countries.js),
// or a sea (strings volcano.sea.*). A volcano NCEI places in Taiwan is shown in Taiwan.
const PLACE = {
  Germany: 'DE', France: 'FR', Spain: 'ES', Italy: 'IT', Greece: 'GR', Turkey: 'TR', Russia: 'RU', Georgia: 'GE', Armenia: 'AM',
  Yemen: 'YE', Eritrea: 'ER', Ethiopia: 'ET', Kenya: 'KE', Tanzania: 'TZ', 'Congo, DRC': 'CD', Rwanda: 'RW', Uganda: 'UG',
  Cameroon: 'CM', Nigeria: 'NG', Libya: 'LY', Chad: 'TD', Sudan: 'SD', Syria: 'SY', 'Saudi Arabia': 'SA', Iran: 'IR',
  Afghanistan: 'AF', Comoros: 'KM', Reunion: 'RE', Antarctica: 'AQ', 'Heard I. & McDonald Is.': 'HM',
  'French Southern & Antarctic Lands': 'TF', 'South Africa': 'ZA', 'New Zealand': 'NZ', Tonga: 'TO', 'United States': 'US',
  'American Samoa': 'AS', Samoa: 'WS', 'Wallis & Futuna': 'WF', Fiji: 'FJ', 'Papua New Guinea': 'PG', 'Solomon Is.': 'SB',
  Vanuatu: 'VU', Australia: 'AU', India: 'IN', Indonesia: 'ID', Malaysia: 'MY', Philippines: 'PH', China: 'CN', Vietnam: 'VN',
  Myanmar: 'MM', Taiwan: 'TW', Japan: 'JP', Mongolia: 'MN', 'North Korea': 'KP', 'South Korea': 'KR', Canada: 'CA', Mexico: 'MX',
  Guatemala: 'GT', 'El Salvador': 'SV', Honduras: 'HN', Nicaragua: 'NI', 'Costa Rica': 'CR', Panama: 'PA', Colombia: 'CO',
  Ecuador: 'EC', Peru: 'PE', Chile: 'CL', Bolivia: 'BO', Argentina: 'AR', Netherlands: 'NL', 'St. Kitts & Nevis': 'KN',
  Montserrat: 'MS', Guadeloupe: 'GP', Dominica: 'DM', Martinique: 'MQ', 'St. Lucia': 'LC', 'St. Vincent & the Grenadines': 'VC',
  Grenada: 'GD', Trinidad: 'TT', Iceland: 'IS', 'Jan Mayen': 'SJ', Portugal: 'PT', 'Cape Verde': 'CV', 'Bouvet I.': 'BV',
  Djibouti: 'DJ', 'Sao Tome & Principe': 'ST', 'Equatorial Guinea': 'GQ', Mali: 'ML', Algeria: 'DZ', Madagascar: 'MG',
  'United Kingdom': 'GB',
  'Pacific Ocean': 'sea:pacific', 'Atlantic Ocean': 'sea:atlantic', 'Indian Ocean': 'sea:indian', 'Arctic Ocean': 'sea:arctic',
};

async function volcanoes() {
  const cache = path.join(RAW, 'ncei-volcanolocs.json');
  if (!existsSync(cache)) {
    const all = [];
    for (let page = 1, pages = 1; page <= pages; page++) {
      const res = await fetch(`${NCEI}?itemsPerPage=200&page=${page}`);
      if (!res.ok) throw new Error(`${res.status} ${NCEI}`);
      const d = await res.json();
      all.push(...d.items);
      pages = d.totalPages;
    }
    await writeFile(cache, JSON.stringify(all));
  }
  const locs = JSON.parse(await readFile(cache, 'utf8'));
  const wdCache = path.join(RAW, 'wikidata-volcanoes.json');
  if (!existsSync(wdCache)) {
    const q = 'SELECT ?id ?tw ?hant WHERE { ?v wdt:P1886 ?id . OPTIONAL { ?v rdfs:label ?tw FILTER(LANG(?tw) = "zh-tw") } OPTIONAL { ?v rdfs:label ?hant FILTER(LANG(?hant) = "zh-hant") } }';
    const res = await fetch(`${WIKIDATA}?format=json&query=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'WildFile-build/1.0 (educational app build script)', Accept: 'application/sparql-results+json' } });
    if (!res.ok) throw new Error(`${res.status} Wikidata`);
    await writeFile(wdCache, JSON.stringify((await res.json()).results.bindings));
  }
  const zhOf = new Map();
  for (const b of JSON.parse(await readFile(wdCache, 'utf8'))) { const zh = b.tw?.value ?? b.hant?.value; if (zh && !zhOf.has(b.id.value)) zhOf.set(b.id.value, zh); }
  const overrides = JSON.parse(await readFile(path.join(ROOT, 'data/volcano-overrides.json'), 'utf8'));
  const list = [], unknownPlace = new Set();
  for (const v of locs) {
    if (/not volcanic/i.test(v.morphology ?? '')) continue;
    const num = v.newNum ? String(v.newNum) : null, o = (num && overrides[num]) || {};
    const place = o.place ?? (v.location === 'Taiwan' ? 'TW' : PLACE[v.country]);
    if (!place) unknownPlace.add(v.country);
    const last = o.last ?? LAST[v.timeErupt] ?? 'U';
    // NCEI writes some names back to front for sorting ("Fournaise, Piton de la"): turned round.
    const en = o.name?.en ?? (/^unnamed$/i.test(v.name) ? '' : v.name.replace(/^([^,]+), ([^,]+)$/, '$2 $1'));
    const zh = o.name?.zh ?? (num && zhOf.get(num)) ?? '';
    const notable = o.notable ?? last === 'D1';
    list.push([Math.round(v.longitude * 100), Math.round(v.latitude * 100), notable ? 1 : 0, last, place ?? '', en, zh]);
  }
  if (unknownPlace.size) throw new Error(`volcanoes: no place for ${[...unknownPlace].join(', ')}`);
  list.sort((a, b) => b[2] - a[2]); // the notable ones first
  const file = path.join(OUT, 'volcanoes.json');
  await writeFile(file, JSON.stringify({ source: 'NOAA NCEI Volcano Locations Database (public domain); zh names from Wikidata (CC0); data/volcano-overrides.json', unit: 0.01, fields: ['lon', 'lat', 'notable', 'last', 'place', 'en', 'zh'], v: list }) + '\n');
  // The zh names shown on the whole globe, for checking (Wikidata names can be odd).
  const review = list.filter(v => v[2] && v[6]).map(v => `| ${v[5]} | ${v[6]} | ${v[4]} |`);
  await writeFile(path.join(ROOT, 'data/volcano-names-review.md'), `# Volcano names to check (zh)\n\nThe notable volcanoes' Chinese names, from Wikidata (zh-tw, else zh-hant) or data/volcano-overrides.json. Made by \`node scripts/make-layers.mjs volcanoes\`; fix a name in data/volcano-overrides.json.\n\n| English | 中文 | Place |\n|---|---|---|\n${review.join('\n')}\n`);
  console.log(`  volcanoes.json ${list.length} volcanoes (${list.filter(v => v[2]).length} notable, ${list.filter(v => v[6]).length} with a zh name), ${await kb(file)}`);
}

// Every country's outline in one file, so that fetching it says nothing about where an explorer is
// from: one shape a country, under the ISO code the profile forms use (js/countries.js). ISO_A2_EH,
// not ISO_A2: that one says -99 for France, Norway and others. Natural Earth at this scale has no
// shape of its own for some territories (tests/home-outlines.test.mjs lists them), and has shapes
// the forms don't offer, left out here: Kosovo, Somaliland, Northern Cyprus, Siachen Glacier.
// (Run this from PowerShell on Windows: Git Bash's tar can't unpack to a C:\ path.)
async function home() {
  const shp = await find(await unpacked('countries'), /ne_50m_admin_0_countries\.shp$/);
  const out = path.join(OUT, 'home.topo.json');
  await ms(`-i "${shp}" encoding=utf8 -simplify ${HOME_SIMPLIFY} keep-shapes ` +
    `-filter '/^(${CODES.join('|')})$/.test(ISO_A2_EH)' -rename-fields code=ISO_A2_EH -filter-fields code -dissolve code ` +
    `-o "${out}" format=topojson quantization=${HOME_QUANTIZATION}`);
  console.log(`  home.topo.json ${await kb(out)}`);
}

// ---------- main ----------

const STEPS = { relief, tiles, night, temp, depth, forests, reefs, plates, volcanoes, home, base };
const wanted = process.argv.slice(2);
for (const w of wanted) if (!STEPS[w]) throw new Error(`Unknown layer "${w}" (have: ${Object.keys(STEPS).join(', ')})`);
await mkdir(RAW, { recursive: true });
await mkdir(OUT, { recursive: true });
for (const [name, step] of Object.entries(STEPS)) {
  if (wanted.length && !wanted.includes(name)) continue;
  console.log(name);
  await step();
}
