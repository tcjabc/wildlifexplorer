#!/usr/bin/env node
// Builds data/animals.json from data/card-list.csv.
//
//   node scripts/build-cards.mjs              first `limit` rows (see build.config.json)
//   node scripts/build-cards.mjs --all        every row
//   node scripts/build-cards.mjs --limit 40   first 40 rows
//   node scripts/build-cards.mjs --only leopard-cat,koala
//   node scripts/build-cards.mjs --offline    no network: re-merge, re-schedule, make thumbs
//   node scripts/build-cards.mjs --prune      also delete image files no card uses any more
//
// Your hand edits in animals.json are never overwritten (see lib/merge.mjs).

import { existsSync } from 'node:fs';
import { readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseCsv } from './lib/csv.mjs';
import { setUserAgent } from './lib/http.mjs';
import { lookupSpecies } from './lib/wikidata.mjs';
import { fileInfo, searchIllustrations } from './lib/commons.mjs';
import { findSilhouette } from './lib/phylopic.mjs';
import { findOccurrences } from './lib/gbif.mjs';
import { makeRange } from './lib/range.mjs';
import { loadLand } from './lib/land.mjs';
import { getBuffer } from './lib/http.mjs';
import { findPhotos } from './lib/inaturalist.mjs';
import { downloadImage, ensureThumb, shortHash, thumbPath } from './lib/images.mjs';
import { isAllowedLicenseName } from './lib/licenses.mjs';
import { mergeCard, canUpdate } from './lib/merge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P = {
  csv: path.join(ROOT, 'data/card-list.csv'),
  groups: path.join(ROOT, 'data/groups.json'),
  cards: path.join(ROOT, 'data/animals.json'),
  state: path.join(ROOT, 'data/build-state.json'),
  report: path.join(ROOT, 'data/build-report.md'),
  locations: path.join(ROOT, 'data/locations.json'),
  config: path.join(ROOT, 'scripts/build.config.json'),
};

const readJson = async (file, fallback) => (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : fallback);
const writeJson = (file, data) => writeFile(file, JSON.stringify(data, null, 2) + '\n', 'utf8');

function parseArgs(argv) {
  const args = { all: false, limit: null, only: null, offline: false, prune: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') args.all = true;
    else if (a === '--offline') args.offline = true;
    else if (a === '--prune') args.prune = true;
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--only') args.only = argv[++i].split(',').map(s => s.trim());
    else throw new Error(`Unknown option ${a}`);
  }
  return args;
}

export const slugify = s => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// 台 and 臺 are both correct in Taiwan; don't flag a difference that is only that.
const zhKey = s => (s ?? '').replace(/台/g, '臺').replace(/[（）()\s]/g, '');

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Unlock order deals cards round-robin across groups so new cards rotate through
// the binder. Computed over the whole CSV so dates don't shift when the limit changes.
function unlockSchedule(rows, groups, { start, initial, everyDays }) {
  const queues = groups.map(g => rows.filter(r => r.groupId === g.id));
  const order = [];
  while (queues.some(q => q.length)) for (const q of queues) if (q.length) order.push(q.shift());
  const dates = new Map();
  order.forEach((row, i) => dates.set(row, addDays(start, Math.max(0, i - initial + 1) * everyDays)));
  return dates;
}

function blankCard(row) {
  return {
    id: row.id,
    group: row.groupId,
    scientificName: row.scientific_name || null,
    name: { en: row.name_en, zh: row.name_zh },
    facts: [],
    habitat: { en: '', zh: '' },
    status: null,
    taiwan: row.taiwan === 'Y',
    photo: null,
    illustration: null,
    unlockDate: null,
  };
}

const KEY_ORDER = ['id', 'group', 'scientificName', 'name', 'facts', 'habitat', 'status', 'taiwan',
  'photo', 'illustration', 'unlockDate', 'map', 'mapBounds', 'range', 'place', 'fossilSite', 'profile', 'stats', 'compare', 'lifeCycle', 'silhouette',
  'taxonomy', 'wikidata', 'locked', '_draft'];
function orderKeys(card) {
  const out = {};
  for (const k of KEY_ORDER) if (k in card) out[k] = card[k];
  for (const k of Object.keys(card)) if (!(k in out)) out[k] = card[k];
  return out;
}

const pickBest = list => list.find(c => c.width >= c.height) ?? list[0];

