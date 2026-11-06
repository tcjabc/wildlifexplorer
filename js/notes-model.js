// Field Notes pages and their animal tags, as plain data in and out (tests/notes-model.test.mjs).
//
// A page has zero or more animal tags (card ids, in order: the first names the page), its
// content (a fixed PAGE_W × PAGE_H page of vector items) and createdAt / editedAt.
// A page with no tags is a free page. Tags change only through the chips on the page and
// the stamp tool (a stamp adds its animal; removing it leaves the tag).
//
// The index (IndexedDB "notes", one record per page) carries the same tags, so the binder,
// a card's notebook and the contents never have to open every page.

export const PAGE_VERSION = 2;

// The page: 4:5. Pages used to be 5:7, 1000 wide at the same height (see widenPage).
export const PAGE_W = 1120;
export const PAGE_H = 1400;
const OLD_PAGE_W = 1000;

const uniq = ids => [...new Set(ids.filter(id => typeof id === 'string' && id))];

// ---------- pages from before tags (version 1) ----------

// What a version 1 page was linked to, header card first: the card in its header, cards it
// was drawn on next to, and every animal stamped on it. These become its tags.
export function legacyTags(page) {
  return uniq([page?.header?.cardId, ...(page?.links ?? []), ...(page?.items ?? []).filter(i => i?.t === 'm').map(i => i.card)]);
}

// ---------- pages from before the wider page ----------

function shifted(item, dx) {
  if (item?.t === 's') {
    const p = [...item.p];
    for (let i = 0; i < p.length; i += 3) p[i] += dx;
    return { ...item, p };
  }
  if (item?.t === 'f') return { ...item, p: movedTrail(item.p, { dx }) };
  return typeof item?.x === 'number' ? { ...item, x: item.x + dx } : item;
}

// A 5:7 page on the wider paper: what is on it stays the same size, centred, with extra paper left
// and right. `w` says which a page is, so this happens once: it is done as a page loads, and the
// file only changes when the page next does.
export function widenPage(page) {
  const was = page.w ?? OLD_PAGE_W;
  if (was >= PAGE_W) return page;
  const dx = (PAGE_W - was) / 2;
  return { ...page, w: PAGE_W, items: (page.items ?? []).map(it => shifted(it, dx)) };
}

// A page as the notebook uses it. Version 1 pages get their tags from what they were linked
// to (or from their index record, which held the same list), and 5:7 pages their extra paper.
export function normalisePage(page, rec = null) {
  if (!page) return page;
  const tags = Array.isArray(page.tags) ? uniq(page.tags) : uniq(rec?.tags ?? rec?.cardIds ?? legacyTags(page));
  return {
    ...widenPage(page),
    version: Math.max(PAGE_VERSION, page.version ?? 1),
    tags,
    editedAt: page.editedAt ?? rec?.editedAt ?? rec?.updatedAt ?? page.createdAt,
  };
}

// A version 1 index record ({ cardIds }) as a version 2 one ({ tags, editedAt }); null when
// it is already current. Safe to run again: a migrated record is left alone.
export function migrateRecord(rec) {
  if (!rec || Array.isArray(rec.tags)) return null;
  const { cardIds, ...rest } = rec;
  return { ...rest, tags: uniq(cardIds ?? []), editedAt: rec.editedAt ?? rec.updatedAt ?? rec.createdAt };
}

// ---------- tags ----------

export const withTag = (tags, id) => (id && !tags.includes(id) ? [...tags, id] : tags);
export const withoutTag = (tags, id) => tags.filter(t => t !== id);
// Placing a stamp tags the page with that animal (once).
export const tagsAfterStamp = (tags, cardId) => withTag(tags, cardId);

// ---------- footprint trails ----------

// A trail ([x, y, …]) moved by (dx, dy), or scaled k times and turned by a radians about (cx, cy).
// Only its path changes: the prints themselves keep their size.
export function movedTrail(p, { dx = 0, dy = 0, cx = 0, cy = 0, k = 1, a = 0 }) {
  const c = Math.cos(a) * k, s = Math.sin(a) * k, out = new Array(p.length);
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i] - cx, y = p[i + 1] - cy;
    out[i] = cx + x * c - y * s + dx;
    out[i + 1] = cy + x * s + y * c + dy;
  }
  return out;
}

// The header's title: the first tag's name, and how many more there are. A free page has none.
export function titleOf(tags, known = () => true) {
  const shown = tags.filter(known);
  return shown.length ? { first: shown[0], more: shown.length - 1 } : null;
}

// ---------- which pages ----------

const byCreated = (a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || (a.pageId ?? '').localeCompare(b.pageId ?? '');
const editedOf = r => r.editedAt ?? r.updatedAt ?? r.createdAt ?? '';

// One animal's pages, oldest first (the order the arrows step through).
export const pagesOf = (index, cardId) => index.filter(r => r.tags?.includes(cardId)).sort(byCreated);

// Free pages: no tags, or only tags of animals no longer in the card list (so nothing hides).
export const freePages = (index, known = () => true) => index.filter(r => !(r.tags ?? []).some(known)).sort(byCreated);

// Where a list of pages opens: on the most recently edited one.
export function latestIndex(recs) {
  let best = -1;
  recs.forEach((r, i) => { if (best < 0 || editedOf(r) > editedOf(recs[best])) best = i; });
  return best;
}

// Opening one animal's notebook: its most recently edited page, or a new draft page tagged
// with it when it has none. The draft is saved only when something goes on it, so opening
// (however often) never makes a page, let alone a duplicate.
export function openFor(index, cardId) {
  const pages = pagesOf(index, cardId);
  return pages.length ? { ids: pages.map(r => r.pageId), pos: latestIndex(pages) } : { ids: [], pos: 0, draft: { tags: [cardId] } };
}

// The contents: binder groups (in their order) with the animals that have pages, each with
// its pages (oldest first), page count and latest page; a page with several tags is listed
// under each of them, with the others as "also in". Then the free pages. Pages never move:
// this is only a view of their tags.
//   index: the profile's records; cardOf(id): the card or null; groups: [{ id, ... }] in order
export function contents(index, cardOf, groups) {
  const known = id => Boolean(cardOf(id));
  const animals = new Map();
  for (const r of [...index].sort(byCreated)) {
    const tags = (r.tags ?? []).filter(known);
    for (const id of tags) {
      if (!animals.has(id)) animals.set(id, []);
      animals.get(id).push({ rec: r, alsoIn: tags.filter(t => t !== id) });
    }
  }
  const order = new Map(groups.map((g, i) => [g.id, i]));
  const sections = groups.map(g => ({ group: g, animals: [] }));
  for (const [cardId, pages] of animals) {
    const card = cardOf(cardId);
    const section = sections[order.get(card.group) ?? -1];
    if (!section) continue;
    section.animals.push({ cardId, card, pages, count: pages.length, latest: pages[latestIndex(pages.map(p => p.rec))].rec });
  }
  for (const s of sections) s.animals.sort((a, b) => (a.card.number ?? 0) - (b.card.number ?? 0) || a.cardId.localeCompare(b.cardId));
  return { groups: sections.filter(s => s.animals.length), free: freePages(index, known) };
}
