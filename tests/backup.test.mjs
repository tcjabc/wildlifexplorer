// Tests for js/backup.js: what goes into the "Back up progress" file.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as db from '../js/db.js';
import { snapshot, FORMAT } from '../js/backup.js';

test('the backup holds every store and deleted records, but no session or page files', async () => {
  const t = '2026-11-01T09:00:00.000Z';
  await db.setMeta('activeProfile', 'p1');
  await db.setMeta('auth', { access_token: 'secret', refresh_token: 'secret' });
  await db.put('profiles', { id: 'p1', name: 'Kid', timeline: { epoch: 2, startAt: t } });
  await db.put('packs', { id: 'p1:1:s1-w01', profileId: 'p1', epoch: 1, dropId: 's1-w01', deletedAt: t });
  await db.put('collection', { id: 'p1:fox', profileId: 'p1', cardId: 'fox', deletedAt: null });
  await db.put('badges', { id: 'p1:group:mammals', profileId: 'p1', badgeId: 'group:mammals' });
  await db.put('quiz', { id: 'p1:sizes', profileId: 'p1', kind: 'sizes', best: 7 });
  await db.put('notes', { id: 'n1', profileId: 'p1', pageId: 'n1' });
  await db.put('notefiles', { id: 'p1/n1.json', profileId: 'p1', blob: 'page' });

  const at = new Date('2026-11-03T08:00:00Z');
  const file = await snapshot(at);
  assert.equal(file.format, FORMAT);
  assert.equal(file.dbVersion, db.VERSION);
  assert.equal(file.exportedAt, at.toISOString());
  assert.deepEqual(Object.keys(file.stores).sort(), ['badges', 'collection', 'meta', 'notes', 'packs', 'profiles', 'quiz']);
  assert.deepEqual(file.stores.meta.map(r => r.id), ['activeProfile']);
  assert.equal(JSON.stringify(file).includes('secret'), false);
  assert.equal(file.stores.packs[0].deletedAt, t);
  assert.equal(file.stores.quiz[0].best, 7);
  assert.equal(file.stores.collection.length, 1);
});
