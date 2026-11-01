// "Where in the world" maps. assets/world.svg holds one land path (id="land") in
// twentieths of a degree (x = lon × 20, y = −lat × 20), drawn here with <use>, so a map
// zooms to any area just by setting its viewBox. Colours come from tokens via CSS.
//
// The range is a filled shape (data/ranges/<id>.json, made from GBIF records by the build,
// or a hand-made one). Small ranges zoom right in (mapBounds), with a little world map in
// the corner marking where that is.
import { h, svg } from './dom.js';

const UNIT = 20;                                       // must match scripts/make-map.mjs
const WORLD = { west: -180, east: 180, north: 84, south: -58 };
const ASPECT = (WORLD.east - WORLD.west) / (WORLD.north - WORLD.south); // the .map box's shape
const SMALL = { lon: 60, lat: 45 };                    // ranges smaller than this get zoomed in
const MIN_SPAN = 6;                                    // degrees of longitude, so tiny ranges still show context
const LAND = 'assets/world.svg#land';

const isSmall = b => b.east - b.west < SMALL.lon && b.north - b.south < SMALL.lat;

// Grow a box to the map's shape (and a minimum size), keeping it inside the world.
function fit(b) {
  const cx = (b.west + b.east) / 2, cy = (b.north + b.south) / 2;
  let w = Math.max(b.east - b.west, MIN_SPAN), hgt = b.north - b.south;
  if (w / hgt < ASPECT) w = hgt * ASPECT; else hgt = w / ASPECT;
  w = Math.min(w, 360); hgt = Math.min(hgt, WORLD.north - WORLD.south);
  const west = Math.min(Math.max(cx - w / 2, WORLD.west), WORLD.east - w);
  const north = Math.max(Math.min(cy + hgt / 2, WORLD.north), WORLD.south + hgt);
  return { west, east: west + w, north, south: north - hgt };
}

// Older cards may have map.zoom { lon, lat, scale } instead of bounds.
function zoomToBounds(z) {
  const w = 360 / z.scale, hgt = w / ASPECT;
  return { west: z.lon - w / 2, east: z.lon + w / 2, north: z.lat + hgt / 2, south: z.lat - hgt / 2 };
}

// Which part of the world to show. `detail` is the bigger map on the back of the card:
// it zooms to any known range; the small cover map only zooms for small ranges.
export function viewFor(card, { detail = false } = {}) {
  const b = card.mapBounds;
  if (b && (detail || isSmall(b))) return fit(b);
  if (!b && detail && card.map?.zoom) return fit(zoomToBounds(card.map.zoom));
  return WORLD;
}

const isWorld = v => v === WORLD;
const viewBox = v => `${v.west * UNIT} ${-v.north * UNIT} ${(v.east - v.west) * UNIT} ${(v.north - v.south) * UNIT}`;

function land(v, cls) {
  return svg('svg', { class: cls, viewBox: viewBox(v), preserveAspectRatio: 'xMidYMid slice', 'aria-hidden': 'true' },
    svg('use', { href: LAND, class: 'map__land' }));
}

const pct = (v, lon, lat) => ({
  left: `${((lon - v.west) / (v.east - v.west)) * 100}%`,
  top: `${((v.north - lat) / (v.north - v.south)) * 100}%`,
});

// Range shapes are small GeoJSON files (data/ranges/ or a hand-made data/ranges-manual/),
// fetched once and shared by every map that shows them.
const RANGE_FILE = /^data\/ranges(-manual)?\/[a-z0-9-]+\.json$/;
const ranges = new Map();
export function loadRange(file) {
  if (!RANGE_FILE.test(file ?? '')) return Promise.resolve(null);
  if (!ranges.has(file)) {
    ranges.set(file, fetch(file).then(r => (r.ok ? r.json() : null)).catch(() => null));
  }
  return ranges.get(file);
}

// A range file's polygons: [[ [lon, lat]… ]…], first ring the outline, any others holes.
export function rangePolygons(geo) {
  const g = geo?.geometry ?? geo?.features?.[0]?.geometry;
  if (!g) return [];
  return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
}

// GeoJSON polygons → one SVG path in map units (holes cut out with evenodd).
function rangePath(geo) {
  const polys = rangePolygons(geo);
  const pt = ([x, y]) => `${(x * UNIT).toFixed(1)} ${(-y * UNIT).toFixed(1)}`;
  return polys.map(rings => rings.map(ring => `M${ring.map(pt).join('L')}Z`).join('')).join('');
}

export function worldMap(card, { detail = false, label } = {}) {
  const spots = card.map?.areas ?? [];
  if (!spots.length && !card.range && !card.mapBounds) return null;
  const v = viewFor(card, { detail });
  const inView = ([lon, lat]) => lon >= v.west && lon <= v.east && lat >= v.south && lat <= v.north;

  const main = land(v, 'map__svg');
  // The range: a soft fill in the group colour, added when its file has loaded.
  loadRange(card.range).then(geo => {
    const d = rangePath(geo);
    if (d) main.append(svg('path', { class: 'map__range', d, 'fill-rule': 'evenodd', 'vector-effect': 'non-scaling-stroke' }));
  });

  const dots = h('div', { class: 'map__dots' },
    spots.filter(a => inView([a.lon, a.lat])).map(a => h('span', { class: 'map__spot', style: pct(v, a.lon, a.lat) })));

  // Zoomed in: a little world map in the corner, with a marker where the range is.
  let inset = null;
  const b = card.mapBounds;
  if (!isWorld(v)) {
    const at = b ? [(b.west + b.east) / 2, (b.south + b.north) / 2] : [(v.west + v.east) / 2, (v.south + v.north) / 2];
    inset = h('div', { class: 'map__inset' },
      land(WORLD, 'map__svg'),
      h('span', { class: 'map__marker', style: pct(WORLD, ...at) }));
  }

  return h('div', { class: ['map', !isWorld(v) && 'map--zoomed'], role: 'img', 'aria-label': label ?? '' },
    main, dots, inset);
}
