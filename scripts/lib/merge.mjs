// Protects hand edits in animals.json.
//
// For every field the build writes, data/build-state.json remembers the value the
// build wrote last time. On a re-run a field is only updated when its current value
// is still exactly what the build wrote (or it is empty). If you changed it, it stays.
// Fields listed in a card's "locked" array are never touched, even if empty.
// Fields the build never writes (facts, habitat, anything you add) are never touched.

export const BUILD_FIELDS = [
  'group', 'scientificName', 'name.en', 'name.zh', 'taiwan', 'status',
  'taxonomy', 'wikidata', 'photo', 'illustration', 'silhouette', 'mapBounds', 'rangePoints', 'unlockDate',
];

const get = (obj, p) => p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
function set(obj, p, v) {
  const keys = p.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  if (v === undefined) delete target[last];
  else target[last] = v;
}

const isEmpty = v => v === undefined || v === null || v === '' ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const isLocked = (card, field) =>
  (card.locked ?? []).includes(field) || (card.locked ?? []).includes(field.split('.')[0]);

// May the build write this field? (Used to skip image searches for fields you own.)
export function canUpdate(card, prevState, field) {
  if (isLocked(card, field)) return false;
  const cur = get(card, field);
  return isEmpty(cur) || Boolean(prevState && same(cur, prevState[field]));
}

// Apply build values to a card; returns the fields kept because you edited them,
// and the new state to remember for this card.
export function mergeCard(card, prevState, values) {
  const kept = [];
  const state = {};
  for (const field of BUILD_FIELDS) {
    const prev = prevState?.[field];
    const next = values[field];
    if (next === undefined || isLocked(card, field)) {
      // Nothing new from the build, or locked: leave the card and the memory as they were.
      if (prev !== undefined) state[field] = prev;
      continue;
    }
    const cur = get(card, field);
    if (isEmpty(cur) || same(cur, next) || (prevState && same(cur, prev))) {
      set(card, field, next);
      state[field] = next;
    } else {
      kept.push(field);                 // you changed it: leave it alone
      if (prev !== undefined) state[field] = prev;
    }
  }
  return { kept, state };
}

export { get as getPath };