async function chooseImage(kind, card, cfg, candidates, notes) {
  const cur = card[kind];
  const pick = candidates[0];
  if (!pick) return undefined;
  const credit = { author: pick.author, license: pick.license, licenseUrl: pick.licenseUrl, sourceUrl: pick.sourceUrl };
  // Same source image already on disk: keep the file, refresh the credit details.
  if (cur?.sourceUrl === pick.sourceUrl && existsSync(path.join(ROOT, cur.file))) return { file: cur.file, ...credit };
  const file = `img/${card.id}-${kind}-${shortHash(pick.sourceUrl)}.webp`;
  await downloadImage(pick.downloadUrl, ROOT, file, cfg.image);
  notes.push(`${kind}: downloaded from ${pick.source === 'commons' ? 'Wikimedia Commons' : 'iNaturalist'} (${pick.license})`);
  return { file, ...credit };
}

async function processSpecies(row, card, prevState, cfg, issues, notes) {
  const values = {};
  const wd = await lookupSpecies(row.scientific_name);
  if (!wd) {
    issues.push(`Not found on Wikidata by scientific name "${row.scientific_name}" — check spelling`);
  } else {
    values.wikidata = wd.qid;
    values.taxonomy = wd.taxonomy;
    values.status = wd.status;
    if (!wd.status) issues.push('No IUCN status on Wikidata — add "status" by hand if you know it');
    if (wd.statusFrom === 'species') notes.push(`status ${wd.status} is the parent species' IUCN status (no subspecies assessment)`);

    if (!row.name_zh && wd.labelZhTw) {
      values['name.zh'] = wd.labelZhTw;
      issues.push(`zh-TW name filled in from Wikidata: ${wd.labelZhTw} — please check`);
    } else if (!row.name_zh) {
      issues.push('Missing zh-TW name (none in the list or on Wikidata)');
    } else if (!wd.labelZhTw) {
      notes.push('Wikidata has no zh-TW label to confirm the Chinese name against');
    } else if (zhKey(wd.labelZhTw) !== zhKey(row.name_zh)) {
      issues.push(`zh-TW name differs: your list has ${row.name_zh}, Wikidata has ${wd.labelZhTw}`);
    }
  }

  const { minWidth, maxSize } = cfg.image;
  const big = c => c.width >= minWidth;
  const p18 = wd ? await fileInfo(wd.images.slice(0, 10), maxSize) : [];

  if (canUpdate(card, prevState, 'photo')) {
    let photos = p18.filter(c => !c.isIllustration && big(c));
    if (!photos.length) {
      const inat = (await findPhotos(row.scientific_name, wd?.inatId)).filter(big);
      const best = pickBest(inat);
      photos = best ? [best] : [];
    }
    const photo = await chooseImage('photo', card, cfg, photos, notes);
    values.photo = photo;
    if (!photo && !card.photo) issues.push('No photo with an allowed licence found — add one by hand');
    if (photo?.author === 'Unknown') issues.push(`Photo author unknown — check the source page and fill in "author": ${photo.sourceUrl}`);
  }

  if (canUpdate(card, prevState, 'illustration')) {
    let ills = p18.filter(c => c.isIllustration && big(c));
    let searched = false;
    if (!ills.length && cfg.illustrationSearch) {
      ills = (await searchIllustrations(row.scientific_name, maxSize)).filter(big);
      searched = true;
    }
    const ill = await chooseImage('illustration', card, cfg, ills, notes);
    values.illustration = ill;
    if (ill && searched) issues.push(`Illustration auto-picked by search — please check it (add "illustration" to the card's "locked" list to keep it and stop this reminder): ${ill.sourceUrl}`);
  }

  if (canUpdate(card, prevState, 'silhouette') && wd?.gbifIds?.length) {
    const sil = await chooseSilhouette(card, wd.gbifIds, row.scientific_name, notes);
    values.silhouette = sil;
    const binomial = row.scientific_name.split(/\s+/).slice(0, 2).join(' ').toLowerCase();
    if (sil && !sil.taxon.toLowerCase().startsWith(binomial)) notes.push(`silhouette is of a related animal (${sil.taxon})`);
  }

  Object.assign(values, await rangeValues(card, row, wd, notes, issues));
  return values;
}

// ---------- range maps ----------

let landPolys = null;
const padBounds = b => {
  const px = Math.max((b.east - b.west) * 0.12, 0.4), py = Math.max((b.north - b.south) * 0.12, 0.4);
  const r = v => Math.round(v * 100) / 100;
  return { west: r(b.west - px), south: r(b.south - py), east: r(b.east + px), north: r(b.north + py) };
};
function geoBounds(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return { west: w, south: s, east: e, north: n };
}

