// A backup of everything this device keeps, as one JSON file a parent saves somewhere safe
// (Parents page), and restoring one. Every store is in the file, deleted records too,
// except Field Notes page files (Field Notes has its own zip backup) and the sign-in
// session (meta 'auth': a token that must never leave the device in a file).
import * as db from './db.js';
import { shareFile } from './dom.js';
import { toV4 } from './db-upgrade.js';
import { tx } from './i18n.js';

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

// ---------- Restoring ----------

// What restore brings back, and what a record needs to be usable. Device values (meta) and
// the Field Notes index (its pages come back from the Field Notes backup) are left out.
const str = v => typeof v === 'string' && v.length > 0 && v.length <= 200;
const epoch = v => Number.isInteger(v) && v >= 1;
const owned = r => str(r.profileId);
const CHECKS = {
  profiles: r => typeof r.name === 'string' && epoch(r.timeline?.epoch) && str(r.timeline?.startAt) &&
    typeof r.parent === 'object' && r.parent !== null && str(r.createdAt),
  packs: r => owned(r) && epoch(r.epoch) && Number.isInteger(r.seq) && str(r.dropId) &&
    Array.isArray(r.cardIds) && r.cardIds.every(str),
  collection: r => owned(r) && str(r.cardId) && (r.epoch === undefined || epoch(r.epoch)),
  badges: r => owned(r) && (str(r.badgeId) || str(r.groupId)) && (r.epoch === undefined || epoch(r.epoch)),
  quiz: r => owned(r) && str(r.kind) && Number.isFinite(r.best),
};
const RESTORED = Object.keys(CHECKS);

export class BackupError extends Error {}

// The file's records, checked, with a version 3 file's cards and badges keyed per epoch.
export function readBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new BackupError('Not JSON'); }
  if (data?.format !== FORMAT || data.version !== 1 || !Number.isInteger(data.dbVersion) ||
    data.dbVersion > db.VERSION || typeof data.stores !== 'object' || data.stores === null) {
    throw new BackupError('Not a WildFile progress backup');
  }
  const stores = {};
  for (const name of RESTORED) {
    const list = Array.isArray(data.stores[name]) ? data.stores[name] : [];
    stores[name] = list.filter(r => r && typeof r === 'object' && str(r.id) && CHECKS[name](r));
  }
  const { remove, put } = toV4(stores);
  for (const name of ['collection', 'badges']) {
    const old = new Set(remove[name]);
    stores[name] = [...stores[name].filter(r => !old.has(r.id)), ...put[name]];
  }
  return stores;
}

// Add every record from the file that this device doesn't have yet, in one transaction.
// Nothing here is replaced or deleted, so a restore can't undo progress made since, and it
// works the same into an empty app. Resolves with how many explorers, packs, cards and
// badges (not deleted ones) were added.
export async function restoreProgress(text) {
  // A grown-up's phone has no progress of its own to bring back (db.js refuses it anyway).
  if (await db.getRole() === 'watch') throw new db.WatchOnly("restore: only on the explorers' device");
  const stores = readBackup(text);
  const added = await db.tx(RESTORED, 'readwrite', async a => {
    const n = Object.fromEntries(RESTORED.map(name => [name, 0]));
    for (const name of RESTORED) {
      for (const r of stores[name]) if (await a.add(name, r) && !r.deletedAt) n[name]++;
    }
    return n;
  });
  return { profiles: added.profiles, packs: added.packs, cards: added.collection, badges: added.badges };
}

// What a restore says: how much came back, or why nothing did.
export function restoreText(n) {
  if (!n.profiles && !n.packs && !n.cards && !n.badges) return tx('parents.restoreNothing');
  return tx('parents.restoreDone', n);
}
export function restoreError(err) {
  console.error(err);
  return tx(err instanceof BackupError ? 'parents.restoreBad' : 'parents.restoreFailed');
}
