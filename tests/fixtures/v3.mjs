// A version 3 database as the app left it, with the history real explorers build up.
//   Ada   started over twice (epoch 3). Epoch 1 had a pack and a card from before packs;
//         epoch 2 had two opened packs. In version 3 a card collected again after a reset
//         overwrote its old record (same key), so only the latest one is left.
//   Ben   never reset (epoch 1): opened and unopened packs, a card from before packs, a
//         group badge from before Phase 2 (groupId only) and the same badge again as a
//         newer record, and a quiz score.
//   Dan   started over once (epoch 2) with no packs in epoch 1: only a card from before
//         packs, so nothing but the new timeline's start dates that reset.
//   Cat   a deleted explorer, with her progress still there.
//   ghost a card whose explorer record is missing.
export const ADA = '00000000-0000-4000-8000-00000000000a';
export const BEN = '00000000-0000-4000-8000-00000000000b';
export const CAT = '00000000-0000-4000-8000-00000000000c';
export const DAN = '00000000-0000-4000-8000-00000000000d';

const T = {
  start1: '2026-08-01T09:00:00.000Z',
  end1: '2026-08-20T18:30:00.000Z', // Ada's first "Start over"
  end2: '2026-09-10T07:15:00.000Z', // Ada's second; epoch 3 starts here
  later: '2026-09-20T09:00:00.000Z',
  danReset: '2026-09-05T16:00:00.000Z',
};
const meta = (createdAt, deletedAt = null, updatedAt = deletedAt ?? createdAt) => ({ createdAt, updatedAt, deletedAt });
const parent = { dropDay: 6, dropTime: '09:00', length: 'metric', temp: 'C', preview: false };
const profile = (id, name, avatar, epoch, startAt, extra = {}) => ({
  id, name, lang: 'both', age: 7, ageAsOf: T.start1, heightCm: 120, weightKg: 22, homeCountry: 'TW',
  avatar, zhuyin: false, rate: 'normal', parent, timeline: { epoch, startAt }, ...meta(T.start1), ...extra,
});
const pack = (pid, epoch, seq, dropId, cardIds, { opened = null, deleted = null } = {}) => ({
  id: `${pid}:${epoch}:${dropId}`, profileId: pid, epoch, seq, dropId, cardIds,
  dueAt: T.start1, grantedAt: T.start1, notifiedAt: T.start1, openedAt: opened, ...meta(T.start1, deleted),
});
const card = (pid, cardId, collectedAt, packId, deleted = null) => ({
  id: `${pid}:${cardId}`, profileId: pid, cardId, collectedAt, packId, ...meta(collectedAt, deleted),
});
const badge = (pid, badgeId, earnedAt, deleted = null) => ({
  id: `${pid}:${badgeId}`, profileId: pid, badgeId, earnedAt, ...meta(earnedAt, deleted),
});