// The range shape for the map: your own file in data/ranges-manual/<id>.json if there is
// one (never touched), otherwise made from GBIF records into data/ranges/<id>.json.
// The map zooms to it (mapBounds), unless your mapBounds has "manual": true.
async function rangeValues(card, row, wd, notes, issues) {
  const values = {};
  const manual = `data/ranges-manual/${card.id}.json`;
  if (existsSync(path.join(ROOT, manual))) {
    const geo = JSON.parse(await readFile(path.join(ROOT, manual), 'utf8'));
    values.range = manual;
    if (!card.mapBounds?.manual) values.mapBounds = padBounds(geoBounds(geo.geometry ?? geo.features[0].geometry));
    notes.push('range: your hand-made shape in data/ranges-manual/');
    return values;
  }
  if (!wd?.gbifIds?.length) return values;
  const occ = await findOccurrences(wd.gbifIds);
  landPolys ??= await loadLand(ROOT);
  const shape = occ && makeRange(occ.points, landPolys);
  if (!shape) {
    issues.push('Not enough GBIF records with coordinates for a range map — you can draw one in data/ranges-manual/');
    return values;
  }
  const file = `data/ranges/${card.id}.json`;
  await mkdir(path.join(ROOT, 'data/ranges'), { recursive: true });
  await writeFile(path.join(ROOT, file), JSON.stringify({
    type: 'Feature',
    properties: {
      species: row.scientific_name,
      source: 'Range based on GBIF occurrence data (gbif.org); coastlines: Natural Earth (public domain)',
      records: occ.records,
      openLicenceRecordsOnly: occ.openOnly,
      habitat: shape.habitat,
      cellDegrees: shape.cellDegrees,
    },
    geometry: shape.geometry,
  }) + '\n', 'utf8');
  values.range = file;
  if (!card.mapBounds?.manual) values.mapBounds = padBounds(shape.bbox);
  notes.push(`range shape from ${occ.records} ${occ.openOnly ? 'CC0/CC BY ' : ''}GBIF records (${shape.habitat}${shape.islands ? `, ${shape.islands} island(s) filled` : ''})`);
  return values;
}

// Plain vector drawings only: nothing that could run code if the file were opened directly.
const SAFE_SVG = svg => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(svg)
  && !/<script|\son\w+\s*=|javascript:|<foreignObject/i.test(svg);

// PhyloPic silhouette, saved as SVG in img/silhouettes/. Used for size comparisons.
async function chooseSilhouette(card, gbifIds, scientificName, notes) {
  const pick = await findSilhouette(gbifIds, scientificName);
  if (!pick) return undefined;
  const cur = card.silhouette;
  const credit = { author: pick.author, license: pick.license, licenseUrl: pick.licenseUrl, sourceUrl: pick.sourceUrl, taxon: pick.taxon };
  if (cur?.sourceUrl === pick.sourceUrl && existsSync(path.join(ROOT, cur.file))) return { file: cur.file, ...credit };
  const svg = (await getBuffer(pick.downloadUrl)).toString('utf8');
  if (!SAFE_SVG(svg)) {
    notes.push('silhouette skipped: the SVG file did not look like a plain drawing');
    return undefined;
  }
  const file = `img/silhouettes/${card.id}-${shortHash(pick.sourceUrl)}.svg`;
  await mkdir(path.join(ROOT, 'img/silhouettes'), { recursive: true });
  await writeFile(path.join(ROOT, file), svg, 'utf8');
  notes.push(`silhouette: downloaded from PhyloPic (${pick.license})`);
  return { file, ...credit };
}

