// The shape of a card in data/animals.json, and moving older cards to it.
//
// Only moves what is already there and adds empty slots ({ en: '', zh: '' }) for what is
// still to write. It never writes content. Running it twice changes nothing.
//
// Version 3: factFile.food → factFile.foodAndHunting; didYouKnow becomes a list (1–2 items);
// any paragraph may carry "todo" (not checked yet: grown-up preview only); _sources lists where
// the facts come from.
//
// Version 2 (the Fact File):
//   habitat (one pair)        → factFile.habitat (a list of paragraphs)
//   lifeCycle (steps)         → factFile.breeding (one paragraph per step, in order)
//   stats.gestation(+Days)    → stats.development { kind: 'gestation', days, en, zh }
//   _draft 'habitat' / 'lifeCycle' → 'factFile.habitat' / 'factFile.breeding'
// New: factFile.behaviour / food / conservation / didYouKnow, related, callout detail.

// The Fact File on the back of a card, in the order it is shown.
export const FACT_SECTIONS = ['habitat', 'breeding', 'behaviour', 'foodAndHunting', 'conservation'];

export const KEY_ORDER = ['id', 'group', 'scientificName', 'name', 'facts', 'factFile', 'status', 'taiwan', 'continents', 'biomes',
  'photo', 'illustration', 'labelTone', 'map', 'mapBounds', 'range', 'place', 'fossilSite', 'profile', 'stats', 'compare', 'related', 'silhouette',
  'taxonomy', 'wikidata', 'locked', '_draft', '_sources'];

export function orderKeys(card) {
  const out = {};
  for (const k of KEY_ORDER) if (k in card) out[k] = card[k];
  for (const k of Object.keys(card)) if (!(k in out)) out[k] = card[k];
  return out;
}

const blank = () => ({ en: '', zh: '' });
const isPair = p => p && typeof p === 'object' && !Array.isArray(p) && ('en' in p || 'zh' in p);
const filled = p => isPair(p) && Boolean(p.en?.trim() || p.zh?.trim());
const DRAFT_RENAMES = { habitat: 'factFile.habitat', lifeCycle: 'factFile.breeding', 'factFile.food': 'factFile.foodAndHunting' };

// A list of paragraphs from a pair or a list; at least one slot.
function paragraphs(v) {
  const list = (Array.isArray(v) ? v : isPair(v) ? [v] : []).filter(isPair).map(p => ({ ...p }));
  const kept = list.filter(filled);
  return kept.length ? kept : [blank()];
}

// Move a card to the current shape (returns a new object; the input is not changed).
export function migrateCard(input) {
  const card = structuredClone(input);
  const species = Boolean(card.scientificName);
  const old = { habitat: card.habitat, lifeCycle: card.lifeCycle };
  delete card.habitat;
  delete card.lifeCycle;

  // Topic cards (no scientific name) have no Fact File unless there is something to keep.
  const keep = filled(old.habitat) || (old.lifeCycle ?? []).some(filled);
  if (species || card.factFile || keep) {
    const ff = { ...(card.factFile ?? {}) };
    if ('food' in ff && !('foodAndHunting' in ff)) ff.foodAndHunting = ff.food;
    delete ff.food;
    const out = {};
    // What the card already has wins; the old fields only fill empty sections.
    out.habitat = paragraphs((ff.habitat && paragraphs(ff.habitat).some(filled)) ? ff.habitat : old.habitat);
    out.breeding = paragraphs((ff.breeding && paragraphs(ff.breeding).some(filled)) ? ff.breeding : old.lifeCycle);
    for (const k of FACT_SECTIONS.slice(2)) out[k] = paragraphs(ff[k]);
    out.didYouKnow = paragraphs(ff.didYouKnow);
    for (const k of Object.keys(ff)) if (!(k in out)) out[k] = ff[k]; // anything else you added
    card.factFile = out;
  }

  // Gestation (or incubation): one generic row.
  const s = card.stats;
  if (s && (s.gestation || s.gestationDays) && !s.development) {
    const text = filled(s.gestation) ? { en: s.gestation.en ?? '', zh: s.gestation.zh ?? '' } : {};
    s.development = { kind: 'gestation', days: s.gestationDays ?? null, ...text };
  }
  if (s) { delete s.gestation; delete s.gestationDays; }

  if (species && !Array.isArray(card.related)) card.related = [];
  for (const c of card.profile?.callouts ?? []) c.detail ??= blank();
  if (card._draft) card._draft = [...new Set(card._draft.map(f => DRAFT_RENAMES[f] ?? f))];
  return orderKeys(card);
}

// What is still empty on a card, for the build report. [] when nothing is missing.
export function factFileTodo(card) {
  if (!card.factFile) return [];
  const ff = card.factFile;
  const done = p => p.en?.trim() && p.zh?.trim();
  return [...FACT_SECTIONS, 'didYouKnow'].filter(k => !(ff[k] ?? []).some(done));
}

// Text marked "todo" (not checked yet): [{ where, note, en }].
export function todosOf(card) {
  const out = [];
  for (const k of [...FACT_SECTIONS, 'didYouKnow']) {
    for (const p of card.factFile?.[k] ?? []) if (p.todo) out.push({ where: `factFile.${k}`, note: p.todo, en: p.en });
  }
  for (const k of ['development', 'youngCount']) {
    const s = card.stats?.[k];
    if (s?.todo) out.push({ where: `stats.${k}`, note: s.todo, en: '' });
  }
  return out;
}

// Glossary ids used in a card's text: [[id]] or [[id|shown]].
export const TERM = /\[\[([a-z0-9-]+)(?:\|[^\]]+)?\]\]/g;
export function termsOf(card) {
  const ids = new Set();
  const scan = s => { for (const m of (s ?? '').matchAll(TERM)) ids.add(m[1]); };
  for (const k of [...FACT_SECTIONS, 'didYouKnow']) for (const p of card.factFile?.[k] ?? []) { scan(p.en); scan(p.zh); }
  for (const c of card.profile?.callouts ?? []) { scan(c.detail?.en); scan(c.detail?.zh); }
  return ids;
}

// Vital statistics the Profile spread can show but this card doesn't have yet.
export function statsTodo(card) {
  if (!card.scientificName || card.group === 'plants') return [];
  const s = card.stats ?? {};
  const out = [];
  if (!(s.development?.kind && (s.development.days || filled(s.development)))) out.push('development (gestation or incubation)');
  if (!(s.youngCount || filled(s.young))) out.push('number of young');
  return out;
}
