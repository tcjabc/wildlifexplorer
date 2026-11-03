// The local database on IndexedDB: one object store per kind of record, each record
// keyed by its "id", so the same records can be synced to a server later.
//   meta        { id, value }                 device-level values (active profile, …)
//   profiles    { id, name, lang, … }         one per explorer (a person or a family)
//   packs       { id, profileId, epoch, dropId, … }  every pack ever granted, opened or not
//   collection  { id, profileId, epoch, cardId, … }  cards a profile has collected
//   badges      { id, profileId, epoch, badgeId, … }
//               (progress is kept per timeline epoch: "Start over" begins a new one)
//   quiz        { id, profileId, kind, best }
//   notes       { id, profileId, pageId, cardIds, … }  Field Notes pages (their content is in OPFS)
//   notefiles   { id, profileId, blob }      page files, where OPFS isn't available (notes-store.js)
//   v3backup    { id, store, value }         collection and badges as version 3 kept them
//   outbox      { id, store, key, rev }      records to send to the family account (cloud/sync.js)
// Falls back to memory only if there is no IndexedDB at all (some private-browsing modes),
// so the app still runs; nothing is kept after the page closes then. Any other failure is
// an error: the saved progress is still on disk, and carrying on in memory would hide it.

import { toV4 } from './db-upgrade.js';

export const DB_NAME = 'wildlife-explorer';
export const VERSION = 5;
const BY_PROFILE = ['packs', 'collection', 'badges', 'quiz', 'notes', 'notefiles'];
const OUTBOX = 'outbox';
const STORES = ['meta', 'profiles', ...BY_PROFILE, OUTBOX];
// What the family account keeps (cloud/sync.js). Every write to one of these also puts an
// outbox entry, in the same transaction, so no change can be missed.
export const SYNCED = ['profiles', 'packs', 'collection', 'badges'];
const LEGACY = 'kv'; // version 1: one key-value store for a single child
// Version 4 keeps the version 3 collection and badges records here, untouched, as a safety
// net. Remove it in a later version once sync has been stable for a while.
const BACKUP = 'v3backup';

let dbPromise;
let memory = null; // Map per store, once IndexedDB has failed
let outdated = false; // a newer copy of the app has the database now

// What app.js shows a full-screen message for:
//   'updated'    a newer copy of the app upgraded the database (or this copy is older than
//                it): this copy can't use it any more, only a reload carries on
//   'blocked'    this copy is waiting to upgrade until other WildFile windows close
//   'unblocked'  they closed, and the upgrade went ahead
// and for cloud/sync.js:
//   'queued'     a synced record changed (after its transaction committed)
export const events = new EventTarget();
const emit = type => events.dispatchEvent(new Event(type));
const markOutdated = () => {
  outdated = true;
  dbPromise = null;
  emit('updated');
};

function open() {
  if (outdated) return Promise.reject(new DOMException('A newer WildFile has the database', 'VersionError'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    let blocked = false;
    req.onupgradeneeded = e => {
      const db = req.result;
      // Each version adds the stores it introduced.
      const add = names => names.forEach(name => {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (BY_PROFILE.includes(name)) store.createIndex('profileId', 'profileId');
      });
      if (e.oldVersion < 2) add(['meta', 'profiles', 'packs', 'collection', 'badges', 'quiz']);
      if (e.oldVersion < 3) add(['notes', 'notefiles']);
      if (e.oldVersion < 4) {
        db.createObjectStore(BACKUP, { keyPath: 'id' });
        rekeyProgress(req.transaction);
      }
      if (e.oldVersion < 5) add([OUTBOX]);
    };
    // An older copy in another window didn't close for the upgrade.
    req.onblocked = () => { blocked = true; emit('blocked'); };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) emit('unblocked');
      // Let a newer version in another window upgrade (or delete) the database. This copy's
      // code doesn't know the new version, so it stops using the database altogether.
      db.onversionchange = () => { db.close(); markOutdated(); };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      if (req.error?.name === 'VersionError') markOutdated();
      reject(req.error);
    };
  });
  return dbPromise;
}

// No IndexedDB to use at all, as opposed to one that failed.
const noIndexedDB = err => typeof indexedDB === 'undefined' || ['SecurityError', 'InvalidStateError'].includes(err?.name);

// Version 4: collection and badges keyed per epoch (db-upgrade.js). This runs inside the
// upgrade transaction: if anything fails, or the app is closed half-way, the whole upgrade
// is undone and the database stays at version 3, untouched. Plain request callbacks, no
// promises, so the transaction stays open in every browser.
function rekeyProgress(t) {
  const names = ['profiles', 'packs', 'collection', 'badges'];
  const got = {};
  for (const name of names) {
    t.objectStore(name).getAll().onsuccess = e => {
      got[name] = e.target.result;
      if (Object.keys(got).length < names.length) return;
      try {
        const { remove, put } = toV4(got);
        for (const store of ['collection', 'badges']) {
          for (const value of got[store]) t.objectStore(BACKUP).put({ id: `${store}/${value.id}`, store, value });
          for (const id of remove[store]) t.objectStore(store).delete(id);
          for (const value of put[store]) t.objectStore(store).put(value);
        }
      } catch (err) {
        console.error(err);
        t.abort();
      }
    };
  }
}

