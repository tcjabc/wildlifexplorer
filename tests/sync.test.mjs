// js/cloud/sync.js against a fake Data API, on the realistic database of tests/fixtures/v3.mjs
// (upgraded on open): the first-sign-in choice, what may leave the device, the order and
// size of uploads, the outbox, and offline, rejected or concurrent changes.
// Run: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as db from '../js/db.js';
import { createSync, toRow, statusKey } from '../js/cloud/sync.js';
import { AuthError } from '../js/cloud/auth.js';
import { buildV3, ADA, BEN, CAT, DAN } from './fixtures/v3.mjs';

const FAMILY = '11111111-1111-4111-8111-111111111111';
// Exactly the columns each table has (supabase/migrations): nothing else may be sent.
const COLUMNS = {
  profiles: ['id', 'family_id', 'name', 'lang', 'avatar', 'zhuyin', 'rate', 'length_unit', 'temp_unit', 'drop_day',
    'drop_time', 'timeline_epoch', 'timeline_start_at', 'client_updated_at', 'created_at', 'deleted_at'],
  packs: ['profile_id', 'family_id', 'epoch', 'drop_id', 'seq', 'card_ids', 'due_at', 'granted_at', 'opened_at'],
  collection: ['profile_id', 'family_id', 'epoch', 'card_id', 'collected_at', 'drop_id'],
  badges: ['profile_id', 'family_id', 'epoch', 'badge_id', 'earned_at'],
};

