// "Where in the world" maps. assets/world.svg holds one land path (id="land") in
// twentieths of a degree (x = lon × 20, y = −lat × 20), drawn here with <use>, so a map
// zooms to any area just by setting its viewBox. Colours come from tokens via CSS.
//
// Where a card's data has mapBounds (from GBIF, or set by hand) a small range zooms right
// in, with a little world map in the corner showing where that is.
import { h, svg } from './dom.js';

const UNIT = 20;                                       // must match scripts/make-map.mjs
const WORLD = { west: -180, east: 180, north: 84, south: -58 };
const ASPECT = (WORLD.east - WORLD.west) / (WORLD.north - WORLD.south); // the .map box's shape
const SMALL = { lon: 60, lat: 45 };                    // ranges smaller than this get zoomed in
const MIN_SPAN = 6;                                    // degrees of longitude, so tiny ranges still show context
const LAND = 'assets/world.svg#land';
let clipIds = 0; // clipPath ids must be unique in the page

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

export function worldMap(card, { detail = false, label } = {}) {
  const spots = card.map?.areas ?? [];
  const points = card.rangePoints ?? [];
  if (!spots.length && !points.length && !card.mapBounds) return null;
  const v = viewFor(card, { detail });
  const inView = ([lon, lat]) => lon >= v.west && lon <= v.east && lat >= v.south && lat <= v.north;

  const dots = h('div', { class: 'map__dots' },
    points.filter(inView).map(([lon, lat]) => h('span', { class: 'map__pt', style: pct(v, lon, lat) })),
    spots.filter(a => inView([a.lon, a.lat])).map(a => h('span', { class: 'map__spot', style: pct(v, a.lon, a.lat) })));

  // Zoomed in: a little world map in the corner with a box around the area shown.
  let inset = null;
  if (!isWorld(v)) {
    const box = svg('rect', {
      class: 'map__box',
      x: v.west * UNIT, y: -v.north * UNIT, width: (v.east - v.west) * UNIT, height: (v.north - v.south) * UNIT,
      'vector-effect': 'non-scaling-stroke',
    });
    const world = land(WORLD, 'map__svg');
    world.append(box);
    inset = h('div', { class: 'map__inset' }, world);
  }

  // The range: land inside the mapBounds box is drawn a deeper green.
  const main = land(v, 'map__svg');
  const b = card.mapBounds;
  if (b) {
    const id = `range-${++clipIds}`;
    main.append(
      svg('clipPath', { id }, svg('rect', { x: b.west * UNIT, y: -b.north * UNIT, width: (b.east - b.west) * UNIT, height: (b.north - b.south) * UNIT })),
      svg('use', { href: LAND, class: 'map__range', 'clip-path': `url(#${id})` }));
  }

  return h('div', { class: ['map', !isWorld(v) && 'map--zoomed'], role: 'img', 'aria-label': label ?? '' },
    main, dots, inset);
}
