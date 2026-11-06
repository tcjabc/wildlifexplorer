// Field Notes storage with animal tags (js/notes-store.js, js/notes-io.js) on a real (fake)
// IndexedDB: old records are migrated as they load, a draft page is saved once, tag edits
// and new pages stay on the device (nothing in the outbox), and older backups restore.
// Run: npm test
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';

globalThis.fetch = async url => ({ json: async () => JSON.parse(readFileSync(new URL(`../${url}`, import.meta.url), 'utf8')) });

let db, store, notes, io;
const PID = 'kid-1';
before(async () => {
  db = await import('../js/db.js');
  store = await import('../js/store.js');
  notes = await import('../js/notes-store.js');
  io = await import('../js/notes-io.js');
});
beforeEach(async () => {
  for (const name of ['notes', 'notefiles', 'outbox']) for (const r of await db.all(name)) await db.remove(name, r.id);
  store.state.profile = { id: PID, name: 'Kid' };
  store.state.notes = [];
});

const pageFile = page => ({ id: `${PID}/pages/${page.id}.json`, profileId: PID, blob: new Blob([JSON.stringify(page)], { type: 'application/json' }) });

test('migration: records and pages from before tags load with tags, and nothing is lost', async () => {
  const at = '2026-10-01T09:00:00.000Z';
  const linked = { id: 'a1', version: 1, w: 1000, h: 1400, paper: 'dots', header: { date: at, cardId: 'sika-deer' }, links: [], items: [{ t: 'm', card: 'formosan-black-bear', x: 1, y: 1, s: 1, r: 0 }], createdAt: at };
  const loose = { id: 'a2', version: 1, w: 1000, h: 1400, paper: 'dots', header: { date: at, cardId: null }, links: [], items: [{ t: 'x', v: 'hello', x: 1, y: 1, s: 40 }], createdAt: at };
  await db.put('notes', { id: `${PID}:a1`, profileId: PID, pageId: 'a1', cardIds: ['sika-deer', 'formosan-black-bear'], createdAt: at, updatedAt: at, deletedAt: null });
  await db.put('notes', { id: `${PID}:a2`, profileId: PID, pageId: 'a2', cardIds: [], createdAt: at, updatedAt: at, deletedAt: null });
  await db.put('notefiles', pageFile(linked));
  await db.put('notefiles', pageFile(loose));

  await notes.loadIndex();
  assert.deepEqual(store.state.notes.map(r => [r.pageId, r.tags]), [['a1', ['sika-deer', 'formosan-black-bear']], ['a2', []]]);
  // Written back, so the next load has nothing to do.
  const stored = await db.get('notes', `${PID}:a1`);
  assert.deepEqual(stored.tags, ['sika-deer', 'formosan-black-bear']);
  assert.equal('cardIds' in stored, false);
  // The pages themselves: tagged, and on the wider paper with their content as it was.
  const p1 = await notes.loadPage('a1'), p2 = await notes.loadPage('a2');
  assert.deepEqual(p1.tags, ['sika-deer', 'formosan-black-bear']);
  assert.deepEqual(p1.items, [{ ...linked.items[0], x: 61 }]);
  assert.equal(p1.w, 1120);
  assert.deepEqual(p2.tags, []);
  assert.deepEqual(p2.items, [{ ...loose.items[0], x: 61 }]);
  assert.deepEqual(notes.pagesFor('sika-deer').map(r => r.pageId), ['a1']);
  assert.equal(notes.notesCount('formosan-black-bear'), 1);
});

test('a draft page is not saved until something goes on it, and saving it twice makes one page', async () => {
  await notes.loadIndex();
  const draft = notes.blankPage({ tags: ['sika-deer'] });
  assert.equal((await db.all('notes', PID)).length, 0, 'opening a card with no pages makes none');
  draft.items.push({ t: 's', c: '#000', w: 5, p: [1, 1, 0.5] });
  await notes.savePage(draft);
  await notes.savePage(draft);
  const recs = await db.all('notes', PID);
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].tags, ['sika-deer']);
});

test('editing a page moves its editedAt; tag edits too', async () => {
  await notes.loadIndex();
  const page = await notes.createPage({ tags: [] });
  const first = store.state.notes[0].editedAt;
  await new Promise(r => setTimeout(r, 5));
  page.tags = ['sika-deer'];
  await notes.savePage(page);
  assert.ok(store.state.notes[0].editedAt > first);
  assert.deepEqual(store.state.notes[0].tags, ['sika-deer']);
});

test('Field Notes stay on the device: new pages and tag edits leave the outbox empty', async () => {
  assert.equal(db.SYNCED.includes('notes'), false);
  assert.equal(db.SYNCED.includes('notefiles'), false);
  await notes.loadIndex();
  const free = await notes.createPage({ tags: [] });
  const tagged = await notes.createPage({ tags: ['sika-deer'] });
  free.tags = ['formosan-black-bear'];            // a free page tagged
  await notes.savePage(free);
  tagged.tags = ['sika-deer', 'formosan-black-bear'];
  await notes.savePage(tagged);
  tagged.tags = [];                               // its last tag removed: a free page again
  await notes.savePage(tagged);
  await notes.deletePage(free.id);
  assert.deepEqual(await db.all('outbox'), []);
});

test('backups: a version 1 page (no tags) restores tagged with what it was linked to', () => {
  const v1 = { id: 'b1', version: 1, header: { date: 'x', cardId: 'sika-deer' }, links: ['formosan-black-bear'], items: [{ t: 'zz' }, { t: 'x', v: 'a' }], createdAt: 'x' };
  const fromV1 = io.cleanPage(v1, { id: 'b1', createdAt: 'x', cardIds: ['sika-deer', 'formosan-black-bear', 'taiwan-blue-magpie'] });
  assert.deepEqual(fromV1.tags, ['sika-deer', 'formosan-black-bear', 'taiwan-blue-magpie'], 'the manifest\'s linked cards');
  assert.deepEqual(fromV1.items, [{ t: 'x', v: 'a' }], 'unknown items are still dropped');
  assert.deepEqual(io.cleanPage(v1, { id: 'b1' }).tags, ['sika-deer', 'formosan-black-bear'], 'no manifest list: from the page');
  // A version 2 page keeps its own tags.
  assert.deepEqual(io.cleanPage({ ...v1, tags: ['taiwan-blue-magpie'] }, { tags: ['sika-deer'] }).tags, ['taiwan-blue-magpie']);
  assert.deepEqual(io.cleanPage({ ...v1, tags: [], header: {}, links: [] }, {}).tags, [], 'a free page stays free');
});

test('removing an item leaves the page\'s tags: only ops that carry tags change them', () => {
  const src = readFileSync(new URL('../js/notebook.js', import.meta.url), 'utf8');
  assert.match(src, /nb\.undo\.push\(\{ kind: 'remove', entries \}\)/, 'the eraser records a plain remove');
  assert.match(src, /tagsAfterStamp\(before, card\)/, 'placing a stamp adds its tag');
  assert.match(src, /if \(op\.tags\) \{ page\.tags =/, 'only ops that carry tags change them');
});
