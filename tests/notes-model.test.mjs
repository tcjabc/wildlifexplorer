// Field Notes pages with animal tags (js/notes-model.js): migrating pages from before tags,
// which page a card's notebook opens on, the contents, free pages and the stamp tool.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pageFull, bitmapsIn, PAGE_CAP,
  legacyTags, normalisePage, migrateRecord, withTag, withoutTag, tagsAfterStamp, titleOf,
  pagesOf, freePages, latestIndex, openFor, contents, movedTrail, widenPage, PAGE_W, PAGE_H,
} from '../js/notes-model.js';

const CARDS = {
  'formosan-black-bear': { id: 'formosan-black-bear', group: 'mammals', number: 1 },
  'sika-deer': { id: 'sika-deer', group: 'mammals', number: 3 },
  'taiwan-blue-magpie': { id: 'taiwan-blue-magpie', group: 'birds', number: 20 },
};
const cardOf = id => CARDS[id] ?? null;
const known = id => Boolean(cardOf(id));
const GROUPS = [{ id: 'mammals' }, { id: 'birds' }, { id: 'reptiles' }];
const rec = (pageId, tags, createdAt, editedAt = createdAt) => ({ pageId, tags, createdAt, editedAt });

// ---------- migration ----------

test('migration: a version 1 page is tagged with everything it was linked to, header card first', () => {
  const v1 = {
    id: 'p1', version: 1, header: { date: '2026-10-01T09:00:00.000Z', cardId: 'sika-deer' },
    links: ['formosan-black-bear'], items: [{ t: 's', p: [] }, { t: 'm', card: 'taiwan-blue-magpie' }, { t: 'm', card: 'sika-deer' }],
    createdAt: '2026-10-01T09:00:00.000Z',
  };
  assert.deepEqual(legacyTags(v1), ['sika-deer', 'formosan-black-bear', 'taiwan-blue-magpie']);
  const page = normalisePage(v1);
  assert.deepEqual(page.tags, ['sika-deer', 'formosan-black-bear', 'taiwan-blue-magpie']);
  assert.equal(page.version, 2);
  assert.deepEqual(page.items, v1.items, 'the content is unchanged');
  assert.equal(page.editedAt, v1.createdAt);
});

test('migration: a page with no link becomes a free page; nothing is lost', () => {
  const v1 = { id: 'p2', version: 1, header: { date: 'x', cardId: null }, links: [], items: [{ t: 'x', v: 'hi' }], createdAt: 'x' };
  const page = normalisePage(v1);
  assert.deepEqual(page.tags, []);
  assert.deepEqual(page.items, v1.items);
});

test('migration: index records get tags from their linked cards, once', () => {
  const old = { id: 'kid:p1', profileId: 'kid', pageId: 'p1', cardIds: ['sika-deer', 'sika-deer', 'formosan-black-bear'], createdAt: 'a', updatedAt: 'b', deletedAt: null };
  const next = migrateRecord(old);
  assert.deepEqual(next.tags, ['sika-deer', 'formosan-black-bear']);
  assert.equal(next.editedAt, 'b');
  assert.equal('cardIds' in next, false);
  assert.equal(migrateRecord(next), null, 'a migrated record is left alone');
  assert.deepEqual(migrateRecord({ ...old, cardIds: [] }).tags, []);
});

test('migration: a page file from before tags takes the tags its index record already has', () => {
  const page = normalisePage({ id: 'p1', header: {}, items: [], createdAt: 'a' }, { tags: ['sika-deer'], editedAt: 'c' });
  assert.deepEqual(page.tags, ['sika-deer']);
  assert.equal(page.editedAt, 'c');
  // A page that has tags keeps its own.
  assert.deepEqual(normalisePage({ id: 'p1', tags: ['formosan-black-bear'], items: [] }, { tags: ['sika-deer'] }).tags, ['formosan-black-bear']);
});

// ---------- opening a card's notebook ----------

const INDEX = [
  rec('old', ['formosan-black-bear'], '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z'),
  rec('recent', ['formosan-black-bear', 'sika-deer'], '2026-09-10T00:00:00Z', '2026-11-03T00:00:00Z'),
  rec('newest', ['formosan-black-bear'], '2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z'),
  rec('free', [], '2026-10-05T00:00:00Z'),
  rec('gone', ['an-animal-no-longer-in-the-list'], '2026-10-06T00:00:00Z'),
];

