// Where a species lives, from GBIF occurrence records (https://www.gbif.org).
// Takes a spread-out sample of records with coordinates, keeps the middle 90% of
// latitudes and longitudes (so stray records and zoo animals don't stretch the map),
// and pads the box a little.
//
// Licences: dots drawn on the map come only from CC0 / CC BY records. If there are too few
// of those, the range box is worked out from all records, but only the box itself (four
// numbers, a plain fact about where the species lives) is kept, not the records.
import { getJson } from './http.mjs';

const API = 'https://api.gbif.org/v1/occurrence/search';
const PAGE = 300;
const PAGES = 4;
const MIN_RECORDS = 20;
const MAX_OFFSET = 6000;
const OPEN_LICENSES = ['CC0_1_0', 'CC_BY_4_0'];
const BASE = {
  hasCoordinate: 'true',
  hasGeospatialIssue: 'false',
  occurrenceStatus: 'PRESENT',
  // Wild sightings and museum specimens only: no zoo or garden animals.
  basisOfRecord: ['HUMAN_OBSERVATION', 'MACHINE_OBSERVATION', 'PRESERVED_SPECIMEN', 'OCCURRENCE'],
};

const percentile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
const round = (v, step) => Math.round(v / step) * step;
const fix = v => Number(v.toFixed(2));

async function sample(taxonKey, openOnly) {
  const query = { ...BASE, taxonKey: String(taxonKey), ...(openOnly ? { license: OPEN_LICENSES } : {}) };
  const first = await getJson(API, { ...query, limit: '0' });
  const count = first.count ?? 0;
  if (count < MIN_RECORDS) return { count, points: [] };
  // Spread the pages over the first records. GBIF allows deeper paging, but deep pages
  // can take minutes to answer.
  const reach = Math.max(0, Math.min(count, MAX_OFFSET) - PAGE);
  const pages = Math.min(PAGES, Math.ceil(count / PAGE));
  const points = [];
  for (let i = 0; i < pages; i++) {
    const offset = pages === 1 ? 0 : Math.floor((reach * i) / (pages - 1));
    const json = await getJson(API, { ...query, limit: String(PAGE), offset: String(offset) });
    for (const r of json.results ?? []) {
      if (Number.isFinite(r.decimalLatitude) && Number.isFinite(r.decimalLongitude)) points.push([r.decimalLongitude, r.decimalLatitude]);
    }
  }
  return { count, points };
}

function boxOf(points) {
  const lons = points.map(p => p[0]).sort((a, b) => a - b);
  const lats = points.map(p => p[1]).sort((a, b) => a - b);
  let west = percentile(lons, 0.05), east = percentile(lons, 0.95);
  let south = percentile(lats, 0.05), north = percentile(lats, 0.95);
  const padX = Math.max((east - west) * 0.15, 1);
  const padY = Math.max((north - south) * 0.15, 1);
  west = Math.max(-180, west - padX); east = Math.min(180, east + padX);
  south = Math.max(-58, south - padY); north = Math.min(84, north + padY);
  return { west: fix(west), south: fix(south), east: fix(east), north: fix(north) };
}

// A few dozen dots to draw: records snapped to a grid that suits the range's size.
function dotsIn(points, b) {
  const step = Math.max(0.1, (b.east - b.west) / 40);
  const inBox = points.filter(([x, y]) => x >= b.west && x <= b.east && y >= b.south && y <= b.north);
  return [...new Map(inBox.map(([x, y]) => {
    const p = [fix(round(x, step)), fix(round(y, step))];
    return [p.join(','), p];
  })).values()].slice(0, 80);
}

// gbifIds: most specific first (subspecies, species, genus…). Uses the first one with
// enough records, so a subspecies like the Formosan black bear maps to Taiwan, not all Asia.
export async function findRange(gbifIds) {
  for (const key of gbifIds.slice(0, 2)) {
    const open = await sample(key, true);
    if (open.points.length >= MIN_RECORDS) {
      const bounds = boxOf(open.points);
      return { bounds, points: dotsIn(open.points, bounds), records: open.count, openOnly: true };
    }
    const all = await sample(key, false);
    if (all.points.length >= MIN_RECORDS) {
      const bounds = boxOf(all.points);
      return { bounds, points: dotsIn(open.points, bounds), records: all.count, openOnly: false };
    }
  }
  return null;
}
