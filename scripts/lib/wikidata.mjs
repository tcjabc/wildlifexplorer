import { getJson } from './http.mjs';

const SPARQL = 'https://query.wikidata.org/sparql';
const API = 'https://www.wikidata.org/w/api.php';

// IUCN Red List categories (P141 values).
const IUCN = {
  Q237350: 'EX', Q239509: 'EW', Q219127: 'CR', Q11394: 'EN', Q278113: 'VU',
  Q719675: 'NT', Q211005: 'LC', Q3245245: 'DD', Q3350324: 'NE',
};

const RANKS = {
  Q36732: 'kingdom', Q38348: 'phylum', Q37517: 'class',
  Q36602: 'order', Q35409: 'family', Q34740: 'genus',
};
const SUBSPECIES = 'Q68947';

async function sparql(query) {
  const json = await getJson(SPARQL, { query, format: 'json' });
  return json.results.bindings;
}

const idOf = uri => uri.split('/').pop();

// Find the taxon item for a scientific name. If several items share the name
// (homonyms in different kingdoms), take the best-known one (most sitelinks).
export async function findTaxon(scientificName) {
  const name = JSON.stringify(scientificName);
  const rows = await sparql(`SELECT ?item ?links WHERE {
    ?item wdt:P225 ${name} ; wikibase:sitelinks ?links .
  } ORDER BY DESC(?links) LIMIT 5`);
  return rows.length ? idOf(rows[0].item.value) : null;
}

function bestClaims(claims = []) {
  const preferred = claims.filter(c => c.rank === 'preferred');
  return (preferred.length ? preferred : claims.filter(c => c.rank !== 'deprecated'))
    .map(c => c.mainsnak?.datavalue?.value)
    .filter(v => v !== undefined);
}

export async function getEntity(qid) {
  const json = await getJson(API, {
    action: 'wbgetentities', ids: qid, props: 'labels|claims',
    languages: 'en|zh-tw|zh-hant|zh', format: 'json',
  });
  return json.entities[qid];
}

export function zhTwLabel(entity) {
  return entity.labels?.['zh-tw']?.value || entity.labels?.['zh-hant']?.value || '';
}

const IUCN_BY_LABEL = {
  'extinct': 'EX', 'extinct in the wild': 'EW', 'critically endangered': 'CR', 'endangered': 'EN',
  'vulnerable': 'VU', 'near threatened': 'NT', 'least concern': 'LC', 'data deficient': 'DD',
  'not evaluated': 'NE',
};

async function iucnStatus(entity) {
  // Several P141 values can exist (assessments over time); the preferred one,
  // or else the last listed, is the current one.
  const last = bestClaims(entity.claims?.P141).at(-1);
  if (!last) return null;
  if (IUCN[last.id]) return IUCN[last.id];
  // Wikidata has more than one item for some categories; fall back to the label.
  const label = (await getEntity(last.id)).labels?.en?.value?.toLowerCase().replace(/ species$/, '').trim();
  return IUCN_BY_LABEL[label] ?? null;
}

export async function getTaxonomy(qid) {
  const rows = await sparql(`SELECT ?rank ?sci ?en ?zhtw ?zhhant WHERE {
    wd:${qid} wdt:P171* ?anc .
    ?anc wdt:P105 ?rank ; wdt:P225 ?sci .
    VALUES ?rank { ${Object.keys(RANKS).map(q => 'wd:' + q).join(' ')} }
    OPTIONAL { ?anc rdfs:label ?en FILTER(lang(?en) = "en") }
    OPTIONAL { ?anc rdfs:label ?zhtw FILTER(lang(?zhtw) = "zh-tw") }
    OPTIONAL { ?anc rdfs:label ?zhhant FILTER(lang(?zhhant) = "zh-hant") }
  } LIMIT 100`);
  const taxonomy = {};
  for (const r of rows) {
    const rank = RANKS[idOf(r.rank.value)];
    if (taxonomy[rank]) continue; // keep the first path when an item has several parents
    taxonomy[rank] = {
      sci: r.sci.value,
      en: r.en?.value ?? '',
      zh: r.zhtw?.value ?? r.zhhant?.value ?? '',
    };
  }
  // Return in rank order.
  return Object.fromEntries(Object.values(RANKS).filter(k => taxonomy[k]).map(k => [k, taxonomy[k]]));
}

export async function lookupSpecies(scientificName) {
  const qid = await findTaxon(scientificName);
  if (!qid) return null;
  const entity = await getEntity(qid);
  const claims = entity.claims ?? {};

  let status = await iucnStatus(entity);
  let statusFrom = status ? 'self' : null;
  const isSubspecies = bestClaims(claims.P105).some(v => v.id === SUBSPECIES);
  const parentId = bestClaims(claims.P171)[0]?.id;
  if (!status && isSubspecies && parentId) {
    status = await iucnStatus(await getEntity(parentId));
    if (status) statusFrom = 'species';
  }

  return {
    qid,
    labelEn: entity.labels?.en?.value ?? '',
    labelZhTw: zhTwLabel(entity),
    hasZhTwLabel: Boolean(entity.labels?.['zh-tw']),
    status,
    statusFrom,
    images: bestClaims(claims.P18),
    inatId: bestClaims(claims.P3151)[0] ?? null,
    taxonomy: await getTaxonomy(qid),
  };
}
