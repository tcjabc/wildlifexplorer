// The Globe's map layers: what each chip shows, where its files are and what its legend
// says. Files live in assets/layers/ (made by scripts/make-layers.mjs) and are only
// fetched when a layer is first switched on; the service worker keeps them after that.
//
// layer.load({ col, month }) resolves to a spec for globe.setLayer() (see js/globe.js).
import { prepare, toVec } from './globe.js';

const DIR = 'assets/layers/';
const DEG = Math.PI / 180;

// Phones get 2K pictures, bigger screens 4K (a 4K texture takes ~45 MB of GPU memory).
const size = () => (Math.min(screen.width, screen.height) >= 700 ? '4k' : '2k');

const jsonCache = new Map();
function getJson(url) {
  if (!jsonCache.has(url)) {
    const p = fetch(url).then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); });
    p.catch(() => jsonCache.delete(url)); // try again next time (e.g. back online)
    jsonCache.set(url, p);
  }
  return jsonCache.get(url);
}

// TopoJSON (as written by mapshaper) → [{ props, polys: [[ [lon, lat]… ]…] }]. A ring made
// of several arcs lists where each one starts (ring.joins): there it meets another outline.
export function decodeTopo(topo) {
  const { scale: [sx, sy], translate: [tx, ty] } = topo.transform;
  const arcs = topo.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
  });
  const ring = ids => {
    const out = [], joins = [];
    for (const id of ids) {
      const a = id < 0 ? arcs[~id].slice().reverse() : arcs[id];
      if (ids.length > 1) joins.push(out.length ? out.length - 1 : 0);
      out.push(...(out.length ? a.slice(1) : a));
    }
    // A closed ring repeats its first point at the end; the joins point into the open ring.
    if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
    out.joins = joins.filter(i => i < out.length);
    return out;
  };
  const geoms = Object.values(topo.objects)[0].geometries;
  return geoms.filter(g => g.arcs).map(g => ({
    props: g.properties ?? {},
    polys: (g.type === 'Polygon' ? [g.arcs] : g.arcs).map(rings => rings.map(ring)),
  }));
}

// Where the sun is overhead right now, as a unit vector (accurate to a fraction of a
// degree, plenty for drawing day and night).
export function sunVector(date = new Date()) {
  const d = date.getTime() / 86400000 - 10957.5; // days since 2000-01-01 12:00 UTC
  const g = (357.529 + 0.98560028 * d) * DEG;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const e = (23.439 - 0.00000036 * d) * DEG;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24 * 15 * DEG;
  return toVec((ra - gmst) / DEG, dec / DEG);
}

const rgb = c => {
  const m = c.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  return m ? m.slice(1).map(x => parseInt(x, 16) / 255) : [0, 0, 0];
};

// Temperature scale from --c-temp-scale: [{ v: °C, colour }].
export const tempStops = col => col('--c-temp-scale').split(',').map(s => {
  const [v, colour] = s.trim().split(/\s+/);
  return { v: Number(v), colour };
});

// <name>-far.topo.json and <name>.topo.json, split by a property into one fill each:
// [{ polys (far), near, fill, curve }] for globe.setLayer(). curve > 0 draws the outlines as
// gentle curves (js/globe.js traceRing).
async function shapesBy(name, prop, values, fill, { curve = 0, nearK } = {}) {
  const [far, near] = (await Promise.all([`${DIR}${name}-far.topo.json`, `${DIR}${name}.topo.json`].map(getJson))).map(decodeTopo);
  const pick = (shapes, v) => prepare(shapes.filter(s => s.props[prop] === v).flatMap(s => s.polys), { edges: curve > 0 });
  return values.map((v, i) => ({ polys: pick(far, v), near: pick(near, v), fill: fill(v, i), curve, nearK }));
}
// The depth bands' curves: light, a third of each segment at a corner. Their detailed file
// (four times the points of the far one) only from zoom 5: before that the far one's curves
// look the same and cost far less to draw.
export const DEPTH_CURVE = 0.33;
export const DEPTH_NEAR_K = 5;

