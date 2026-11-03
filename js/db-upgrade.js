// Version 4 of the local database keeps progress per timeline epoch, the way the server
// does (supabase/migrations/20261103120520_progress.sql). Up to version 3 a collected card
// was keyed profile + card, a badge profile + badge, and "Start over" marked them deleted.
// From version 4 both are keyed profile + epoch + card (or badge) and carry their epoch.
// Pure, so it can be tested on its own; db.js runs it inside the upgrade, and restoring a
// version 3 backup runs it on the file.

const TIME = { collection: 'collectedAt', badges: 'earnedAt' };

// When each earlier epoch ended. "Start over" stamped every live record with one deletedAt
// time, the same time the next epoch started: a deleted pack dates the end of its epoch,
// and the current timeline's start dates the end of the one before.
function timeline(profile, packs) {
  const current = profile?.timeline?.epoch ?? 1;
  const ends = new Map();
  for (const k of packs) {
    if (k.deletedAt && k.epoch < current && !(ends.get(k.epoch) <= k.deletedAt)) ends.set(k.epoch, k.deletedAt);
  }
  if (current > 1 && profile.timeline.startAt) ends.set(current - 1, profile.timeline.startAt);
  return { current, ends: [...ends].sort((a, b) => a[0] - b[0]) };
}

// Live records are what the binder shows now: always the current epoch. A deleted one goes
// to its pack's epoch, else the first epoch that ended when (or after) it was deleted.
// Deleted records stay deleted, so whichever epoch they land in, the app never shows them.
function epochOf(rec, pack, { current, ends }) {
  if (!rec.deletedAt) return current;
  if (pack) return pack.epoch;
  return ends.find(([, end]) => end >= rec.deletedAt)?.[0] ?? Math.max(1, current - 1);
}

// Two old records for one new key: keep the live one, else the earlier.
const better = (a, b, time) => (Boolean(a.deletedAt) !== Boolean(b.deletedAt)
  ? (a.deletedAt ? b : a)
  : (b[time] < a[time] ? b : a));

// Badges from before Phase 2 have only groupId (a group badge).
function badge({ groupId, ...rec }, epoch) {
  const badgeId = rec.badgeId ?? `group:${groupId}`;
  return { ...rec, id: `${rec.profileId}:${epoch}:${badgeId}`, epoch, badgeId };
}

// The records to delete (old ids) and to write (new ids), per store. Records that already
// have an epoch are left alone.
export function toV4({ profiles = [], packs = [], collection = [], badges = [] }) {
  const lines = new Map(profiles.map(p => [p.id, timeline(p, packs.filter(k => k.profileId === p.id))]));
  const packById = new Map(packs.map(k => [k.id, k]));
  const out = { remove: { collection: [], badges: [] }, put: { collection: [], badges: [] } };
  for (const [store, list] of [['collection', collection], ['badges', badges]]) {
    const next = new Map();
    for (const rec of list) {
      if (Number.isInteger(rec.epoch)) continue;
      const pack = rec.packId ? packById.get(rec.packId) : null;
      const epoch = epochOf(rec, pack, lines.get(rec.profileId) ?? { current: 1, ends: [] });
      const v = store === 'collection'
        ? { ...rec, id: `${rec.profileId}:${epoch}:${rec.cardId}`, epoch, dropId: pack?.dropId ?? null }
        : badge(rec, epoch);
      next.set(v.id, next.has(v.id) ? better(next.get(v.id), v, TIME[store]) : v);
      out.remove[store].push(rec.id);
    }
    out.put[store] = [...next.values()];
  }
  return out;
}