// The fake server: records requests, keeps upserted rows, and can be offline or refuse rows.
const server = {
  calls: [], rows: { profiles: new Map(), packs: new Map(), collection: new Map(), badges: new Map() },
  offline: false, refuse: () => false, during: null,
};
const KEY = { packs: 'drop_id', collection: 'card_id', badges: 'badge_id' };
const keyOf = (table, r) => (table === 'profiles' ? r.id : [r.profile_id, r.epoch, r[KEY[table]]].join(':'));
const reply = (status, body) => ({ status, json: async () => body, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
let user = { signedIn: true, userId: 'user-1', email: 'parent@example.test', needsSignIn: false };
const auth = {
  state: async () => user,
  onChange: () => {},
  async authFetch(path, init = {}) {
    if (server.offline) throw new AuthError('offline');
    const u = new URL(path, 'https://example.supabase.co');
    const table = u.pathname.split('/').pop();
    const body = init.body ? JSON.parse(init.body) : undefined;
    server.calls.push({ table, method: init.method ?? 'GET', search: u.search, prefer: init.headers?.Prefer, body });
    if (table === 'family_members') return reply(200, [{ family_id: FAMILY, role: 'owner' }]);
    if (server.during) { const fn = server.during; server.during = null; await fn(); }
    if (body.some(r => server.refuse(table, r))) return reply(409, { code: '23505', message: 'duplicate key' });
    for (const r of body) server.rows[table].set(keyOf(table, r), r);
    return reply(201);
  },
};
const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };
const newSync = () => createSync({ db, auth, locks: undefined, timers: noTimers });
let sync;
const uploads = table => server.calls.filter(c => c.table === table && c.method === 'POST');
const outbox = () => db.all('outbox');
const reset = () => { server.calls = []; };

before(async () => {
  await buildV3();
  sync = newSync();
  await db.all('profiles'); // opens (and upgrades) the database
});

test('before the first choice nothing is sent, and the explorers on offer are the ones not deleted', async () => {
  assert.equal(await sync.stage(), 'choose');
  await sync.push();
  assert.deepEqual(server.calls, []);
  assert.deepEqual((await sync.candidates()).map(p => p.name), ['Ada', 'Ben', 'Dan']); // Cat was deleted
});

test('first sign-in: the ticked explorers go up with their progress, profiles first, allow-listed columns only', async () => {
  await sync.setUp([ADA, BEN]); // Dan unticked
  assert.equal(server.calls[0].table, 'family_members');
  const tables = server.calls.slice(1).map(c => c.table);
  assert.deepEqual(tables, ['profiles', 'packs', 'collection', 'badges']);
  for (const c of server.calls.slice(1)) {
    assert.equal(c.search, `?on_conflict=${{ profiles: 'id', packs: 'profile_id,epoch,drop_id', collection: 'profile_id,epoch,card_id', badges: 'profile_id,epoch,badge_id' }[c.table]}`);
    assert.equal(c.prefer, 'resolution=merge-duplicates,return=minimal');
    for (const row of c.body) assert.deepEqual(Object.keys(row).sort(), [...COLUMNS[c.table]].sort(), c.table);
    assert.ok(c.body.every(r => r.family_id === FAMILY));
  }
  const all = JSON.stringify(server.calls);
  for (const secret of ['heightCm', 'weightKg', '"age"', 'homeCountry', 'preview', 'notifiedAt', 'sizes', 'page-1']) {
    assert.equal(all.includes(secret), false, secret);
  }
  assert.deepEqual([...server.rows.profiles.keys()].sort(), [ADA, BEN].sort());
  // Ada: only epoch 3 is live (older epochs were marked deleted by version 3's resets).
  assert.deepEqual([...server.rows.packs.values()].filter(r => r.profile_id === ADA).map(r => r.epoch), [3, 3]);
  assert.equal([...server.rows.collection.values()].filter(r => r.profile_id === BEN).length, 5);
  assert.equal([...server.rows.collection.keys()].some(k => k.startsWith('ghost') || k.startsWith(DAN) || k.startsWith(CAT)), false);
  assert.deepEqual(await outbox(), []);
  const cfg = await db.getMeta('sync');
  assert.deepEqual(cfg.localOnly.sort(), [CAT, DAN].sort());
  assert.equal(cfg.familyId, FAMILY);
});

test('the choice is remembered: not asked again, also after a restart', async () => {
  assert.equal(await sync.stage(), 'on');
  assert.equal(await newSync().stage(), 'on');
  reset();
  await sync.setUp([DAN]); // already chosen: nothing changes
  assert.deepEqual(server.calls, []);
  assert.deepEqual((await db.getMeta('sync')).localOnly.sort(), [CAT, DAN].sort());
});

test('an unticked explorer stays on this device: its changes are never sent', async () => {
  reset();
  const dan = await db.get('profiles', DAN);
  await db.put('profiles', { ...dan, name: 'Danny' });
  await db.put('collection', { id: `${DAN}:2:red-fox`, profileId: DAN, epoch: 2, cardId: 'red-fox', collectedAt: new Date().toISOString(), packId: null, dropId: null });
  assert.equal((await outbox()).length, 2);
  await sync.push();
  assert.deepEqual(server.calls, []);
  assert.deepEqual(await outbox(), []);
  assert.deepEqual((await sync.status()).localOnly.map(p => p.name), ['Danny']);
});

test('a change after the first sync sends just that record', async () => {
  reset();
  const at = new Date().toISOString();
  await db.put('collection', { id: `${BEN}:1:emu`, profileId: BEN, epoch: 1, cardId: 'emu', collectedAt: at, packId: `${BEN}:1:s1-w03`, dropId: 's1-w03' });
  await sync.push();
  assert.equal(server.calls.length, 1);
  assert.deepEqual(server.calls[0].body, [{ profile_id: BEN, family_id: FAMILY, epoch: 1, card_id: 'emu', collected_at: at, drop_id: 's1-w03' }]);
});

test('a deletion after the first sync goes up', async () => {
  reset();
  const ben = await db.get('profiles', BEN);
  const at = new Date().toISOString();
  await db.put('profiles', { ...ben, deletedAt: at, updatedAt: at });
  await sync.push();
  assert.equal(server.rows.profiles.get(BEN).deleted_at, at);
  await db.put('profiles', ben); // back, for the tests below
  await sync.push();
});

test('many records go up in batches of 500', async () => {
  reset();
  const at = new Date().toISOString();
  await db.tx(['collection'], 'readwrite', async a => {
    for (let i = 0; i < 1200; i++) await a.put('collection', { id: `${ADA}:3:card-${i}`, profileId: ADA, epoch: 3, cardId: `card-${i}`, collectedAt: at, packId: null, dropId: null });
  });
  await sync.push();
  assert.deepEqual(uploads('collection').map(c => c.body.length), [500, 500, 200]);
  assert.deepEqual(await outbox(), []);
});

test('offline: everything stays queued, and goes up once back online', async () => {
  reset();
  server.offline = true;
  const ada = await db.get('profiles', ADA);
  await db.put('profiles', { ...ada, avatar: 5, settingsAt: new Date().toISOString() });
  await sync.push();
  assert.equal((await outbox()).length, 1);
  assert.equal((await sync.status()).problem, 'offline');
  server.offline = false;
  await sync.push();
  assert.deepEqual(await outbox(), []);
  assert.equal(server.rows.profiles.get(ADA).avatar, 5);
  assert.equal((await sync.status()).problem, null);
});

test('a change made while its record is being sent is sent again', async () => {
  reset();
  const ada = await db.get('profiles', ADA);
  await db.put('profiles', { ...ada, name: 'Ada L.' });
  server.during = () => db.put('profiles', { ...ada, name: 'Ada Lovelace' }); // lands mid-request
  await sync.push();
  assert.equal(server.rows.profiles.get(ADA).name, 'Ada L.');
  assert.equal((await outbox()).length, 1); // the newer change is still queued
  await sync.push();
  assert.equal(server.rows.profiles.get(ADA).name, 'Ada Lovelace');
  assert.deepEqual(await outbox(), []);
});

test('a record the server refuses is held back; the rest still go', async () => {
  reset();
  server.refuse = (table, r) => table === 'collection' && r.card_id === 'tiger';
  const at = new Date().toISOString();
  await db.tx(['collection'], 'readwrite', async a => {
    for (const cardId of ['tiger', 'koala', 'orca', 'emu']) {
      await a.put('collection', { id: `${ADA}:3:${cardId}`, profileId: ADA, epoch: 3, cardId, collectedAt: at, packId: null, dropId: null });
    }
  });
  await sync.push();
  for (const c of ['koala', 'orca', 'emu']) assert.ok(server.rows.collection.has(`${ADA}:3:${c}`), c);
  assert.equal(server.rows.collection.has(`${ADA}:3:tiger`), false);
  const held = await outbox();
  assert.equal(held.length, 1);
  assert.equal(held[0].error, '409 23505');
  assert.equal((await sync.status()).held, 1);
  reset();
  await sync.push(); // held back: not sent again on its own
  assert.deepEqual(server.calls, []);
  server.refuse = () => false;
  await db.put('collection', { id: `${ADA}:3:tiger`, profileId: ADA, epoch: 3, cardId: 'tiger', collectedAt: at, packId: null, dropId: null });
  await sync.push(); // it changed: tried again
  assert.ok(server.rows.collection.has(`${ADA}:3:tiger`));
  assert.deepEqual(await outbox(), []);
});

test('a record the server would refuse anyway is held back without sending it', async () => {
  reset();
  const ada = await db.get('profiles', ADA);
  await db.put('profiles', { ...ada, name: '' });
  await sync.push();
  assert.deepEqual(server.calls, []);
  assert.equal((await outbox())[0].error, 'invalid name');
  await db.put('profiles', ada);
  await sync.push();
  assert.deepEqual(await outbox(), []);
});

test('another account signed in on this device sends nothing', async () => {
  reset();
  user = { ...user, userId: 'user-2', email: 'someone@example.test' };
  const ada = await db.get('profiles', ADA);
  await db.put('profiles', { ...ada, name: 'Ada 2' });
  assert.equal(await sync.stage(), 'other-account');
  await sync.push();
  assert.deepEqual(server.calls, []);
  const s = await sync.status();
  assert.equal(s.stage, 'other-account');
  assert.equal(s.email, 'parent@example.test');
  user = { ...user, userId: 'user-1', email: 'parent@example.test' };
  await sync.push(); // the right account again: it goes up
  assert.equal(server.rows.profiles.get(ADA).name, 'Ada 2');
});

test('signed out: nothing is sent and changes wait', async () => {
  reset();
  user = { signedIn: false, userId: null, email: 'parent@example.test', needsSignIn: false };
  const ada = await db.get('profiles', ADA);
  await db.put('profiles', { ...ada, name: 'Ada 3' });
  await sync.push();
  assert.deepEqual(server.calls, []);
  assert.equal((await outbox()).length, 1);
  user = { signedIn: true, userId: 'user-1', email: 'parent@example.test', needsSignIn: false };
});

test('an explorer unticked at first sign-in can be added later: everything they have goes up once', async () => {
  // Dan was unticked. While only on this device he got a pack, its card and a badge (and
  // earlier, in the "stays on this device" test, a card with no pack).
  const at = new Date().toISOString();
  await db.tx(['packs', 'collection', 'badges'], 'readwrite', async a => {
    await a.put('packs', { id: `${DAN}:2:s1-w01`, profileId: DAN, epoch: 2, seq: 0, dropId: 's1-w01', cardIds: ['barn-owl'], dueAt: at, grantedAt: at, notifiedAt: at, openedAt: at });
    await a.put('collection', { id: `${DAN}:2:barn-owl`, profileId: DAN, epoch: 2, cardId: 'barn-owl', collectedAt: at, packId: `${DAN}:2:s1-w01`, dropId: 's1-w01' });
    await a.put('badges', { id: `${DAN}:2:continent:asia:bronze`, profileId: DAN, epoch: 2, badgeId: 'continent:asia:bronze', earnedAt: at });
  });
  await sync.push();
  reset();
  assert.deepEqual((await sync.status()).localOnly.map(p => p.id), [DAN]);

  await sync.addToFamily(DAN);
  const sent = server.calls.filter(c => c.method === 'POST').flatMap(c => c.body.map(r => `${c.table}:${keyOf(c.table, r)}`));
  assert.deepEqual(sent.sort(), [
    `profiles:${DAN}`,
    `packs:${DAN}:2:s1-w01`,
    `collection:${DAN}:2:barn-owl`, `collection:${DAN}:2:red-fox`, // not panda: deleted at a version 3 reset
    `badges:${DAN}:2:continent:asia:bronze`,
  ].sort());
  assert.deepEqual(server.calls.filter(c => c.method === 'POST').map(c => c.table), ['profiles', 'packs', 'collection', 'badges']);
  assert.equal(server.rows.profiles.get(DAN).name, 'Danny');
  assert.deepEqual((await db.getMeta('sync')).localOnly, [CAT]);
  assert.deepEqual((await sync.status()).localOnly, []);
  assert.deepEqual(await outbox(), []);

  reset();
  await sync.push(); // once: nothing left to send
  await sync.addToFamily(DAN); // already added: nothing happens
  assert.deepEqual(server.calls, []);
  const dan = await db.get('profiles', DAN);
  await db.put('profiles', { ...dan, name: 'Dan', settingsAt: new Date().toISOString() });
  await sync.push(); // and from now on like everyone else
  assert.equal(server.rows.profiles.get(DAN).name, 'Dan');
});

test('an explorer deleted before the first sync can\'t be added later', async () => {
  reset();
  await sync.addToFamily(CAT);
  assert.deepEqual(server.calls, []);
  assert.deepEqual((await db.getMeta('sync')).localOnly, [CAT]);
});

test('toRow: settingsAt decides the settings\' time, and device-only fields never appear', () => {
  const p = {
    id: ADA, name: 'Ada', lang: 'both', avatar: 1, zhuyin: true, rate: 'slow', age: 7, heightCm: 120, weightKg: 22,
    homeCountry: 'TW', notesInput: 'pen', parent: { dropDay: 6, dropTime: '09:00', length: 'metric', temp: 'C', preview: true },
    timeline: { epoch: 2, startAt: '2026-09-01T00:00:00.000Z' }, createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z', settingsAt: '2026-10-01T00:00:00.000Z', deletedAt: null,
  };
  const row = toRow('profiles', p, FAMILY);
  assert.equal(row.client_updated_at, '2026-10-01T00:00:00.000Z');
  assert.deepEqual(Object.keys(row).sort(), [...COLUMNS.profiles].sort());
  assert.equal(toRow('profiles', { ...p, settingsAt: undefined }, FAMILY).client_updated_at, p.updatedAt);
  assert.equal(toRow('collection', { profileId: ADA, epoch: 1, cardId: 'emu', collectedAt: p.createdAt, deletedAt: p.updatedAt }, FAMILY), null);
});

test('statusKey: "saved" only once set up and a push went through, with nothing waiting, held or wrong', () => {
  const on = { stage: 'on', busy: false, savedAt: '2026-11-03T17:00:00.000Z', problem: null, waiting: 0, held: 0 };
  assert.equal(statusKey(on), 'sync.saved');
  assert.equal(statusKey({ ...on, savedAt: null }), 'sync.saving'); // no push yet in this window
  assert.equal(statusKey({ ...on, busy: true }), 'sync.saving');
  assert.equal(statusKey({ ...on, problem: 'offline' }), 'sync.offline');
  assert.equal(statusKey({ ...on, savedAt: null, problem: 'offline' }), 'sync.offline');
  assert.equal(statusKey({ ...on, problem: 'server' }), 'sync.retry');
  assert.equal(statusKey({ ...on, waiting: 2 }), 'sync.waiting');
  assert.equal(statusKey({ ...on, held: 1 }), 'sync.held');
  for (const stage of ['choose', 'signed-out', 'needs-sign-in']) assert.equal(statusKey({ ...on, stage }), null, stage);
  assert.equal(statusKey({ ...on, stage: 'other-account' }), 'sync.otherAccount');
});

test('status: set up but not pushed yet in this window is not "saved"; after a push it is', async () => {
  const fresh = newSync(); // a new window: nothing pushed yet
  assert.equal(statusKey(await fresh.status()), 'sync.saving');
  await fresh.push();
  assert.equal(statusKey(await fresh.status()), 'sync.saved');
});

test('setUp fails without a family lookup: nothing is saved, and the stage stays "choose"', async () => {
  const lonely = createSync({
    db, locks: undefined, timers: noTimers,
    auth: { ...auth, state: async () => ({ signedIn: true, userId: 'user-9', email: 'x@example.test' }), authFetch: async () => { throw new AuthError('offline'); } },
  });
  const cfg = await db.getMeta('sync');
  await db.remove('meta', 'sync');
  try {
    assert.equal(await lonely.stage(), 'choose');
    await assert.rejects(lonely.setUp([]), { code: 'offline' });
    assert.equal(await lonely.stage(), 'choose');
    assert.equal(statusKey(await lonely.status()), null);
  } finally {
    await db.setMeta('sync', cfg);
  }
});
