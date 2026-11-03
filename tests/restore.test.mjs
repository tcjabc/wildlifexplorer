// Restoring a "Back up progress" file (js/backup.js): into a brand-new, empty app (a new
// device, or a new address for the app), from a version 3 or a version 4 file, adding only
// what's missing and never replacing anything.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as db from '../js/db.js';
import { restoreProgress, readBackup, BackupError, FORMAT } from '../js/backup.js';
import { toV4 } from '../js/db-upgrade.js';
import { records, readAll, visibleV3, visibleV4, ADA, BEN } from './fixtures/v3.mjs';

// The file "Back up progress" made on a version 3 device (release A).
const v3File = JSON.stringify({ format: FORMAT, version: 1, dbVersion: 3, exportedAt: '2026-11-03T08:00:00.000Z', stores: {
  meta: records.meta, profiles: records.profiles, packs: records.packs, collection: records.collection,
  badges: records.badges, quiz: records.quiz, notes: records.notes,
} });

test('a version 3 backup restored into an empty app shows every explorer what they had', async () => {
  assert.deepEqual(await db.all('profiles'), []); // a brand-new app
  const n = await restoreProgress(v3File);
  // Not counting deleted records: Ada 2 packs, Ben 3, Cat 1; Ben's two mammals badges are one.
  assert.deepEqual(n, { profiles: 3, packs: 6, cards: 9, badges: 3 });
  const s = await readAll();
  assert.equal(s.version, 4);
  assert.deepEqual(visibleV4(s), visibleV3(records));
  assert.deepEqual(s.notes, []);  // Field Notes come back from their own backup
  assert.deepEqual(s.meta, []);   // device values aren't restored
  assert.equal(s.quiz.find(r => r.id === `${BEN}:sizes`).best, 6);
});

test('restoring again adds nothing, from the same file or the version 4 form of it', async () => {
  assert.deepEqual(await restoreProgress(v3File), { profiles: 0, packs: 0, cards: 0, badges: 0 });
  const { put } = toV4(records);
  const v4File = JSON.stringify({ format: FORMAT, version: 1, dbVersion: 4, exportedAt: '2026-11-03T09:00:00.000Z',
    stores: { ...records, collection: put.collection, badges: put.badges } });
  assert.deepEqual(await restoreProgress(v4File), { profiles: 0, packs: 0, cards: 0, badges: 0 });
});

test('a restore never replaces what is on the device', async () => {
  const ada = await db.get('profiles', ADA);
  await db.put('profiles', { ...ada, name: 'Ada L.' });
  const pack = (await db.all('packs', ADA)).find(p => p.epoch === 3 && !p.openedAt);
  await db.put('packs', { ...pack, openedAt: '2026-11-02T10:00:00.000Z' });
  await restoreProgress(v3File);
  assert.equal((await db.get('profiles', ADA)).name, 'Ada L.');
  assert.equal((await db.get('packs', pack.id)).openedAt, '2026-11-02T10:00:00.000Z');
});

test('files that aren\'t a WildFile backup are refused, and broken records skipped', async () => {
  for (const bad of ['not json', '{}', JSON.stringify({ format: 'wildlife-explorer-field-notes', version: 1 }),
    JSON.stringify({ format: FORMAT, version: 1, dbVersion: 99, stores: {} })]) {
    await assert.rejects(restoreProgress(bad), BackupError);
  }
  const broken = JSON.parse(v3File);
  broken.stores.profiles = [{ id: 'x', name: 42 }, ...broken.stores.profiles];
  broken.stores.packs = [{ id: 'y', profileId: ADA, epoch: 0 }, ...broken.stores.packs];
  broken.stores.collection = ['junk', null, { id: 'z' }, ...broken.stores.collection];
  const stores = readBackup(JSON.stringify(broken));
  assert.equal(stores.profiles.length, records.profiles.length);
  assert.equal(stores.packs.length, records.packs.length);
  assert.equal(stores.collection.length, records.collection.length);
});
