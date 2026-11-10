// The Globe's map layers: what each chip shows, and where its files are. Files live in
// assets/layers/ (made by scripts/make-layers.mjs) and are only fetched when a layer is first
// switched on; the service worker keeps them after that.
//
// layer.load({ col, month }) resolves to a spec for globe.setLayer() (see js/globe.js).
import { prepare, toVec, prepareLines } from './globe.js';
import { RELIEF_TILES } from './globe-tiles.js';
import { TEMP_BANDS } from './globe-months.js';
import { decodeTopo } from './topo.js';

const DIR = 'assets/layers/';
const FLOOR = `${DIR}elevation-2k.webp`;
const DEG = Math.PI / 180;

const jsonCache = new Map();
function getJson(url) {
  if (!jsonCache.has(url)) {
    const p = fetch(url).then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); });
    p.catch(() => jsonCache.delete(url)); // try again next time (e.g. back online)
    jsonCache.set(url, p);
  }
  return jsonCache.get(url);
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

// Where the sun is overhead in a month (1–12) at an hour of the day in UTC (0–24), this year, by
// sunVector's maths: the month gives the declination (the 21st: the solstices, and the equinoxes
// to within a day), the hour where on the Earth it is noon. day: another day of the month (the
// real one, for Day & night's "Now").
export function sunAt(month, utcHour, { day = 21, year = new Date().getUTCFullYear() } = {}) {
  return sunVector(new Date(Date.UTC(year, month - 1, day) + utcHour * 3600000));
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
// [{ polys (far), near, fill, curve, edge }] for globe.setLayer(). curve > 0 draws the outlines
// as gentle curves (js/globe.js traceRing); edge: an outline colour.
async function shapesBy(name, prop, values, fill, { curve = 0, nearK, edge } = {}) {
  const [far, near] = (await Promise.all([`${DIR}${name}-far.topo.json`, `${DIR}${name}.topo.json`].map(getJson))).map(t => decodeTopo(t));
  const pick = (shapes, v) => prepare(shapes.filter(s => s.props[prop] === v).flatMap(s => s.polys), { edges: curve > 0 });
  return values.map((v, i) => ({ polys: pick(far, v), near: pick(near, v), fill: fill(v, i), curve, nearK, edge }));
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
  { layer: 'relief', author: 'NOAA National Centers for Environmental Information (NCEI), ETOPO 2022 Global Relief Model, 60 arc-second bedrock (doi:10.25921/fd45-gt74): the sea in the Ice Age',
    license: 'CC0 1.0 (public domain)', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    sourceUrl: 'https://www.ncei.noaa.gov/products/etopo-global-relief-model' },
  { layer: 'forests', author: 'Dinerstein et al. 2017, RESOLVE Ecoregions 2017 (simplified, grouped into three forest types)',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', sourceUrl: 'https://ecoregions.appspot.com/' },
  { layer: 'reefs', author: 'Natural Earth, 1:10m Reefs (shown as areas: 8 km around each reef, joined)', ...NE,
    sourceUrl: 'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-reefs/' },
  { layer: 'night', author: 'NASA Earth Observatory (Joshua Stevens), Black Marble 2016, Suomi NPP VIIRS (city lights as points)', ...NASA,
    sourceUrl: 'https://visibleearth.nasa.gov/images/144898/earth-at-night-black-marble-2016-color-maps' },
  { layer: 'temp', author: 'NASA EOSDIS GIBS: MODIS Terra land surface temperature and MODIS Aqua sea surface temperature, monthly 2024 (recoloured)', ...NASA,
    sourceUrl: 'https://worldview.earthdata.nasa.gov/' },
  { layer: 'depth', author: 'Natural Earth, 1:10m Bathymetry', ...NE,
    sourceUrl: 'https://www.naturalearthdata.com/downloads/10m-physical-vectors/10m-bathymetry/' },
  { layer: 'plates', author: 'Peter Bird (2003), PB2002 plate boundaries (doi:10.1029/2001GC000252), GIS version by Hugo Ahlenius, Nordpil; plate motion from its poles', license: 'ODC-By 1.0', licenseUrl: 'https://opendatacommons.org/licenses/by/1-0/',
    sourceUrl: 'https://github.com/fraxen/tectonicplates' },
  { layer: 'plates', author: 'NOAA National Centers for Environmental Information (NCEI), Volcano Locations Database (from the Smithsonian Global Volcanism Program); Chinese names from Wikidata (CC0)',
    license: 'Public domain (US government work)', licenseUrl: 'https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.hazards:G02135',
    sourceUrl: 'https://www.ncei.noaa.gov/products/natural-hazards/tsunamis-earthquakes-volcanoes/volcanoes' },
  { layer: 'home', author: 'Natural Earth, 1:50m Admin 0 countries (home outline)', ...NE,
    sourceUrl: 'https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/' },
];

// Where the ocean's zones meet (NOAA / NWS JetStream, Layers of the Ocean): sunlight to 200 m,
// twilight to 1,000 m, midnight to 4,000 m, the abyss to 6,000 m, then the trenches.
export const DEPTHS = [200, 1000, 4000, 6000];
const FORESTS = ['tropical', 'temperate', 'boreal'];

// What each layer's info panel says is in js/globe-info.js.
// gpu({ col, month }): what the layer shows on the base renderer (js/globe-base.js). load() is for
// when that isn't there; a layer with no gpu() always uses load(), over the plain map.
export const LAYERS = [
  {
    id: 'relief', emoji: '🏔️',
    // Its clock is the sea level (js/views/globe.js seaBar): the floor is the sea's depth today
    // (scripts/make-layers.mjs elevation), and what a lower sea leaves dry is the green lowlands.
    gpu: ({ col }) => ({ base: { kind: 'picture', tex: `${DIR}relief-2k.webp`, hill: 0.25, tiles: RELIEF_TILES, floor: { tex: FLOOR, dry: col('--c-relief-low') } } }),
    async load({ col }) {
      return { raster: { mode: 'relief', tex: `${DIR}relief-2k.webp`, aux: `${DIR}height-2k.webp`, bump: 5, tiles: RELIEF_TILES, floor: { tex: FLOOR, dry: rgb(col('--c-relief-low')) } } };
    },
  },
  {
    id: 'forests', emoji: '🌳',
    gpu: ({ col }) => ({ base: { kind: 'classes', tex: `${DIR}forests-2k.webp`, colours: FORESTS.map(k => col(`--c-forest-${k}`)), hill: 0.5, tiles: RELIEF_TILES } }),
    async load({ col }) {
      return { land: await shapesBy('forests', 'kind', FORESTS, k => col(`--c-forest-${k}`)) };
    },
  },
  {
    id: 'reefs', emoji: '🪸',
    // Areas (scripts/make-layers.mjs reefs): a translucent coral fill with a darker edge, on the
    // sea, under the land.
    async load({ col }) {
      return { sea: await shapesBy('reefs', 'kind', ['reef'], () => col('--c-reef-fill'), { edge: col('--c-reef-edge') }) };
    },
  },
  {
    id: 'night', emoji: '🌙', live: true,
    // The shade is the shader's (js/globe-base.js), or without it drawNight's in js/globe.js. The city
    // lights are drawn by drawNight on top, either way.
    async gpu({ col }) {
      const sun = sunVector();
      return {
        base: { kind: 'flat', hill: 0.5, night: { sun, shade: col('--c-night'), twilight: col('--c-twilight') } },
        night: { sun, lights: await cityLights(), light: col('--c-city-lights'), lightsOnly: true },
      };
    },
    async load({ col }) {
      const rgb255 = c => rgb(c).map(x => Math.round(x * 255));
      return { night: { sun: sunVector(), lights: await cityLights(), shade: rgb255(col('--c-night')), twilight: rgb255(col('--c-twilight')), light: col('--c-city-lights') } };
    },
    tick: () => ({ sun: sunVector() }),
  },
  {
    id: 'temp', emoji: '🌡️', months: true,
    // The months as pictures, for when there is no base renderer.
    pictures: Array.from({ length: 12 }, (_, i) => `${DIR}temp-${String(i + 1).padStart(2, '0')}.webp`),
    gpu: ({ col, month }) => ({ base: { kind: 'months', stops: tempStops(col), bands: TEMP_BANDS, hill: 0.35, pos: month } }),
    async load({ month }) {
      return { raster: { mode: 'picture', tex: `${DIR}temp-${String(month).padStart(2, '0')}.webp` } };
    },
  },
  {
    id: 'depth', emoji: '🌊',
    // The zones as five bands of one scale: each colour holds across its fifth.
    gpu: ({ col }) => {
      const zone = ['--c-map-sea', ...DEPTHS.map((d, i) => `--c-depth-${i + 1}`)].map(col);
      const stops = [{ v: 0, colour: zone[0] }, ...zone.map((colour, i) => ({ v: (i + 0.5) / 5, colour })), { v: 1, colour: zone[4] }];
      return { base: { kind: 'ramp', tex: `${DIR}depth-2k.webp`, stops, bands: 5, sea: true, hill: 0.5, tiles: RELIEF_TILES } };
    },
    async load({ col }) {
      return { sea: await shapesBy('depth', 'depth', DEPTHS, (d, i) => col(`--c-depth-${i + 1}`), { curve: DEPTH_CURVE, nearK: DEPTH_NEAR_K }) };
    },
  },
  {
    id: 'plates', emoji: '🌋',
    // scripts/make-layers.mjs plates: PB2002 boundaries (far and near) and each major plate's
    // motion; drawn by js/globe.js (drawPlates), the names by js/views/globe.js.
    async load({ col }) {
      const [far, near, motion, volc] = await Promise.all(['plates-far.json', 'plates.json', 'plates-motion.json', 'volcanoes.json'].map(f => getJson(`${DIR}${f}`)));
      return {
        plates: { far: plateLines(far), near: plateLines(near), motion: plateMotion(motion), colour: col('--c-plate'), halo: col('--c-plate-halo'), gap: col('--c-plate-gap'), arrow: col('--c-plate-arrow'), arrowEdge: col('--c-plate-arrow-edge') },
        volcanoes: { list: volcanoList(volc), fill: col('--c-volcano'), edge: col('--c-volcano-edge') },
      };
    },
  },
];

// City lights from lights.json (scripts/make-layers.mjs): [lon, lat, b (1–99)] in 0.01°, brightest first.
async function cityLights() {
  const d = await getJson(`${DIR}lights.json`);
  const n = d.points.length / 3, vecs = new Float32Array(n * 3), b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    vecs.set(toVec(d.points[i * 3] * d.unit, d.points[i * 3 + 1] * d.unit), i * 3);
    b[i] = d.points[i * 3 + 2] / 99;
  }
  return { vecs, b };
}

// plates.json: [kind letter, side, lon, lat, then steps from the point before] in 0.01°.
export function plateLines(d) {
  const runs = [], meta = [];
  for (const l of d.lines) {
    const pts = [];
    let x = l[2], y = l[3];
    pts.push([x * d.unit, y * d.unit]);
    for (let i = 4; i < l.length; i += 2) { x += l[i]; y += l[i + 1]; pts.push([x * d.unit, y * d.unit]); }
    runs.push(pts);
    meta.push({ kind: d.kinds[l[0]], side: l[1] });
  }
  return prepareLines(runs).map((p, i) => ({ ...p, ...meta[i] }));
}
// volcanoes.json (scripts/make-layers.mjs volcanoes): [lon, lat, notable, last, place, en, zh],
// the notable ones (erupted since 1964, and Taiwan's) first.
export function volcanoList(d) {
  return d.v.map(([lon, lat, notable, last, place, en, zh]) => ({ v: toVec(lon * d.unit, lat * d.unit), lon: lon * d.unit, lat: lat * d.unit, notable: notable === 1, last, place, name: { en, zh } }));
}
// plates-motion.json: each major plate's label point and its motion (mm/yr east, north).
export function plateMotion(d) {
  return d.plates.map(m => {
    const v = toVec(m.lon, m.lat), l = m.lon * DEG, p = m.lat * DEG, speed = Math.hypot(m.east, m.north);
    const e = [-Math.sin(l), Math.cos(l), 0], n = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)];
    // A point a little ahead along the motion, to find its direction on screen.
    const a = v.map((c, k) => c + 0.01 * (e[k] * m.east + n[k] * m.north) / (speed || 1));
    const len = Math.hypot(...a);
    return { ...m, v, ahead: a.map(c => c / len), speed };
  });
}