function describeKept(field) {
  return `Kept your edit of "${field}"`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = await readJson(P.config, {});
  setUserAgent(cfg.userAgent);

  const groups = await readJson(P.groups, []);
  const groupByCsv = new Map(groups.map(g => [g.csv, g.id]));
  const rows = parseCsv(await readFile(P.csv, 'utf8')).map((r, index) => {
    const groupId = groupByCsv.get(r.group);
    if (!groupId) throw new Error(`Row ${index + 2}: unknown group "${r.group}" (add it to data/groups.json)`);
    return { ...r, index, groupId, id: slugify(r.name_en) };
  });
  const dupes = rows.filter((r, i) => rows.findIndex(o => o.id === r.id) !== i);
  if (dupes.length) throw new Error(`Duplicate card names: ${dupes.map(d => d.name_en).join(', ')}`);

  const existing = await readJson(P.cards, []);
  const state = await readJson(P.state, {});
  const dates = unlockSchedule(rows, groups, cfg.unlock);
  const locations = await readJson(P.locations, {}); // globe pins for places and fossils

  // Match existing cards by id, then scientific name, then Chinese name, so renaming
  // a card in the CSV doesn't lose the facts you wrote for it.
  const used = new Set();
  const findExisting = row => {
    const hit = existing.find(c => !used.has(c) && c.id === row.id)
      ?? (row.scientific_name ? existing.find(c => !used.has(c) && c.scientificName === row.scientific_name) : undefined)
      ?? (row.name_zh ? existing.find(c => !used.has(c) && c.name?.zh === row.name_zh) : undefined);
    if (hit) used.add(hit);
    return hit;
  };
  const matched = rows.map(row => ({ row, card: findExisting(row) }));

  const limit = args.all ? Infinity : (args.limit ?? cfg.limit ?? Infinity);
  const selected = args.only
    ? matched.filter(m => args.only.includes(m.row.id) || args.only.includes(m.card?.id))
    : matched.slice(0, limit);

  const report = new Map(); // id -> { issues, notes }
  let n = 0;
  for (const m of selected) {
    const { row } = m;
    const card = m.card ?? blankCard(row);
    m.card = card;
    const id = card.id;
    const prev = state[id];
    const issues = [], notes = [];
    process.stdout.write(`[${++n}/${selected.length}] ${row.name_en} … `);

    // Facts and habitat are yours: only make sure the slots exist.
    card.facts = Array.isArray(card.facts) ? card.facts : [];
    while (card.facts.length < 3) card.facts.push({ en: '', zh: '' });
    card.habitat ??= { en: '', zh: '' };
    delete card.rangePoints; // replaced by the range shape (range)

    const values = {
      group: row.groupId,
      'name.en': row.name_en,
      taiwan: row.taiwan === 'Y',
      unlockDate: dates.get(row),
      scientificName: row.scientific_name || null,
    };
    if (row.name_zh) values['name.zh'] = row.name_zh;
    // Zhuyin: one syllable per Chinese character, separated by spaces.
    if (row.zhuyin) {
      values['name.zhuyin'] = row.zhuyin;
      const han = [...row.name_zh].filter(c => /\p{Script=Han}/u.test(c)).length;
      const syl = row.zhuyin.split(/\s+/).length;
      if (syl !== han) issues.push(`Zhuyin has ${syl} syllables but ${row.name_zh} has ${han} characters`);
    } else if (row.name_zh) issues.push('No zhuyin in the list for the Chinese name');
    const loc = locations[row.id] ?? locations[id];
    if (loc?.place) values.place = loc.place;
    if (loc?.fossilSite) values.fossilSite = loc.fossilSite;

    if (row.scientific_name && !args.offline) {
      try {
        Object.assign(values, await processSpecies(row, card, prev, cfg, issues, notes));
      } catch (err) {
        issues.push(`Build error (card left as it was, try again later): ${err.message}`);
      }
    }

    const { kept, state: nextState } = mergeCard(card, prev, values);
    state[id] = nextState;
    for (const f of kept) notes.push(describeKept(f));
    report.set(id, { row, card, issues, notes });
    console.log(issues.length ? `${issues.length} to check` : 'ok');
  }

  // Output: CSV order (processed now or earlier), then cards no longer in the CSV.
  const cards = matched.filter(m => m.card).map(m => m.card);
  const orphans = existing.filter(c => !cards.includes(c));

  // Thumbnails for every referenced image, including ones you added by hand.
  const imageProblems = [];
  for (const card of [...cards, ...orphans]) {
    for (const kind of ['photo', 'illustration']) {
      const img = card[kind];
      if (!img?.file) continue;
      if (!isAllowedLicenseName(img.license)) imageProblems.push(`${card.id} ${kind}: licence "${img.license}" is not PD/CC0/CC BY/CC BY-SA`);
      for (const k of ['author', 'license', 'sourceUrl']) if (!img[k]) imageProblems.push(`${card.id} ${kind}: missing ${k}`);
      const r = await ensureThumb(ROOT, img.file, cfg.image);
      if (r === 'missing-source') imageProblems.push(`${card.id} ${kind}: file not found: ${img.file}`);
    }
    const sil = card.silhouette;
    if (sil?.file) {
      if (!isAllowedLicenseName(sil.license)) imageProblems.push(`${card.id} silhouette: licence "${sil.license}" is not PD/CC0/CC BY/CC BY-SA`);
      if (!existsSync(path.join(ROOT, sil.file))) imageProblems.push(`${card.id} silhouette: file not found: ${sil.file}`);
    }
  }

  // Images on disk that no card uses any more (left in place; delete them if you like).
  const referenced = new Set(cards.concat(orphans).flatMap(c => [c.photo?.file, c.illustration?.file]).filter(Boolean));
  const imgDir = path.join(ROOT, 'img');
  let unused = existsSync(imgDir)
    ? (await readdir(imgDir)).filter(f => /\.(webp|jpe?g|png)$/i.test(f) && !referenced.has(`img/${f}`))
    : [];
  if (args.prune) {
    for (const f of unused) {
      await rm(path.join(imgDir, f));
      await rm(path.join(ROOT, thumbPath(`img/${f}`)), { force: true });
    }
    if (unused.length) console.log(`Pruned ${unused.length} unused image(s)`);
    unused = [];
  }

  await writeJson(P.cards, [...cards, ...orphans].map(orderKeys));
  await writeJson(P.state, state);
  await writeFile(P.report, renderReport({ rows, cards, orphans, report, imageProblems, unused, selected }), 'utf8');
  console.log(`\nWrote ${path.relative(ROOT, P.cards)} (${cards.length + orphans.length} cards) and ${path.relative(ROOT, P.report)}`);
}

