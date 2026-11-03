// A backup of everything this device keeps, as one JSON file a parent saves somewhere safe
// (Parents page). Every store is in it, deleted records too, except Field Notes page files
// (Field Notes has its own zip backup) and the sign-in session (meta 'auth': a token that
// must never leave the device in a file).
import * as db from './db.js';
import { shareFile } from './dom.js';

export const FORMAT = 'wildfile-progress';
const STORES = ['meta', 'profiles', 'packs', 'collection', 'badges', 'quiz', 'notes'];
const PRIVATE_META = new Set(['auth']);

export async function snapshot(now = new Date()) {
  const stores = await db.tx(STORES, 'readonly', async a => {
    const out = {};
    for (const name of STORES) out[name] = await a.all(name);
    return out;
  });
  stores.meta = stores.meta.filter(r => !PRIVATE_META.has(r.id));
  return { format: FORMAT, version: 1, dbVersion: db.VERSION, exportedAt: now.toISOString(), stores };
}

// Resolves with 'shared', 'cancelled' or 'downloaded' (see shareFile).
export async function backupProgress() {
  const data = await snapshot();
  const name = `wildfile-progress-${data.exportedAt.slice(0, 10)}.json`;
  return shareFile(new File([JSON.stringify(data, null, 2)], name, { type: 'application/json' }));
}
