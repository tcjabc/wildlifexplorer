// Where a species lives, from GBIF occurrence records (https://www.gbif.org).
//
// Sampling: wild sightings first (museum specimens are often filed under the museum's
// location, and zoo animals turn up as specimens too). The sample is spread across
// countries in proportion to their record counts, so one busy dataset can't dominate.
//
// Licences: CC0 / CC BY records are used when there are enough of them. Otherwise all
// records are used, but only the generalised range shape made from them is kept, never
// the records themselves.
import { getJson } from './http.mjs';

const API = 'https://api.gbif.org/v1/occurrence/search';
const PAGE = 300;
const TARGET = 1500;      // points to aim for per species
const MIN_RECORDS = 20;
const MAX_COUNTRIES = 25;
const MIN_SHARE = 0.003;  // countries with fewer records than this are skipped (strays)
const MAX_OFFSET = 6000;  // deeper pages can take minutes to answer
const OPEN_LICENSES = ['CC0_1_0', 'CC_BY_4_0'];
const WILD = ['HUMAN_OBSERVATION', 'MACHINE_OBSERVATION'];
const ANY = [...WILD, 'PRESERVED_SPECIMEN', 'OCCURRENCE'];
const BASE = { hasCoordinate: 'true', hasGeospatialIssue: 'false', occurrenceStatus: 'PRESENT' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

async function sample(taxonKey, { openOnly, basis }) {
  const query = { ...BASE, basisOfRecord: basis, taxonKey: String(taxonKey), ...(openOnly ? { license: OPEN_LICENSES } : {}) };
  const head = await getJson(API, { ...query, limit: '0', facet: 'country', facetLimit: '60' });
  const count = head.count ?? 0;
  if (count < MIN_RECORDS) return { count, points: [] };

  const points = [];
  const take = async (extra, n, offset = 0) => {
    const json = await getJson(API, { ...query, ...extra, limit: String(clamp(n, 1, PAGE)), offset: String(offset) });
    for (const r of json.results ?? []) {
      if (Number.isFinite(r.decimalLatitude) && Number.isFinite(r.decimalLongitude)) points.push([r.decimalLongitude, r.decimalLatitude]);
    }
  };

  if (count <= PAGE) {
    await take({}, PAGE);
    return { count, points };
  }
  const countries = head.facets?.[0]?.counts ?? [];
  for (const c of countries.slice(0, MAX_COUNTRIES)) {
    const share = c.count / count;
    if (share < MIN_SHARE) continue;
    // A big share gets several pages, spread over that country's records.
    const want = Math.round(clamp(TARGET * share, 15, TARGET));
    const pages = Math.ceil(want / PAGE);
    const reach = Math.max(0, Math.min(c.count, MAX_OFFSET) - PAGE);
    for (let i = 0; i < pages; i++) {
      await take({ country: c.name }, Math.min(PAGE, want - i * PAGE), pages > 1 ? Math.floor((reach * i) / (pages - 1)) : 0);
    }
  }
  // Records with no country (open ocean, mostly), or too few so far: add a general sample.
  const withCountry = countries.reduce((n, c) => n + c.count, 0);
  if (withCountry < count * 0.8 || points.length < MIN_RECORDS) {
    const reach = Math.max(0, Math.min(count, MAX_OFFSET) - PAGE);
    await take({}, PAGE, 0);
    if (reach) await take({}, PAGE, Math.floor(reach / 2));
  }
  return { count, points };
}

// gbifIds: most specific first (subspecies, species, genus…). Uses the first one with
// enough records, so a subspecies like the Formosan black bear stays in Taiwan, not all Asia.
// Returns { points, records, openOnly, wildOnly }: the points are only used to work out the
// range shape (see range.mjs); they are never stored.
export async function findOccurrences(gbifIds) {
  const tries = [
    { openOnly: true, basis: WILD }, { openOnly: false, basis: WILD },
    { openOnly: true, basis: ANY }, { openOnly: false, basis: ANY },
  ];
  for (const key of gbifIds.slice(0, 2)) {
    for (const opts of tries) {
      const s = await sample(key, opts);
      if (s.points.length >= MIN_RECORDS) {
        return { points: s.points, records: s.count, openOnly: opts.openOnly, wildOnly: opts.basis === WILD };
      }
    }
  }
  return null;
}