// Where each layer's data comes from, for the Credits page (CREDITS.md has the details).
const NE = { license: 'Public domain', licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/' };
const NASA = { license: 'CC0 / public domain (NASA)', licenseUrl: 'https://www.earthdata.nasa.gov/learn/use-data/data-use-policy' };
export const LAYER_CREDITS = [
  { layer: 'relief', author: 'Natural Earth (Tom Patterson), Natural Earth I with Shaded Relief and Water', ...NE,
    sourceUrl: 'https://www.naturalearthdata.com/downloads/50m-raster-data/50m-natural-earth-1/' },
  { layer: 'relief', author: 'Jesse Allen, NASA Earth Observatory, using GEBCO data (British Oceanographic Data Centre): height for the bumps',
    license: 'Public domain (NASA, GEBCO)', licenseUrl: 'https://www.gebco.net/data_and_products/gridded_bathymetry_data/',
    sourceUrl: 'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/topography-bathymetry-maps' },
  { layer: 'forests', author: 'Dinerstein et al. 2017, RESOLVE Ecoregions 2017 (simplified, grouped into three forest types)',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://ecoregions.appspot.com/' },
  { layer: 'reefs', author: 'Natural Earth, 1:10m Reefs (shown as dots)', ...NE,
    sourceUrl: 'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-reefs/' },
  { layer: 'night', author: 'NASA Earth Observatory (Joshua Stevens), Black Marble 2016, Suomi NPP VIIRS', ...NASA,
    sourceUrl: 'https://visibleearth.nasa.gov/images/144898/earth-at-night-black-marble-2016-color-maps' },
  { layer: 'temp', author: 'NASA EOSDIS GIBS: MODIS Terra land surface temperature and MODIS Aqua sea surface temperature, monthly 2024 (recoloured)', ...NASA,
    sourceUrl: 'https://worldview.earthdata.nasa.gov/' },
  { layer: 'depth', author: 'Natural Earth, 1:10m Bathymetry', ...NE,
    sourceUrl: 'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-bathymetry/' },
  { layer: 'home', author: 'Natural Earth, 1:10m Admin 0 countries (home outline)', ...NE,
    sourceUrl: 'https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/' },
];

const DEPTHS = [200, 2000, 4000, 6000];
const FORESTS = ['tropical', 'temperate', 'boreal'];

// legend: [{ colour token, label key }] or a special kind the view knows how to draw.
export const LAYERS = [
  {
    id: 'relief', emoji: '🏔️',
    legend: [['--c-relief-low', 'layer.relief.low'], ['--c-relief-dry', 'layer.relief.dry'], ['--c-relief-high', 'layer.relief.high']],
    async load() {
      return { raster: { mode: 'relief', tex: `${DIR}relief-${size()}.webp`, aux: `${DIR}height-2k.webp`, bump: 5 } };
    },
  },
  {
    id: 'forests', emoji: '🌳',
    legend: FORESTS.map(k => [`--c-forest-${k}`, `layer.forests.${k}`]),
    note: 'layer.forests.note',
    async load({ col }) {
      return { land: await shapesBy('forests', 'kind', FORESTS, k => col(`--c-forest-${k}`)) };
    },
  },
  {
    id: 'reefs', emoji: '🪸',
    legend: [['--c-reef', 'layer.reefs.reef']],
    note: 'layer.reefs.note',
    async load({ col }) {
      const d = await getJson(`${DIR}reefs.json`);
      const vecs = new Float32Array(d.points.length * 1.5);
      for (let i = 0, j = 0; i < d.points.length; i += 2, j += 3) vecs.set(toVec(d.points[i] * d.unit, d.points[i + 1] * d.unit), j);
      return { points: { vecs, colour: col('--c-reef') } };
    },
  },
  {
    id: 'night', emoji: '🌙', live: true,
    legend: [['--c-map-land', 'layer.night.day'], ['--c-night', 'layer.night.night'], ['--c-city-lights', 'layer.night.lights']],
    note: 'layer.night.note',
    async load({ col }) {
      return { raster: { mode: 'night', tex: `${DIR}night-${size()}.webp`, sun: sunVector(), tint: rgb(col('--c-night')) } };
    },
    tick: () => ({ sun: sunVector() }),
  },
  {
    id: 'temp', emoji: '🌡️', months: true,
    legend: 'temp',
    note: 'layer.temp.note',
    async load({ month }) {
      return { raster: { mode: 'picture', tex: `${DIR}temp-${String(month).padStart(2, '0')}.webp` } };
    },
  },
  {
    id: 'depth', emoji: '🌊',
    legend: [['--c-map-sea', 'layer.depth.0'], ...DEPTHS.map((_, i) => [`--c-depth-${i + 1}`, `layer.depth.${i + 1}`])],
    async load({ col }) {
      return { sea: await shapesBy('depth', 'depth', DEPTHS, (d, i) => col(`--c-depth-${i + 1}`), { curve: DEPTH_CURVE, nearK: DEPTH_NEAR_K }) };
    },
  },
];