function renderReport({ rows, cards, orphans, report, imageProblems, unused, selected }) {
  const L = [];
  const species = cards.filter(c => c.scientificName);
  const topics = cards.filter(c => !c.scientificName);
  const factsTodo = cards.filter(c => (c.facts ?? []).some(f => !f.en || !f.zh));
  const habitatTodo = cards.filter(c => !c.habitat?.en || !c.habitat?.zh);
  const noPhoto = cards.filter(c => !c.photo);

  L.push('# Build report', '');
  L.push(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC. Re-written on every build.`, '');
  L.push('## Summary', '');
  L.push(`- Rows in card-list.csv: ${rows.length}`);
  L.push(`- Cards in animals.json: ${cards.length} (${species.length} species, ${topics.length} topic)`);
  L.push(`- Processed this run: ${selected.length}`);
  L.push(`- Rows not built yet: ${rows.length - cards.length} (run with \`--all\` or a bigger \`--limit\`)`);
  L.push(`- Cards without a photo: ${noPhoto.length}`);
  L.push(`- Cards with facts still to write: ${factsTodo.length}`);
  L.push(`- Cards with habitat still to write: ${habitatTodo.length}`);
  L.push(`- Cards with inside pages (profile, statistics, life cycle): ${cards.filter(c => c.profile || c.stats || c.lifeCycle).length}`, '');

  const attention = [...report.values()].filter(r => r.issues.length);
  L.push('## Needs your attention', '');
  if (!attention.length) L.push('Nothing — all processed cards look fine.', '');
  for (const { card, issues } of attention) {
    L.push(`### ${card.name.en} · ${card.name.zh} (\`${card.id}\`)`, '');
    for (const i of issues) L.push(`- ${i}`);
    L.push('');
  }

  if (imageProblems.length) {
    L.push('## Image problems', '');
    for (const p of imageProblems) L.push(`- ${p}`);
    L.push('');
  }

  if (topics.length) {
    L.push('## Topic cards (written by hand)', '');
    L.push('These have no scientific name, so the build only creates the slots. Add facts, a habitat/description and an image yourself.', '');
    for (const c of topics) L.push(`- ${c.name.en} · ${c.name.zh} (\`${c.id}\`)${c.photo ? '' : ' — no image yet'}`);
    L.push('');
  }

  if (orphans.length) {
    L.push('## Cards no longer in card-list.csv', '');
    L.push('Kept in animals.json so nothing you wrote is lost. Delete them by hand if you don\'t want them.', '');
    for (const c of orphans) L.push(`- ${c.name?.en} (\`${c.id}\`)`);
    L.push('');
  }

  if (unused.length) {
    L.push('## Unused image files', '');
    L.push('No card points at these files in img/ any more. Run with `--prune` to delete them.', '');
    for (const f of unused) L.push(`- img/${f}`);
    L.push('');
  }

  const drafts = cards.filter(c => c._draft?.length);
  if (drafts.length) {
    L.push('## Draft text to check', '');
    L.push('Written by Claude as a starting point. Check or rewrite it, then remove the field name from `_draft`.', '');
    for (const c of drafts) L.push(`- ${c.name.en} · ${c.name.zh} (\`${c.id}\`): ${c._draft.join(', ')}`);
    L.push('');
  }

  const noted = [...report.values()].filter(r => r.notes.length);
  if (noted.length) {
    L.push('## Notes', '');
    for (const { card, notes } of noted) L.push(`- **${card.name.en}**: ${notes.join('; ')}`);
    L.push('');
  }
  return L.join('\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