test("a card's notebook steps through that animal's pages only, oldest first, and opens on the most recently edited", () => {
  assert.deepEqual(pagesOf(INDEX, 'formosan-black-bear').map(r => r.pageId), ['old', 'recent', 'newest']);
  const o = openFor(INDEX, 'formosan-black-bear');
  assert.deepEqual(o.ids, ['old', 'recent', 'newest']);
  assert.equal(o.ids[o.pos], 'recent', 'edited last, though not created last');
  assert.equal(o.draft, undefined);
  assert.equal(latestIndex([]), -1);
});

test('no duplicate page on open: an animal with no pages gets a draft, and opening again changes nothing', () => {
  const index = [...INDEX];
  const first = openFor(index, 'taiwan-blue-magpie');
  assert.deepEqual(first, { ids: [], pos: 0, draft: { tags: ['taiwan-blue-magpie'] } });
  assert.equal(index.length, INDEX.length, 'opening makes no page');
  const again = openFor(index, 'taiwan-blue-magpie');
  assert.deepEqual(again, first);
  // Once something goes on the draft it is saved: from then on that page opens, not a new one.
  index.push(rec('magpie-1', ['taiwan-blue-magpie'], '2026-11-04T00:00:00Z'));
  assert.deepEqual(openFor(index, 'taiwan-blue-magpie'), { ids: ['magpie-1'], pos: 0 });
  assert.deepEqual(openFor(index, 'taiwan-blue-magpie'), { ids: ['magpie-1'], pos: 0 });
});

// ---------- contents ----------

test('contents: binder groups in order, only animals with pages, counts and the latest page', () => {
  const c = contents(INDEX, cardOf, GROUPS);
  assert.deepEqual(c.groups.map(s => s.group.id), ['mammals'], 'no birds or reptiles pages yet');
  const [bear, deer] = c.groups[0].animals;
  assert.equal(bear.cardId, 'formosan-black-bear');
  assert.equal(bear.count, 3);
  assert.equal(bear.latest.pageId, 'recent');
  assert.equal(deer.cardId, 'sika-deer');
  assert.equal(deer.count, 1);
});

test('contents: a page with several tags appears under each of its animals, "also in" the others', () => {
  const c = contents(INDEX, cardOf, GROUPS);
  const [bear, deer] = c.groups[0].animals;
  const underBear = bear.pages.find(p => p.rec.pageId === 'recent');
  const underDeer = deer.pages.find(p => p.rec.pageId === 'recent');
  assert.deepEqual(underBear.alsoIn, ['sika-deer']);
  assert.deepEqual(underDeer.alsoIn, ['formosan-black-bear']);
  assert.deepEqual(bear.pages.find(p => p.rec.pageId === 'old').alsoIn, []);
});

test('contents: free pages, including pages whose only animal is no longer in the card list', () => {
  const c = contents(INDEX, cardOf, GROUPS);
  assert.deepEqual(c.free.map(r => r.pageId), ['free', 'gone']);
  assert.deepEqual(freePages(INDEX, known).map(r => r.pageId), ['free', 'gone']);
});

test('free page ↔ tagged: tagging moves it under the animal, removing its last tag puts it back', () => {
  let index = INDEX.map(r => ({ ...r }));
  const page = () => index.find(r => r.pageId === 'free');
  page().tags = withTag(page().tags, 'taiwan-blue-magpie');
  let c = contents(index, cardOf, GROUPS);
  assert.deepEqual(c.free.map(r => r.pageId), ['gone']);
  const birds = c.groups.find(s => s.group.id === 'birds');
  assert.deepEqual(birds.animals.map(a => a.cardId), ['taiwan-blue-magpie']);
  assert.deepEqual(birds.animals[0].pages.map(p => p.rec.pageId), ['free']);

  page().tags = withoutTag(page().tags, 'taiwan-blue-magpie');
  c = contents(index, cardOf, GROUPS);
  assert.deepEqual(c.free.map(r => r.pageId), ['free', 'gone']);
  assert.equal(c.groups.some(s => s.group.id === 'birds'), false);
  // Pages never move: the same records, only their tags changed.
  assert.equal(index.length, INDEX.length);
});

// ---------- the stamp tool and the title ----------

