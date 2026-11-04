// Rows pulled from the family account, merged into this device's records with the same
// rules as the server's merge triggers (supabase/migrations), so every device ends up with
// what the server has, whatever order they sync in:
//   profiles    settings: the newer settingsAt wins (the server's on a tie); timeline: the
//               higher epoch wins (the server's start on a tie); once deleted, always deleted
//   packs       the server's details (it keeps the first grant); opened: the earliest time
//   collection  the earliest collection, with the pack it came in
//   badges      the earliest time it was earned
// Settings are decided by the devices' clocks (settingsAt), so a device whose clock is far
// ahead wins. Only the server's columns are read: device-only fields (height, weight, age,
// home country, preview, Field Notes settings, when a pack was first shown) are never touched.
//
// Each merge takes the local record (or undefined) and the row, and returns null when the
// local record stays as it is, else { record, ahead }. ahead: this device still has
// something the server doesn't, so the record goes up again with the next push; otherwise
// it is exactly what the server has. Throws Invalid for a row this app can't use.

// The server's own checks, used both ways (sync.js checks records before sending them).
export const CARD = /^[a-z0-9][a-z0-9_-]{0,79}$/;
export const DROP = /^[a-z0-9][a-z0-9_-]{0,39}$/;
export const BADGE = /^[a-z0-9][a-z0-9:_-]{0,79}$/;
export const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
export const iso = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
export const isoOrNull = v => v == null || iso(v);
export const epochOk = v => Number.isInteger(v) && v >= 1;

export class Invalid extends Error {}
export function check(ok, what) { if (!ok) throw new Invalid(what); }

// Times as this device writes them ('…Z'); the server sends '…+00:00'.
const isoOf = v => (v == null ? null : new Date(v).toISOString());
const ms = v => Date.parse(v);
const earliest = (a, b) => (a == null ? b : b == null ? a : ms(b) < ms(a) ? b : a);
const progressId = (row, key) => `${row.profile_id}:${row.epoch}:${key}`;

// null when nothing changed, else the record with a new updatedAt.
function result(local, next, ahead, now) {
  if (local && JSON.stringify(local) === JSON.stringify(next)) return null;
  return { record: { ...next, updatedAt: now }, ahead };
}

export function mergeProfile(local, row, now) {
  check(typeof row.id === 'string' && typeof row.name === 'string' && ['en', 'zh', 'both'].includes(row.lang), 'profile');
  check(Number.isInteger(row.avatar) && typeof row.zhuyin === 'boolean' && ['normal', 'slow'].includes(row.rate), 'settings');
  check(['metric', 'imperial'].includes(row.length_unit) && ['C', 'F'].includes(row.temp_unit), 'units');
  check(Number.isInteger(row.drop_day) && HHMM.test(row.drop_time ?? ''), 'drop time');
  check(epochOk(row.timeline_epoch) && iso(row.timeline_start_at), 'timeline');
  check(iso(row.client_updated_at) && iso(row.created_at) && isoOrNull(row.deleted_at), 'times');
  const settings = { name: row.name, lang: row.lang, avatar: row.avatar, zhuyin: row.zhuyin, rate: row.rate };
  const units = { dropDay: row.drop_day, dropTime: row.drop_time, length: row.length_unit, temp: row.temp_unit };
  const settingsAt = isoOf(row.client_updated_at);
  const timeline = { epoch: row.timeline_epoch, startAt: isoOf(row.timeline_start_at) };
  const deletedAt = isoOf(row.deleted_at);

  if (!local) {
    if (deletedAt) return null; // never on this device: nothing to keep
    return result(undefined, {
      id: row.id, ...settings, age: null, ageAsOf: null, heightCm: null, weightKg: null, homeCountry: null,
      parent: { ...units, preview: false }, timeline, settingsAt,
      createdAt: isoOf(row.created_at), deletedAt: null,
    }, false, now);
  }
  let ahead = false;
  const next = { ...local, createdAt: isoOf(row.created_at) }; // the server keeps the first
  if (ms(settingsAt) >= ms(local.settingsAt ?? local.updatedAt)) {
    Object.assign(next, settings, { parent: { ...local.parent, ...units }, settingsAt });
  } else ahead = true;
  if (timeline.epoch >= local.timeline.epoch) next.timeline = timeline;
  else ahead = true;
  next.deletedAt = earliest(local.deletedAt ?? null, deletedAt);
  if (next.deletedAt !== deletedAt) ahead = true;
  return result(local, next, ahead, now);
}

