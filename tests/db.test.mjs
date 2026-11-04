// Tests for js/db.js on fake-indexeddb: another window updating the database, an upgrade
// blocked by an older window, and when (not) to carry on in memory.
// Run: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

// A fresh copy of db.js (its own connection and state) for each "window".
let n = 0;
const loadDb = () => import(`../js/db.js?window=${++n}`);
const once = (target, type) => new Promise(resolve => target.addEventListener(type, resolve, { once: true }));
const done = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

// Opens the database directly, as another copy of the app would.
function rawOpen(version, upgrade = () => {}) {
  const req = indexedDB.open('wildlife-explorer', version);
  req.onupgradeneeded = () => upgrade(req.result);
  return done(req);
}

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

test('records are kept in IndexedDB, not in memory', async () => {
  const a = await loadDb();
  await a.put('profiles', { id: 'p1', name: 'Kid' });
  const b = await loadDb(); // the next launch
  assert.deepEqual(await b.get('profiles', 'p1'), { id: 'p1', name: 'Kid' });
});

test('a newer version in another window: this one closes, says "updated" and stops', async () => {
  const db = await loadDb();
  await db.setMeta('activeProfile', 'p1');
  const updated = once(db.events, 'updated');
  const newer = await rawOpen(db.VERSION + 1); // succeeds only once db.js has closed
  await updated;
  newer.close();
  // Nothing more is read or written here, not even in memory.
  await assert.rejects(db.put('meta', { id: 'x', value: 1 }), { name: 'VersionError' });
  await assert.rejects(db.get('meta', 'activeProfile'), { name: 'VersionError' });
});

test('a database newer than this copy: "updated", and no memory fallback', async () => {
  const db = await loadDb();
  (await rawOpen(db.VERSION + 1)).close();
  const updated = once(db.events, 'updated');
  await assert.rejects(db.all('profiles'), { name: 'VersionError' });
  await updated;
});

test('an upgrade blocked by an older window says so, then goes ahead once it closes', async () => {
  // An old copy at version 2 (its stores as they were then) that doesn't close when asked.
  const old = await rawOpen(2, d => ['meta', 'profiles', 'packs', 'collection', 'badges', 'quiz'].forEach(name => {
    const store = d.createObjectStore(name, { keyPath: 'id' });
    if (!['meta', 'profiles'].includes(name)) store.createIndex('profileId', 'profileId');
  }));
  const db = await loadDb();
  const blocked = once(db.events, 'blocked');
  const unblocked = once(db.events, 'unblocked');
  const read = db.all('profiles');
  await blocked;
  old.close();
  await unblocked;
  assert.deepEqual(await read, []);
  await db.put('notes', { id: 'n1', profileId: 'p1' }); // added by the version 3 upgrade
});

test('only the synced stores write to the outbox: every other store, now or later, is device-only', async () => {
  const db = await loadDb();
  await db.all('profiles'); // opens the database
  const conn = await rawOpen(db.VERSION);
  const names = [...conn.objectStoreNames];
  conn.close();
  const deviceOnly = names.filter(n => !db.SYNCED.includes(n) && n !== 'outbox');
  // Whatever stores exist, only the allow-list syncs; a new store lands in deviceOnly.
  assert.deepEqual([...db.SYNCED].sort(), ['badges', 'collection', 'packs', 'profiles']);
  assert.ok(['meta', 'quiz', 'notes', 'notefiles', 'v3backup'].every(n => deviceOnly.includes(n)));
  for (const name of deviceOnly) {
    await db.put(name, { id: `${name}-1`, profileId: 'p1', value: 1 });
    await db.tx([name], 'readwrite', async a => { await a.add(name, { id: `${name}-2`, profileId: 'p1' }); });
  }
  assert.deepEqual(await db.all('outbox'), []);
  // A transaction over both kinds queues only the synced record.
  await db.tx(['notes', 'collection'], 'readwrite', async a => {
    await a.put('notes', { id: 'n9', profileId: 'p1' });
    await a.put('collection', { id: 'p1:1:emu', profileId: 'p1', epoch: 1, cardId: 'emu' });
  });
  assert.deepEqual((await db.all('outbox')).map(e => e.id), ['collection:p1:1:emu']);
});