// (Erasing a stamp leaving the tag is checked in tests/notes-store.test.mjs.)
test('a stamp adds its animal as a tag, once, after the tags already there', () => {
  const t1 = tagsAfterStamp([], 'sika-deer');
  assert.deepEqual(t1, ['sika-deer']);
  assert.equal(tagsAfterStamp(t1, 'sika-deer'), t1, 'already there: unchanged');
  assert.deepEqual(tagsAfterStamp(t1, 'formosan-black-bear'), ['sika-deer', 'formosan-black-bear']);
});

test('the header title: the first tag, how many more, nothing on a free page', () => {
  assert.deepEqual(titleOf(['sika-deer'], known), { first: 'sika-deer', more: 0 });
  assert.deepEqual(titleOf(['sika-deer', 'formosan-black-bear', 'taiwan-blue-magpie'], known), { first: 'sika-deer', more: 2 });
  assert.equal(titleOf([], known), null);
  assert.equal(titleOf(['an-animal-no-longer-in-the-list'], known), null);
});

test('a footprint trail moves, stretches and turns by its path alone', () => {
  const p = [100, 100, 200, 100];
  assert.deepEqual(movedTrail(p, { dx: 10, dy: -5 }), [110, 95, 210, 95]);
  assert.deepEqual(movedTrail(p, { cx: 150, cy: 100, k: 2 }), [50, 100, 250, 100]);
  const [x0, y0, x1, y1] = movedTrail(p, { cx: 150, cy: 100, a: Math.PI / 2 }).map(v => Math.round(v));
  assert.deepEqual([x0, y0, x1, y1], [150, 50, 150, 150]);
  assert.deepEqual(p, [100, 100, 200, 100], 'the original stays as it was, for undo');
});

test('a 5:7 page gets its extra paper once: every kind of item 60 further in, the same size', () => {
  const old = { id: 'p', version: 2, w: 1000, h: 1400, tags: [], items: [
    { t: 's', c: '#444', w: 5, p: [100, 200, 0.5, 110, 210, 0.6] },
    { t: 'f', c: '#444', k: 'paw', p: [100, 700, 300, 720] },
    { t: 'x', c: '#444', s: 40, x: 50, y: 60, v: 'Hi' },
    { t: 'm', c: '#444', card: 'a', x: 300, y: 400, s: 180, r: 0.2 },
    { t: 'p', id: 'q', x: 500, y: 600, w: 300, h: 200, r: 0 },
  ] };
  const page = widenPage(old);
  assert.equal(page.w, PAGE_W);
  assert.deepEqual(page.items[0].p, [160, 200, 0.5, 170, 210, 0.6], 'a line: its pressure left alone');
  assert.deepEqual(page.items[1].p, [160, 700, 360, 720]);
  assert.equal(page.items[2].x, 110);
  assert.equal(page.items[3].x, 360);
  assert.equal(page.items[3].s, 180);
  assert.equal(page.items[4].x, 560);
  assert.equal(page.items[4].w, 300);
  assert.equal(old.items[2].x, 50, 'the page handed in stays as it was');
  assert.equal(widenPage(page), page, 'and a wide page is left alone');
  assert.deepEqual(normalisePage(normalisePage(old)).items, page.items, 'twice is once');
});

test('the page is 4:5 and as tall as it always was', () => {
  assert.equal(PAGE_W / PAGE_H, 0.8);
  assert.equal(PAGE_H, 1400);
});

test('a page is full at PAGE_CAP things placed: a trail counts once, lines not at all', () => {
  const placed = n => Array.from({ length: n }, () => ({ t: 'm' }));
  assert.equal(pageFull({ items: placed(PAGE_CAP - 1) }), false);
  assert.equal(pageFull({ items: [...placed(PAGE_CAP - 1), { t: 'f', p: Array(4000).fill(1) }] }), true);
  assert.equal(pageFull({ items: [...placed(PAGE_CAP - 1), ...Array(500).fill({ t: 's', p: [] })] }), false);
  assert.equal(pageFull({ items: [...placed(PAGE_CAP - 1), { t: 'k', id: 'a' }] }), true, 'a sticker will count too');
  assert.equal(pageFull(null), false);
});

test('the bitmaps worth keeping are the photos and stickers on the pages given', () => {
  const kept = bitmapsIn([{ items: [{ t: 'p', id: 'a' }, { t: 'm', card: 'b' }] }, { items: [{ t: 'k', id: 'c' }] }]);
  assert.deepEqual([...kept], ['a', 'c']);
});