const done = r => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

// What a transaction callback gets. add() returns false instead of failing when the id
// already exists: that is how a pack can never be granted twice.
function idbAccess(t) {
  const os = name => t.objectStore(name);
  return {
    get: (name, id) => done(os(name).get(id)),
    all: (name, profileId) => done(profileId === undefined ? os(name).getAll() : os(name).index('profileId').getAll(profileId)),
    put: (name, value) => done(os(name).put(value)),
    remove: (name, id) => done(os(name).delete(id)),
    add: (name, value) => new Promise((resolve, reject) => {
      const r = os(name).add(value);
      r.onsuccess = () => resolve(true);
      r.onerror = e => {
        if (r.error?.name !== 'ConstraintError') { reject(r.error); return; }
        e.preventDefault(); // keep the transaction going
        e.stopPropagation();
        resolve(false);
      };
    }),
  };
}

function memoryAccess() {
  memory ??= new Map(STORES.map(n => [n, new Map()]));
  const copy = v => (v === undefined ? v : structuredClone(v));
  return {
    get: async (name, id) => copy(memory.get(name).get(id)),
    all: async (name, profileId) => [...memory.get(name).values()]
      .filter(v => profileId === undefined || v.profileId === profileId).map(copy),
    put: async (name, value) => { memory.get(name).set(value.id, copy(value)); },
    remove: async (name, id) => { memory.get(name).delete(id); },
    add: async (name, value) => {
      if (memory.get(name).has(value.id)) return false;
      memory.get(name).set(value.id, copy(value));
      return true;
    },
  };
}

// Writes to synced stores also put their outbox entry. The entry holds only the key (sync
// sends the record as it is then) and a new rev, so sync can tell a change that came in
// while it was sending.
function withOutbox(access, queued) {
  const note = async (name, value) => {
    await access.put(OUTBOX, { id: `${name}:${value.id}`, store: name, key: value.id, rev: newId() });
    queued.yes = true;
  };
  return {
    ...access,
    put: async (name, value) => {
      const r = await access.put(name, value);
      if (SYNCED.includes(name)) await note(name, value);
      return r;
    },
    add: async (name, value) => {
      const added = await access.add(name, value);
      if (added && SYNCED.includes(name)) await note(name, value);
      return added;
    },
  };
}

// Run fn(access) in one transaction over the named stores (plus the outbox, when it writes
// to a synced store). Inside fn, await only the access calls (anything else would let the
// transaction close early).
export async function tx(stores, mode, fn) {
  let db;
  if (!memory) {
    try { db = await open(); } catch (err) {
      if (!noIndexedDB(err)) throw err;
      // memory from now on
    }
  }
  const writes = mode === 'readwrite' && stores.some(s => SYNCED.includes(s));
  const queued = { yes: false };
  const access = a => (writes ? withOutbox(a, queued) : a);
  const after = r => { if (queued.yes) emit('queued'); return r; };
  if (!db) return after(await fn(access(memoryAccess())));
  return new Promise((resolve, reject) => {
    const t = db.transaction(writes ? [...new Set([...stores, OUTBOX])] : stores, mode);
    let result;
    t.oncomplete = () => resolve(after(result));
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
    Promise.resolve(fn(access(idbAccess(t)))).then(r => { result = r; }, err => {
      try { t.abort(); } catch { /* already finished */ }
      reject(err);
    });
  });
}

export const get = (store, id) => tx([store], 'readonly', a => a.get(store, id));
export const all = (store, profileId) => tx([store], 'readonly', a => a.all(store, profileId));
export const put = (store, value) => tx([store], 'readwrite', a => a.put(store, value));
export const remove = (store, id) => tx([store], 'readwrite', a => a.remove(store, id));

export async function getMeta(id, fallback) {
  const rec = await get('meta', id).catch(() => undefined);
  return rec === undefined ? fallback : rec.value;
}
export const setMeta = (id, value) => put('meta', { id, value });

// Progress saved by version 1 (before profiles), or null if there is none.
export async function readLegacy() {
  try {
    const db = await open();
    if (!db.objectStoreNames.contains(LEGACY)) return null;
    const t = db.transaction(LEGACY, 'readonly');
    const [keys, values] = await Promise.all([done(t.objectStore(LEGACY).getAllKeys()), done(t.objectStore(LEGACY).getAll())]);
    return keys.length ? Object.fromEntries(keys.map((k, i) => [k, values[i]])) : null;
  } catch {
    return null;
  }
}

// A random id for a profile (randomUUID needs https or localhost, which the app always has).
export const newId = () => crypto.randomUUID?.() ??
  [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
