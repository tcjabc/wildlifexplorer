// The version 3 → 4 upgrade (js/db-upgrade.js, run by js/db.js) on a realistic database
// (tests/fixtures/v3.mjs): nothing an explorer sees changes, nothing is lost, the old
// records are kept in v3backup, and an upgrade that fails half-way leaves version 3 as it was.
// Run: npm test
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { toV4 } from '../js/db-upgrade.js';
import { VERSION } from '../js/db.js';
import { records, buildV3, readAll, visibleV3, visibleV4, ADA, BEN, CAT, DAN, TIMES } from './fixtures/v3.mjs';

let n = 0;
const loadDb = () => import(`../js/db.js?window=${++n}`);
const byId = list => Object.fromEntries(list.map(r => [r.id, r]));

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

// ---------- toV4 on its own ----------

test('each card and badge gets its epoch: live ones the current one, deleted ones their own', () => {
  const { put } = toV4(records);
  const cards = byId(put.collection);
  assert.equal(cards[`${ADA}:3:red-fox`].dropId, 's1-w01');
  assert.equal(cards[`${ADA}:2:tiger`].deletedAt, TIMES.end2);             // from its pack
  assert.equal(cards[`${ADA}:1:snow-leopard`].dropId, null);               // dated by epoch 1's pack
  assert.equal(cards[`${DAN}:1:panda`].deletedAt, TIMES.danReset);         // dated by the timeline start
  assert.equal(cards[`${BEN}:1:snow-leopard`].packId, null);
  assert.ok(cards[`${CAT}:1:red-fox`]);                                    // deleted explorer: kept
  assert.ok(cards['ghost:1:red-fox']);                                     // no explorer record: kept
  const badges = byId(put.badges);
  assert.equal(badges[`${ADA}:1:group:birds`].badgeId, 'group:birds');     // groupId only, before Phase 2
  assert.equal('groupId' in badges[`${ADA}:1:group:birds`], false);
  assert.equal(badges[`${ADA}:2:biome:forest:bronze`].deletedAt, TIMES.end2);
  assert.equal(badges[`${BEN}:1:group:mammals`].earnedAt, TIMES.start1);   // two records: the earlier one
});

test('every old record is accounted for, and nothing anyone sees changes', () => {
  const { remove, put } = toV4(records);
  assert.deepEqual(remove.collection.sort(), records.collection.map(r => r.id).sort());
  assert.deepEqual(remove.badges.sort(), records.badges.map(r => r.id).sort());
  assert.equal(put.collection.length, records.collection.length);
  assert.equal(put.badges.length, records.badges.length - 1); // Ben's duplicate mammals badge
  const after = { ...records, collection: put.collection, badges: put.badges };
  assert.deepEqual(visibleV4(after), visibleV3(records));
  assert.deepEqual(visibleV3(records).Ada.cards, ['barn-owl', 'red-fox']);
  assert.deepEqual(visibleV3(records).Ben.badges, ['continent:asia:bronze', 'group:mammals']);
});

test('records that already have an epoch are left alone', () => {
  const { put } = toV4(records);
  const again = toV4({ ...records, collection: put.collection, badges: put.badges });
  assert.deepEqual(again, { remove: { collection: [], badges: [] }, put: { collection: [], badges: [] } });
});

// ---------- In the database ----------

test('opening the version 3 database upgrades it in place', async () => {
  await buildV3();
  const db = await loadDb();
  assert.deepEqual(await db.get('profiles', ADA), records.profiles[0]);
  const s = await readAll();
  assert.equal(s.version, VERSION);
  assert.deepEqual(visibleV4(s), visibleV3(records));
  // Untouched stores are exactly as they were.
  for (const name of ['meta', 'profiles', 'packs', 'quiz', 'notes', 'notefiles']) {
    assert.deepEqual(byId(s[name]), byId(records[name]), name);
  }
  // No record is left under an old key.
  assert.equal(s.collection.every(r => Number.isInteger(r.epoch) && r.id === `${r.profileId}:${r.epoch}:${r.cardId}`), true);
  assert.equal(s.badges.every(r => r.id === `${r.profileId}:${r.epoch}:${r.badgeId}`), true);
  // v3backup holds every original collection and badges record, exactly.
  const backup = byId(s.v3backup);
  for (const store of ['collection', 'badges']) {
    for (const r of records[store]) assert.deepEqual(backup[`${store}/${r.id}`], { id: `${store}/${r.id}`, store, value: r });
  }
  assert.equal(s.v3backup.length, records.collection.length + records.badges.length);
  assert.deepEqual(s.outbox, []); // version 5: an empty outbox (the first sync fills it)
});

// Makes one IndexedDB call fail, only inside the upgrade.
function failDuring(method, storeName) {
  const proto = globalThis.IDBObjectStore.prototype;
  const real = proto[method];
  proto[method] = function (...args) {
    if (this.name === storeName && this.transaction.mode === 'versionchange') throw new DOMException('Simulated failure', 'UnknownError');
    return real.apply(this, args);
  };
  return () => { proto[method] = real; };
}
let undo = null;
afterEach(() => { undo?.(); undo = null; });

for (const [what, method, store] of [
  ['a write fails half-way through', 'put', 'badges'],
  ['reading the old records fails', 'getAll', 'collection'],
]) {
  test(`${what}: the upgrade is undone, version 3 is untouched, and the next launch upgrades`, async () => {
    await buildV3();
    undo = failDuring(method, store);
    const db = await loadDb();
    await assert.rejects(db.all('profiles'));
    const s = await readAll();
    assert.equal(s.version, 3);
    assert.equal('v3backup' in s, false);
    for (const name of Object.keys(records)) assert.deepEqual(byId(s[name]), byId(records[name]), name);

    undo(); undo = null;
    const next = await loadDb();
    assert.equal((await next.all('collection', BEN)).length, 5);
    assert.equal((await readAll()).version, VERSION);
  });
}

test('an empty or brand-new database upgrades too', async () => {
  const db = await loadDb();
  assert.deepEqual(await db.all('collection'), []);
  const s = await readAll();
  assert.equal(s.version, VERSION);
  assert.deepEqual(s.v3backup, []);
});