export const records = {
  meta: [
    { id: 'migratedV1', value: true },
    { id: 'persistAsked', value: true },
    { id: 'activeProfile', value: ADA },
  ],
  profiles: [
    profile(ADA, 'Ada', 1, 3, T.end2, { updatedAt: T.end2 }),
    profile(BEN, 'Ben', 2, 1, T.start1),
    profile(CAT, 'Cat', 3, 1, T.start1, meta(T.start1, T.later)),
    profile(DAN, 'Dan', 4, 2, T.danReset, { updatedAt: T.danReset }),
  ],
  packs: [
    pack(ADA, 1, 0, 's1-w01', ['red-fox', 'barn-owl'], { opened: T.start1, deleted: T.end1 }),
    pack(ADA, 2, 0, 's1-w01', ['red-fox', 'barn-owl'], { opened: T.end1, deleted: T.end2 }),
    pack(ADA, 2, 1, 's1-w02', ['tiger', 'koala'], { opened: T.end1, deleted: T.end2 }),
    pack(ADA, 3, 0, 's1-w01', ['red-fox', 'barn-owl'], { opened: T.end2 }),
    pack(ADA, 3, 1, 's1-w02', ['tiger', 'koala']),
    pack(BEN, 1, 0, 's1-w01', ['red-fox', 'barn-owl'], { opened: T.start1 }),
    pack(BEN, 1, 1, 's1-w02', ['tiger', 'koala'], { opened: T.later }),
    pack(BEN, 1, 2, 's1-w03', ['emu', 'orca']),
    pack(CAT, 1, 0, 's1-w01', ['red-fox', 'barn-owl'], { opened: T.start1 }),
  ],
  collection: [
    card(ADA, 'red-fox', T.end2, `${ADA}:3:s1-w01`),             // collected again in epoch 3
    card(ADA, 'barn-owl', T.end2, `${ADA}:3:s1-w01`),
    card(ADA, 'tiger', T.end1, `${ADA}:2:s1-w02`, T.end2),        // epoch 2, deleted
    card(ADA, 'koala', T.end1, `${ADA}:2:s1-w02`, T.end2),
    card(ADA, 'snow-leopard', T.start1, null, T.end1),             // epoch 1, from before packs
    card(BEN, 'red-fox', T.start1, `${BEN}:1:s1-w01`),
    card(BEN, 'barn-owl', T.start1, `${BEN}:1:s1-w01`),
    card(BEN, 'tiger', T.later, `${BEN}:1:s1-w02`),
    card(BEN, 'koala', T.later, `${BEN}:1:s1-w02`),
    card(BEN, 'snow-leopard', T.start1, null),
    card(CAT, 'red-fox', T.start1, `${CAT}:1:s1-w01`),
    card(DAN, 'panda', T.start1, null, T.danReset),
    card('ghost', 'red-fox', T.start1, null),
  ],
  badges: [
    badge(ADA, 'continent:asia:bronze', T.end2),
    badge(ADA, 'biome:forest:bronze', T.end1, T.end2),
    { id: `${ADA}:birds`, profileId: ADA, groupId: 'birds', earnedAt: T.start1, ...meta(T.start1, T.end1) },
    { id: `${BEN}:mammals`, profileId: BEN, groupId: 'mammals', earnedAt: T.start1, ...meta(T.start1) },
    badge(BEN, 'group:mammals', T.later),                         // the same badge, earned again later
    badge(BEN, 'continent:asia:bronze', T.later),
  ],
  quiz: [
    { id: `${BEN}:sizes`, profileId: BEN, kind: 'sizes', best: 6, ...meta(T.later) },
    { id: `${ADA}:sizes`, profileId: ADA, kind: 'sizes', best: 4, ...meta(T.start1, T.end2) },
  ],
  notes: [{ id: 'page-1', profileId: BEN, pageId: 'page-1', cardIds: ['red-fox'], ...meta(T.later) }],
  notefiles: [{ id: `${BEN}/page-1.json`, profileId: BEN, blob: '{"items":[]}' }],
};
export const TIMES = T;

const BY_PROFILE = ['packs', 'collection', 'badges', 'quiz', 'notes', 'notefiles'];
export const STORES = ['meta', 'profiles', ...BY_PROFILE];

const done = req => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

// Creates the database exactly as version 3 of db.js did, filled with the records above.
export async function buildV3(factory = indexedDB, data = records) {
  const req = factory.open('wildlife-explorer', 3);
  req.onupgradeneeded = () => {
    for (const name of STORES) {
      const store = req.result.createObjectStore(name, { keyPath: 'id' });
      if (BY_PROFILE.includes(name)) store.createIndex('profileId', 'profileId');
    }
    for (const [name, list] of Object.entries(data)) for (const r of list) req.transaction.objectStore(name).put(r);
  };
  (await done(req)).close();
}

// Every record in the database, per store (opened at whatever version it has).
export async function readAll(factory = indexedDB) {
  const conn = await done(factory.open('wildlife-explorer'));
  const out = { version: conn.version };
  for (const name of conn.objectStoreNames) out[name] = await done(conn.transaction(name).objectStore(name).getAll());
  conn.close();
  return out;
}

// What the binder shows each (not deleted) explorer: version 3 rules and version 4 rules.
const sorted = list => [...new Set(list)].sort();
export function visibleV3(s) {
  return Object.fromEntries(s.profiles.filter(p => !p.deletedAt).map(p => {
    const mine = name => s[name].filter(r => r.profileId === p.id && !r.deletedAt);
    return [p.name, {
      cards: sorted(mine('collection').map(r => r.cardId)),
      badges: sorted(mine('badges').map(r => r.badgeId ?? `group:${r.groupId}`)),
      packs: mine('packs').filter(r => r.epoch === p.timeline.epoch).map(r => [r.id, Boolean(r.openedAt)]).sort(),
    }];
  }));
}
export function visibleV4(s) {
  return Object.fromEntries(s.profiles.filter(p => !p.deletedAt).map(p => {
    const mine = name => s[name].filter(r => r.profileId === p.id && !r.deletedAt && r.epoch === p.timeline.epoch);
    return [p.name, {
      cards: sorted(mine('collection').map(r => r.cardId)),
      badges: sorted(mine('badges').map(r => r.badgeId)),
      packs: mine('packs').map(r => [r.id, Boolean(r.openedAt)]).sort(),
    }];
  }));
}
