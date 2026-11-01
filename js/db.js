// A small key-value store on IndexedDB. Falls back to memory if IndexedDB is
// unavailable (some private-browsing modes), so the app still runs.

const DB_NAME = 'wildlife-explorer';
const STORE = 'kv';
const memory = new Map();
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  }));
}

export async function get(key, fallback) {
  try {
    const v = await run('readonly', s => s.get(key));
    return v === undefined ? fallback : v;
  } catch {
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

export async function set(key, value) {
  memory.set(key, value);
  try { await run('readwrite', s => s.put(value, key)); } catch { /* memory only */ }
}

export async function clear() {
  memory.clear();
  try { await run('readwrite', s => s.clear()); } catch { /* memory only */ }
}
