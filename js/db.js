// The local database on IndexedDB: one object store per kind of record, each record
// keyed by its "id", so the same records can be synced to a server later.
//   meta        { id, value }                 device-level values (active profile, …)
//   profiles    { id, name, lang, … }         one per explorer (a person or a family)
//   packs       { id, profileId, dropId, … }  every pack ever granted, opened or not
//   collection  { id, profileId, cardId, … }  cards a profile has collected
//   badges      { id, profileId, groupId, … }
//   quiz        { id, profileId, kind, best }
//   notes       { id, profileId, pageId, cardIds, … }  Field Notes pages (their content is in OPFS)
//   notefiles   { id, profileId, blob }      page files, where OPFS isn't available (notes-store.js)
// Falls back to memory if IndexedDB is unavailable (some private-browsing modes), so the
// app still runs; nothing is kept after the page closes then.

const DB_NAME = 'wildlife-explorer';
const VERSION = 3;
const BY_PROFILE = ['packs', 'collection', 'badges', 'quiz', 'notes', 'notefiles'];
const STORES = ['meta', 'profiles', ...BY_PROFILE];
const LEGACY = 'kv'; // version 1: one key-value store for a single child

let dbPromise;
let memory = null; // Map per store, once IndexedDB has failed

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = e => {
      const db = req.result;
      // Each version adds the stores it introduced.
      const add = names => names.forEach(name => {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (BY_PROFILE.includes(name)) store.createIndex('profileId', 'profileId');
      });
      if (e.oldVersion < 2) add(['meta', 'profiles', 'packs', 'collection', 'badges', 'quiz']);
      if (e.oldVersion < 3) add(['notes', 'notefiles']);
    };
    req.onsuccess = () => {
      const db = req.result;
      // Let a newer version in another tab upgrade (or delete) the database; the next
      // call opens it again instead of failing on the closed connection.
      db.onversionchange = () => { db.close(); dbPromise = null; };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
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

// Run fn(access) in one transaction over the named stores. Inside fn, await only the
// access calls (anything else would let the transaction close early).
export async function tx(stores, mode, fn) {
  let db;
  if (!memory) {
    try { db = await open(); } catch { /* memory from now on */ }
  }
  if (!db) return fn(memoryAccess());
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'));
    Promise.resolve(fn(idbAccess(t))).then(r => { result = r; }, err => {
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