// Progress this device marked deleted (version 3's "Start over") is history it keeps but
// never sends; a row for the same key from the server takes its place.
const gone = local => !local || Boolean(local.deletedAt);

export function mergePack(local, row, now) {
  check(typeof row.profile_id === 'string' && epochOk(row.epoch) && DROP.test(row.drop_id ?? ''), 'pack');
  check(Number.isInteger(row.seq) && Array.isArray(row.card_ids) && row.card_ids.every(c => CARD.test(c)), 'cards');
  check(iso(row.due_at) && iso(row.granted_at) && isoOrNull(row.opened_at), 'times');
  const details = { seq: row.seq, cardIds: [...row.card_ids], dueAt: isoOf(row.due_at), grantedAt: isoOf(row.granted_at) };
  const openedAt = isoOf(row.opened_at);
  if (gone(local)) {
    // Shown as "New pack arrived" here once, unless it was opened already.
    return result(undefined, {
      id: progressId(row, row.drop_id), profileId: row.profile_id, epoch: row.epoch, ...details, dropId: row.drop_id,
      notifiedAt: openedAt, openedAt, createdAt: local?.createdAt ?? now, deletedAt: null,
    }, false, now);
  }
  const next = { ...local, ...details, openedAt: earliest(local.openedAt ?? null, openedAt) };
  if (next.openedAt && !next.notifiedAt) next.notifiedAt = next.openedAt;
  return result(local, next, next.openedAt !== openedAt, now);
}

export function mergeCard(local, row, now) {
  check(typeof row.profile_id === 'string' && epochOk(row.epoch) && CARD.test(row.card_id ?? ''), 'card');
  check(iso(row.collected_at) && (row.drop_id == null || DROP.test(row.drop_id)), 'card');
  const collectedAt = isoOf(row.collected_at);
  const dropId = row.drop_id ?? null;
  const packId = dropId && progressId(row, dropId);
  if (gone(local)) {
    return result(undefined, {
      id: progressId(row, row.card_id), profileId: row.profile_id, epoch: row.epoch, cardId: row.card_id,
      collectedAt, packId, dropId, createdAt: local?.createdAt ?? now, deletedAt: null,
    }, false, now);
  }
  if (ms(local.collectedAt) < ms(collectedAt)) return null; // this device's is earlier: it goes up
  const next = { ...local, collectedAt, dropId, packId: dropId === (local.dropId ?? null) ? local.packId : packId };
  return result(local, next, false, now);
}

export function mergeBadge(local, row, now) {
  check(typeof row.profile_id === 'string' && epochOk(row.epoch) && BADGE.test(row.badge_id ?? '') && iso(row.earned_at), 'badge');
  const earnedAt = isoOf(row.earned_at);
  if (gone(local)) {
    return result(undefined, {
      id: progressId(row, row.badge_id), profileId: row.profile_id, epoch: row.epoch, badgeId: row.badge_id,
      earnedAt, createdAt: local?.createdAt ?? now, deletedAt: null,
    }, false, now);
  }
  if (ms(local.earnedAt) < ms(earnedAt)) return null;
  return result(local, { ...local, earnedAt }, false, now);
}

export const MERGE = { profiles: mergeProfile, packs: mergePack, collection: mergeCard, badges: mergeBadge };