test('a record that is what the server has is written without an outbox entry; an entry already there stays', async () => {
  const db = await loadDb();
  const queued = [];
  db.events.addEventListener('queued', () => queued.push(1));
  await db.tx(['badges'], 'readwrite', async a => { await a.putFromServer('badges', { id: 'p1:1:group:birds', profileId: 'p1' }); });
  assert.deepEqual(await db.all('outbox'), []);
  assert.equal(queued.length, 0);
  await db.put('collection', { id: 'p1:1:emu', profileId: 'p1', epoch: 1, cardId: 'emu' });
  const [entry] = await db.all('outbox');
  await db.tx(['collection'], 'readwrite', async a => { await a.putFromServer('collection', { id: 'p1:1:emu', profileId: 'p1', epoch: 1, cardId: 'emu', collectedAt: 'x' }); });
  assert.deepEqual(await db.all('outbox'), [entry]);
  assert.equal((await db.get('collection', 'p1:1:emu')).collectedAt, 'x');
});

test('no IndexedDB at all: carries on in memory', async () => {
  globalThis.indexedDB = undefined;
  const db = await loadDb();
  await db.put('profiles', { id: 'p1', name: 'Kid' });
  assert.deepEqual(await db.get('profiles', 'p1'), { id: 'p1', name: 'Kid' });
});

test('any other failure is an error, not memory, and the next try opens the database', async () => {
  const real = globalThis.indexedDB;
  globalThis.indexedDB = {
    open() {
      const req = {};
      setTimeout(() => { req.error = new DOMException('Disk trouble', 'UnknownError'); req.onerror(); });
      return req;
    },
  };
  const db = await loadDb();
  await assert.rejects(db.put('profiles', { id: 'p1' }), { name: 'UnknownError' });
  globalThis.indexedDB = real;
  await db.put('profiles', { id: 'p1' });
  const again = await loadDb();
  assert.deepEqual(await again.get('profiles', 'p1'), { id: 'p1' }); // on disk, not in memory
});

test("on a grown-up's device, progress writes are refused (put and add, any window); pulls, profiles and the rest still work", async () => {
  const db = await loadDb();
  assert.equal(await db.getRole(), 'explorers'); // no role yet: the explorers' device
  await db.setMeta('device', { role: 'watch' });
  assert.equal(await db.getRole(), 'watch');
  const other = await loadDb(); // another window, which never read the role
  for (const d of [db, other]) {
    for (const store of db.PROGRESS) {
      await assert.rejects(d.put(store, { id: `p1:1:${store}`, profileId: 'p1', epoch: 1 }), d.WatchOnly, store);
      await assert.rejects(d.tx([store], 'readwrite', a => a.add(store, { id: `p1:1:a-${store}`, profileId: 'p1' })), d.WatchOnly, store);
    }
  }
  // Nothing was written, not even half a transaction.
  await assert.rejects(db.tx(['profiles', 'packs'], 'readwrite', async a => {
    await a.put('profiles', { id: 'p1', name: 'Mia' });
    await a.put('packs', { id: 'p1:1:s1-w01', profileId: 'p1' });
  }), db.WatchOnly);
  assert.equal(await db.get('profiles', 'p1'), undefined);
  for (const store of db.PROGRESS) assert.deepEqual(await db.all(store), [], store);
  assert.deepEqual(await db.all('outbox'), []);
  // What a pull brings down, settings and device-only stores are fine.
  await db.tx(['packs'], 'readwrite', a => a.putFromServer('packs', { id: 'p1:1:s1-w01', profileId: 'p1' }));
  await db.put('profiles', { id: 'p1', name: 'Mia' });
  await db.put('quiz', { id: 'p1:pictures', profileId: 'p1', best: 3 });
  assert.ok(await db.get('packs', 'p1:1:s1-w01'));
  assert.deepEqual((await db.all('outbox')).map(e => e.id), ['profiles:p1']);
  // Back to the explorers' device: progress again.
  await db.setMeta('device', { role: 'explorers' });
  await db.put('badges', { id: 'p1:1:group:birds', profileId: 'p1' });
});
