// Field Notes backups end to end, in Node: restoring a real version 1 backup (made by the
// export code from before animal tags: tests/fixtures/make-notes-backup-v1.mjs), restoring it
// twice, and re-importing a version 2 export of the result.
// Run: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';

const FIXTURE = new URL('./fixtures/notes-backup-v1.zip', import.meta.url);
const zipFile = () => new File([readFileSync(FIXTURE)], 'field-notes-kid-v1.zip', { type: 'application/zip' });

let db, store, notes, io, model, zip, v1;
before(async () => {
  db = await import('../js/db.js');
  store = await import('../js/store.js');
  notes = await import('../js/notes-store.js');
  io = await import('../js/notes-io.js');
  model = await import('../js/notes-model.js');
  zip = await import('../js/zip.js');
  // What the old backup holds, read straight from the zip.
  const files = await zip.readZip(new Blob([readFileSync(FIXTURE)]));
  const json = name => JSON.parse(new TextDecoder().decode(files.get(name)));
  v1 = { files, manifest: json('manifest.json'), page: id => json(`pages/${id}.json`) };
});

async function as(profileId) {
  store.state.profile = { id: profileId, name: 'Kid' };
  store.state.notes = [];
  await notes.loadIndex();
}
const bytes = async blob => [...new Uint8Array(await blob.arrayBuffer())];
// The export shares its zip through the Web Share API; catch it there.
async function exportZip() {
  let file = null;
  const { canShare, share } = globalThis.navigator;
  globalThis.navigator.canShare = () => true;
  globalThis.navigator.share = async ({ files }) => { file = files[0]; };
  try { await io.exportAll(); } finally { Object.assign(globalThis.navigator, { canShare, share }); }
  return file;
}

test('the fixture is a real version 1 backup: two pages linked to cards, one free page, one photo', () => {
  assert.equal(v1.manifest.format, 'wildlife-explorer-field-notes');
  assert.equal(v1.manifest.version, 1);
  assert.equal(v1.manifest.pages.length, 3);
  assert.ok(v1.manifest.pages.every(p => Array.isArray(p.cardIds) && !('tags' in p)));
  assert.deepEqual(v1.manifest.pages.map(p => p.cardIds.length > 0), [true, true, false]);
  assert.ok(v1.manifest.pages.every(p => v1.page(p.id).version === 1 && !('tags' in v1.page(p.id))));
  assert.ok(v1.files.has('photos/photo-0001.jpg'));
});

test('restoring a version 1 backup brings back every page and photo, tagged from the old cardIds', async () => {
  await as('restore-v1');
  assert.equal(await io.importBackup(zipFile()), 3);
  assert.deepEqual(store.state.notes.map(r => r.pageId).sort(), v1.manifest.pages.map(p => p.id).sort());
  for (const entry of v1.manifest.pages) {
    const rec = store.state.notes.find(r => r.pageId === entry.id);
    const old = v1.page(entry.id);
    const migrated = model.migrateRecord({ id: 'x', pageId: entry.id, cardIds: entry.cardIds, createdAt: entry.createdAt, updatedAt: entry.createdAt });
    assert.deepEqual(rec.tags, migrated.tags, `${entry.id}: the same tags the migration gives`);
    assert.deepEqual(model.normalisePage(old).tags, migrated.tags, `${entry.id}: and the same as migrating the page file`);
    assert.equal(rec.createdAt, entry.createdAt);
    const page = await notes.loadPage(entry.id);
    assert.equal(page.version, 2);
    assert.deepEqual(page.tags, migrated.tags);
    assert.deepEqual(page.items, old.items, `${entry.id}: the content is unchanged`);
  }
  const [bear, magpie, free] = v1.manifest.pages.map(p => store.state.notes.find(r => r.pageId === p.id));
  assert.deepEqual(bear.tags, ['formosan-black-bear']);
  assert.deepEqual(magpie.tags, ['taiwan-blue-magpie', 'formosan-rock-macaque', 'sika-deer'], 'header card, linked card, stamped animal');
  assert.deepEqual(free.tags, [], 'a page linked to nothing is a free page');
  assert.deepEqual(model.freePages(store.state.notes).map(r => r.pageId), [free.pageId]);
  assert.deepEqual(await bytes(await notes.loadPhotoBlob('photo-0001')), [...v1.files.get('photos/photo-0001.jpg')]);
});

test('restoring the same backup twice adds nothing the second time', async () => {
  await as('restore-twice');
  assert.equal(await io.importBackup(zipFile()), 3);
  assert.equal(await io.importBackup(zipFile()), 0);
  assert.equal(store.state.notes.length, 3);
  assert.equal((await db.all('notes', 'restore-twice')).length, 3);
  const files = (await db.all('notefiles', 'restore-twice')).map(f => f.id).sort();
  assert.deepEqual(files, [...new Set(files)], 'no page or photo file twice');
  assert.equal(files.length, 4, 'three pages and one photo');
});

test('a version 2 export of the restored notebook imports again, tags, pages and photo intact', async () => {
  await as('export-from');
  await io.importBackup(zipFile());
  const before = store.state.notes.map(r => ({ id: r.pageId, tags: r.tags, createdAt: r.createdAt })).sort((a, b) => a.id.localeCompare(b.id));
  const v2zip = await exportZip();
  assert.ok(v2zip, 'the export made a zip');
  const files = await zip.readZip(v2zip);
  const manifest = JSON.parse(new TextDecoder().decode(files.get('manifest.json')));
  assert.equal(manifest.version, 2);
  assert.ok(manifest.pages.every(p => Array.isArray(p.tags) && !('cardIds' in p)));

  await as('import-to');
  assert.equal(await io.importBackup(v2zip), 3);
  const after = store.state.notes.map(r => ({ id: r.pageId, tags: r.tags, createdAt: r.createdAt })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(after, before);
  for (const { id } of after) assert.deepEqual((await notes.loadPage(id)).items, v1.page(id).items);
  assert.deepEqual(await bytes(await notes.loadPhotoBlob('photo-0001')), [...v1.files.get('photos/photo-0001.jpg')]);
  assert.equal(await io.importBackup(v2zip), 0, 'and not twice');
});

test('a backup keeps which tool drew a line, and a line that doesn\'t say is a pencil', async () => {
  const { cleanPage } = await import('../js/notes-io.js');
  const items = [
    { t: 's', c: '#4a4a4a', w: 5, p: [1, 2, 0.5] },
    { t: 's', c: '#1e78d2', w: 4, k: 'pen', p: [1, 2, 0.5] },
    { t: 's', c: '#ffec3d', w: 40, k: 'highlighter', p: [1, 2, 0.5] },
  ];
  const page = cleanPage({ id: 'page-1', header: { date: '2026-01-01T00:00:00.000Z' }, createdAt: '2026-01-01T00:00:00.000Z', tags: [], items });
  assert.deepEqual(page.items, items);
  assert.ok(items.every(it => /^#[0-9a-f]{6}$/.test(it.c)), 'colours stay plain colours');
});
