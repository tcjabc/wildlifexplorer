// Pulling (js/cloud/sync.js + merge.js): two devices of one family, each with its own
// database, syncing through the fake server of fixtures/server.mjs (which merges like the
// real triggers). Other devices' changes come down, device-only fields stay, local-only
// explorers stay out, and whatever order the devices sync in, they end up the same.
// Run: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSync, statusKey } from '../js/cloud/sync.js';
import { createServer, FAMILY, us } from './fixtures/server.mjs';

const server = createServer();
const user = { signedIn: true, userId: 'user-1', email: 'parent@example.test', needsSignIn: false };
const auth = { state: async () => user, onChange: () => {}, authFetch: server.authFetch };
const noTimers = { setTimeout: () => 0, clearTimeout: () => {} };

// A device: its own copy of db.js on its own (fake) IndexedDB, signed in to a server.
let n = 0;
async function device(deviceAuth = auth, win = globalThis) {
  const db = await import(`../js/db.js?device=${++n}`);
  globalThis.indexedDB = new IDBFactory();
  await db.all('profiles'); // opens it: this copy keeps that database from now on
  const sync = createSync({ db, auth: deviceAuth, locks: undefined, timers: noTimers, win });
  const pulled = [];
  sync.onPulled(ids => pulled.push(ids));
  return { db, sync, pulled };
}

const AT = '2026-09-01T09:00:00.000Z';
const iso = ms => new Date(ms).toISOString();
const later = (min = 1) => iso(Date.now() + min * 60e3);
const explorer = (id, name, over = {}) => ({
  id, name, lang: 'both', age: 7, ageAsOf: AT, heightCm: 120, weightKg: 22, homeCountry: 'TW',
  avatar: 2, zhuyin: false, rate: 'normal', notesInput: 'pen',
  parent: { dropDay: 6, dropTime: '09:00', length: 'metric', temp: 'C', preview: true },
  timeline: { epoch: 1, startAt: AT }, settingsAt: AT, createdAt: AT, updatedAt: AT, deletedAt: null, ...over,
});
const pack = (pid, epoch, seq, over = {}) => ({
  id: `${pid}:${epoch}:s1-w0${seq + 1}`, profileId: pid, epoch, seq, dropId: `s1-w0${seq + 1}`, cardIds: ['emu', 'koala', 'wombat'],
  dueAt: AT, grantedAt: AT, notifiedAt: AT, openedAt: null, createdAt: AT, updatedAt: AT, deletedAt: null, ...over,
});
const card = (pid, epoch, cardId, collectedAt, dropId = null) => ({
  id: `${pid}:${epoch}:${cardId}`, profileId: pid, epoch, cardId, collectedAt, packId: dropId && `${pid}:${epoch}:${dropId}`, dropId,
  createdAt: collectedAt, updatedAt: collectedAt, deletedAt: null,
});

const MIA = '33333333-3333-4333-8333-333333333333';
const LEO = '44444444-4444-4444-8444-444444444444';
const SAM = '55555555-5555-4555-8555-555555555555';
let A; let B;
const synced = p => ({ name: p.name, lang: p.lang, avatar: p.avatar, zhuyin: p.zhuyin, rate: p.rate, ...p.parent, preview: undefined, timeline: p.timeline, deletedAt: p.deletedAt });

before(async () => {
  A = await device();
  await A.db.tx(['profiles', 'packs', 'collection', 'badges', 'quiz'], 'readwrite', async a => {
    await a.put('profiles', explorer(MIA, 'Mia'));
    await a.put('profiles', explorer(LEO, 'Leo', { avatar: 4 }));
    await a.put('packs', pack(MIA, 1, 0, { openedAt: '2026-09-05T10:00:00.000Z' }));
    await a.put('packs', pack(MIA, 1, 1));
    for (const c of ['emu', 'koala', 'wombat']) await a.put('collection', card(MIA, 1, c, '2026-09-05T10:00:00.000Z', 's1-w01'));
    await a.put('badges', { id: `${MIA}:1:secret:aussie`, profileId: MIA, epoch: 1, badgeId: 'secret:aussie', earnedAt: '2026-09-05T10:00:00.000Z', createdAt: AT, updatedAt: AT, deletedAt: null });
    await a.put('quiz', { id: `${MIA}:pictures`, profileId: MIA, kind: 'pictures', best: 9, createdAt: AT, updatedAt: AT, deletedAt: null });
  });
  await A.sync.setUp([MIA, LEO]);
  B = await device();
});

test('a new device gets the family\'s explorers, their Welcome details and progress, with device-only fields empty', async () => {
  // B has an explorer of its own, kept on B only.
  await B.db.put('profiles', explorer(SAM, 'Sam', { createdAt: '2026-08-01T00:00:00.000Z' }));
  await B.sync.setUp([]);
  const mia = await B.db.get('profiles', MIA);
  assert.equal(mia.name, 'Mia');
  assert.deepEqual([mia.age, mia.ageAsOf, mia.heightCm, mia.weightKg, mia.homeCountry], [7, AT, 120, 22, 'TW']);
  assert.equal(mia.parent.preview, false);
  assert.equal(mia.notesInput, undefined);
  assert.equal((await B.db.get('profiles', LEO)).avatar, 4);
  const packs = await B.db.all('packs', MIA);
  assert.deepEqual(packs.map(p => [p.seq, p.openedAt, p.notifiedAt]), [
    [0, '2026-09-05T10:00:00.000Z', '2026-09-05T10:00:00.000Z'], // opened: no "New pack arrived"
    [1, null, null], // unopened: shown as arrived here once
  ]);
  assert.deepEqual((await B.db.all('collection', MIA)).map(c => [c.cardId, c.packId]).sort(),
    [['emu', `${MIA}:1:s1-w01`], ['koala', `${MIA}:1:s1-w01`], ['wombat', `${MIA}:1:s1-w01`]]);
  assert.equal((await B.db.all('badges', MIA)).length, 1);
  assert.deepEqual(await B.db.all('quiz'), []); // never leaves A
  assert.deepEqual(await B.db.all('outbox'), []); // nothing bounces back up
  assert.equal(server.rows.profiles.has(SAM), false);
  assert.deepEqual(B.pulled.flat().sort(), [LEO, MIA].sort());
});

test('a second pull starts just before the last one ended and changes nothing', async () => {
  const cursor = (await B.db.getMeta('syncPull')).at.profiles;
  server.pulls = [];
  B.pulled.length = 0;
  await B.sync.run();
  const since = new URL(`https://x${server.pulls[0].search}`).searchParams.get('updated_at');
  assert.equal(since, `gte.${new Date(Date.parse(cursor) - 60e3).toISOString()}`);
  assert.deepEqual(server.pulls.map(p => p.table), ['profiles', 'packs', 'collection', 'badges']);
  assert.ok(server.pulls.every(p => p.search.includes(`family_id=eq.${FAMILY}`)));
  assert.deepEqual(B.pulled, []);
  assert.deepEqual(await B.db.all('outbox'), []);
});

test('newer settings from another device come down; this device\'s preview stays', async () => {
  const mia = await A.db.get('profiles', MIA);
  await A.db.put('profiles', { ...mia, lang: 'zh', parent: { ...mia.parent, dropDay: 3 }, settingsAt: later() });
  await A.sync.run();
  const before = await B.db.get('profiles', MIA);
  await B.db.put('profiles', { ...before, parent: { ...before.parent, preview: true } }); // device-only
  await B.sync.run();
  const after = await B.db.get('profiles', MIA);
  assert.equal(after.lang, 'zh');
  assert.equal(after.parent.dropDay, 3);
  assert.equal(after.heightCm, 120);
  assert.equal(after.parent.preview, true);
  assert.equal((await A.db.get('profiles', MIA)).parent.preview, true);
});

test('a detail changed on one device reaches the others, and so does clearing one', async () => {
  const leo = await A.db.get('profiles', LEO);
  const at = later(2);
  await A.db.put('profiles', { ...leo, heightCm: 133, homeCountry: 'JP', detailsAt: at });
  await A.sync.run();
  await B.sync.run();
  const b = await B.db.get('profiles', LEO);
  assert.deepEqual([b.age, b.ageAsOf, b.heightCm, b.weightKg, b.homeCountry, b.detailsAt], [7, AT, 133, 22, 'JP', at]);
  await B.db.put('profiles', { ...b, homeCountry: null, detailsAt: later(3) });
  await B.sync.run();
  await A.sync.run();
  assert.equal((await A.db.get('profiles', LEO)).homeCountry, null);
  assert.deepEqual([await A.db.all('outbox'), await B.db.all('outbox')], [[], []]);
});

test('a device that never had the details can\'t clear them by changing a setting; it gets them', async () => {
  const b = await B.db.get('profiles', LEO);
  const { detailsAt, ...rest } = b;
  await B.db.tx(['profiles'], 'readwrite', a => a.putFromServer('profiles', { ...rest, age: null, ageAsOf: null, heightCm: null, weightKg: null, homeCountry: null }));
  await B.db.put('profiles', { ...(await B.db.get('profiles', LEO)), avatar: 6, settingsAt: later() });
  await B.sync.run();
  assert.equal(server.rows.profiles.get(LEO).height_cm, 133);
  assert.equal(server.rows.profiles.get(LEO).avatar, 6);
  assert.equal((await B.db.get('profiles', LEO)).heightCm, 133);
  await A.sync.run();
  const a = await A.db.get('profiles', LEO);
  assert.deepEqual([a.avatar, a.heightCm], [6, 133]);
  assert.equal(detailsAt, a.detailsAt);
});

test('details from before they were synced go up when everything is pulled again', async () => {
  const row = server.rows.profiles.get(LEO);
  for (const k of ['age', 'age_as_of', 'height_cm', 'weight_kg', 'home_country', 'details_at']) row[k] = null;
  const { detailsAt, ...old } = await A.db.get('profiles', LEO); // as an older version left it
  await A.db.tx(['profiles'], 'readwrite', a => a.putFromServer('profiles', old));
  await A.db.remove('meta', 'syncPull');
  await A.sync.run(); // sees the server has none
  assert.equal((await A.db.get('profiles', LEO)).heightCm, 133, 'an empty row clears nothing');
  await A.sync.run();
  assert.equal(server.rows.profiles.get(LEO).height_cm, 133);
  assert.equal(server.rows.profiles.get(LEO).details_at != null, true);
  assert.deepEqual(await A.db.all('outbox'), []);
});

test('settings changed on both devices: the later change wins on both', async () => {
  const a = await A.db.get('profiles', LEO);
  const b = await B.db.get('profiles', LEO);
  await A.db.put('profiles', { ...a, name: 'Leo A', settingsAt: later(2) });
  await B.db.put('profiles', { ...b, name: 'Leo B', avatar: 7, settingsAt: later(3) });
  await A.sync.run(); // A goes first, B's change is newer
  await B.sync.run();
  await A.sync.run();
  for (const d of [A, B]) {
    const p = await d.db.get('profiles', LEO);
    assert.deepEqual([p.name, p.avatar], ['Leo B', 7]);
  }
  assert.equal(server.rows.profiles.get(LEO).name, 'Leo B');
});

test('a pack opened on one device is opened on the other, with its cards and badge', async () => {
  const at = later();
  await B.db.tx(['packs', 'collection', 'badges'], 'readwrite', async a => {
    await a.put('packs', { ...(await a.get('packs', `${MIA}:1:s1-w02`)), openedAt: at });
    for (const c of ['emu', 'koala', 'quoll']) {
      if (!(await a.get('collection', `${MIA}:1:${c}`))) await a.put('collection', card(MIA, 1, c, at, 's1-w02'));
    }
    await a.put('badges', { id: `${MIA}:1:group:marsupials`, profileId: MIA, epoch: 1, badgeId: 'group:marsupials', earnedAt: at, createdAt: at, updatedAt: at, deletedAt: null });
  });
  await B.sync.run();
  A.pulled.length = 0;
  await A.sync.run();
  const p = await A.db.get('packs', `${MIA}:1:s1-w02`);
  assert.equal(p.openedAt, at);
  assert.equal(p.notifiedAt, AT); // when A showed it stays A's
  assert.equal((await A.db.get('collection', `${MIA}:1:quoll`)).collectedAt, at);
  assert.equal((await A.db.get('collection', `${MIA}:1:emu`)).collectedAt, '2026-09-05T10:00:00.000Z'); // the earlier one
  assert.ok(await A.db.get('badges', `${MIA}:1:group:marsupials`));
  assert.deepEqual(A.pulled, [[MIA]]);
});

test('the same pack granted on both devices: everyone keeps the first grant\'s details', async () => {
  await A.db.put('packs', pack(MIA, 1, 2, { grantedAt: '2026-09-19T09:01:00.000Z', cardIds: ['orca'] }));
  await B.db.put('packs', pack(MIA, 1, 2, { grantedAt: '2026-09-19T09:00:00.000Z', cardIds: ['orca', 'seal'] }));
  await A.sync.run(); // A's arrives first
  await B.sync.run();
  for (const d of [A, B]) assert.deepEqual((await d.db.get('packs', `${MIA}:1:s1-w03`)).cardIds, ['orca']);
  assert.deepEqual(await B.db.all('outbox'), []);
});

test('"Start over" on another device: the new timeline comes down, and quiz scores here start over', async () => {
  const mia = await B.db.get('profiles', MIA);
  const startAt = later();
  await B.db.put('profiles', { ...mia, timeline: { epoch: 2, startAt }, updatedAt: startAt });
  await B.sync.run();
  await A.sync.run();
  assert.deepEqual((await A.db.get('profiles', MIA)).timeline, { epoch: 2, startAt });
  const [quiz] = await A.db.all('quiz', MIA);
  assert.ok(quiz.deletedAt);
  assert.equal((await A.db.all('collection', MIA)).filter(c => c.epoch === 1).length, 4); // old epoch: kept
});

test('an explorer deleted on one device is deleted on the other, and stays deleted', async () => {
  const leo = await A.db.get('profiles', LEO);
  const at = later();
  await A.db.put('profiles', { ...leo, deletedAt: at, updatedAt: at });
  await A.sync.run();
  await B.sync.run();
  assert.equal((await B.db.get('profiles', LEO)).deletedAt, at);
  // B's progress for Leo, made offline before it heard, is not taken back up as live.
  await B.db.put('collection', card(LEO, 1, 'emu', later()));
  await B.sync.run();
  assert.equal(server.rows.collection.has(`${LEO}:1:emu`), false);
});

test('an explorer kept on one device only is never pulled into, even if the server has its id', async () => {
  // As if a backup of A was restored on B and Mia left unticked there: B's own copy stays.
  const C = await device();
  await C.db.put('profiles', explorer(MIA, 'Mia (tablet)'));
  await C.sync.setUp([]);
  assert.equal((await C.db.get('profiles', MIA)).name, 'Mia (tablet)');
  assert.deepEqual(await C.db.all('packs'), []);
  assert.equal((await C.db.get('profiles', LEO)), undefined); // deleted before C ever had him
});

test('many rows come down in pages, past rows that share one server time', async () => {
  const at = later();
  await A.db.tx(['collection'], 'readwrite', async a => {
    for (let i = 0; i < 1200; i++) await a.put('collection', card(MIA, 2, `card-${i}`, at));
  });
  await A.sync.run(); // three uploads of 500, 500, 200: three server times
  server.pulls = [];
  await B.sync.run();
  assert.equal((await B.db.all('collection', MIA)).filter(c => c.epoch === 2).length, 1200);
  assert.ok(server.pulls.filter(p => p.table === 'collection').length >= 2);
  assert.deepEqual(await B.db.all('outbox'), []);
});

test('a row this app can\'t use is skipped; the rest still come down', async () => {
  server.upsert('badges', [{ profile_id: MIA, family_id: FAMILY, epoch: 2, badge_id: 'Not Valid!', earned_at: later() },
    { profile_id: MIA, family_id: FAMILY, epoch: 2, badge_id: 'group:birds', earned_at: later() }]);
  const warn = console.warn;
  const warned = [];
  console.warn = m => warned.push(m);
  try { await B.sync.run(); } finally { console.warn = warn; }
  assert.ok(await B.db.get('badges', `${MIA}:2:group:birds`));
  assert.equal(warned.length, 1);
});

test('the server busy while pulling: tried again later, and nothing is skipped', async () => {
  const cursor = await B.db.getMeta('syncPull');
  const mia = await A.db.get('profiles', MIA);
  await A.db.put('profiles', { ...mia, name: 'Mia R', settingsAt: later(5) });
  await A.sync.run();
  server.failPull = 503;
  await B.sync.run();
  assert.equal((await B.sync.status()).problem, 'server');
  assert.deepEqual(await B.db.getMeta('syncPull'), cursor);
  server.failPull = null;
  await B.sync.run();
  assert.equal((await B.db.get('profiles', MIA)).name, 'Mia R');
});

test('whatever order two devices sync in, they end up the same', async () => {
  let seed = 7;
  const rnd = k => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % k; };
  for (let round = 0; round < 40; round++) {
    const d = rnd(2) ? A : B;
    const p = await d.db.get('profiles', MIA);
    const step = rnd(5);
    const t = iso(Date.now() + 10 * 60e3 + rnd(10000) * 1000);
    if (step === 0) await d.db.put('profiles', { ...p, name: `Mia ${round}`, avatar: 1 + rnd(8), settingsAt: t });
    else if (step === 1) await d.db.put('profiles', { ...p, timeline: { epoch: p.timeline.epoch + rnd(2), startAt: t } });
    else if (step === 2) await d.db.put('collection', card(MIA, p.timeline.epoch, `c-${rnd(6)}`, t, rnd(2) ? 's1-w01' : null));
    else if (step === 3) {
      const id = `${MIA}:${p.timeline.epoch}:s1-w0${1 + rnd(3)}`;
      const k = (await d.db.get('packs', id)) ?? pack(MIA, p.timeline.epoch, Number(id.at(-1)) - 1, { grantedAt: t });
      await d.db.put('packs', rnd(2) ? { ...k, openedAt: t } : k);
    } else await (rnd(2) ? A : B).sync.run();
  }
  for (const d of [A, B, A]) await d.sync.run();
  const view = async d => ({
    profile: synced(await d.db.get('profiles', MIA)),
    packs: (await d.db.all('packs', MIA)).map(({ id, seq, cardIds, dueAt, grantedAt, openedAt }) => ({ id, seq, cardIds, dueAt, grantedAt, openedAt })),
    cards: (await d.db.all('collection', MIA)).map(({ id, collectedAt, dropId }) => ({ id, collectedAt, dropId })),
    badges: (await d.db.all('badges', MIA)).map(({ id, earnedAt }) => ({ id, earnedAt })),
  });
  const [a, b] = [await view(A), await view(B)];
  assert.deepEqual(a, b);
  const row = server.rows.profiles.get(MIA);
  assert.equal(row.name, a.profile.name);
  assert.equal(row.timeline_epoch, a.profile.timeline.epoch);
  assert.equal(us(row.client_updated_at), us((await A.db.get('profiles', MIA)).settingsAt));
  for (const d of [A, B]) assert.deepEqual(await d.db.all('outbox'), []);
});

test('join (Welcome screen): a device with no explorers gets the family\'s straight away', async () => {
  const D = await device();
  assert.equal(await D.sync.stage(), 'choose');
  assert.equal(await D.sync.join(), 'on');
  assert.deepEqual((await D.db.all('profiles')).filter(p => !p.deletedAt).map(p => p.name), [(await A.db.get('profiles', MIA)).name]);
  assert.ok((await D.db.all('collection', MIA)).length > 0);
  assert.deepEqual((await D.db.getMeta('sync')).localOnly, []);
  assert.equal(await D.sync.join(), 'on'); // again: just another pull
});

test('join: a family with no explorers yet leaves the device empty, and set up', async () => {
  const empty = createServer();
  const E = await device({ ...auth, authFetch: empty.authFetch });
  assert.equal(await E.sync.join(), 'on');
  assert.deepEqual(await E.db.all('profiles'), []);
  assert.equal(await E.sync.stage(), 'on');
});

test('join: offline, it fails and nothing is set up; another account isn\'t joined', async () => {
  const F = await device();
  server.offline = true;
  try { await assert.rejects(F.sync.join(), { code: 'offline' }); } finally { server.offline = false; }
  assert.equal(await F.sync.stage(), 'choose');
  const G = await device();
  await G.db.setMeta('sync', { userId: 'user-2', email: 'other@example.test', familyId: FAMILY, localOnly: [] });
  assert.equal(await G.sync.join(), 'other-account');
  assert.deepEqual(await G.db.all('profiles'), []);
});

test('run asked while a run is going: another run follows it', async () => {
  const mia = await A.db.get('profiles', MIA);
  await A.db.put('profiles', { ...mia, avatar: 8, settingsAt: later(30) });
  let second;
  server.during = async () => {
    // A change lands after this run read its outbox, and someone asks for a run.
    await A.db.put('profiles', { ...mia, avatar: 1, settingsAt: later(31) });
    second = A.sync.run();
  };
  await A.sync.run();
  await second;
  assert.equal(server.rows.profiles.get(MIA).avatar, 1);
  assert.deepEqual(await A.db.all('outbox'), []);
});

test('a window focused (side by side) or shown again pulls, once for both', async () => {
  const win = new EventTarget();
  win.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  const W = await device(auth, win);
  await W.sync.join();
  const ran = () => new Promise(resolve => W.sync.onChange(resolve)); // after each run
  W.sync.start();
  await ran();
  const mia = await A.db.get('profiles', MIA);
  await A.db.put('profiles', { ...mia, name: 'Mia F', settingsAt: iso(Date.now() + 864e5) });
  await A.sync.run();
  const pulls = () => server.pulls.length;
  const before = pulls();
  const done = ran();
  win.dispatchEvent(new Event('focus'));
  await done;
  assert.equal((await W.db.get('profiles', MIA)).name, 'Mia F');
  assert.ok(pulls() > before);
  const after = pulls();
  win.document.dispatchEvent(new Event('visibilitychange')); // the same switch: no second run
  await new Promise(r => setTimeout(r, 50));
  assert.equal(pulls(), after);
});

// ---------- A grown-up's device (watch mode) ----------

// A device's own auth: it counts its uploads and can sign out.
const ownAuth = () => {
  const me = { posts: 0, signedOut: false };
  me.auth = {
    ...auth,
    signOut: async () => { me.signedOut = true; },
    authFetch: (path, init = {}) => { if (init.method === 'POST') me.posts++; return server.authFetch(path, init); },
  };
  return me;
};

test("a grown-up's device joins: progress comes down, it can't make any, and its settings go up", async () => {
  const me = ownAuth();
  const P = await device(me.auth);
  assert.equal(await P.sync.join({ role: 'watch' }), 'on');
  assert.equal(await P.db.getRole(), 'watch');
  assert.ok((await P.db.all('packs', MIA)).length > 0);
  assert.ok((await P.db.all('collection', MIA)).length > 0);
  const epoch = (await P.db.get('profiles', MIA)).timeline.epoch;
  await assert.rejects(P.db.put('collection', card(MIA, epoch, 'tiger', later())), P.db.WatchOnly);
  await assert.rejects(P.db.put('badges', { id: `${MIA}:${epoch}:group:cats`, profileId: MIA, epoch, badgeId: 'group:cats', earnedAt: later() }), P.db.WatchOnly);
  me.posts = 0;
  const mia = await P.db.get('profiles', MIA);
  await P.db.put('profiles', { ...mia, avatar: 3, settingsAt: iso(Date.now() + 2 * 864e5) });
  await P.sync.run();
  assert.equal(server.rows.profiles.get(MIA).avatar, 3);
  assert.equal(me.posts, 1); // the profile, nothing else
  assert.deepEqual(await P.db.all('outbox'), []);
});

test('a phone whose own copy is somehow ahead of the server still pulls, and sends no progress', async () => {
  const me = ownAuth();
  const P = await device(me.auth);
  await P.sync.join({ role: 'watch' });
  const [k] = await P.db.all('packs', MIA);
  // An older grant's details with an earlier opening than the server's: merging keeps both.
  await P.db.tx(['packs'], 'readwrite', a => a.putFromServer('packs', { ...k, cardIds: ['x'], openedAt: '2026-01-01T00:00:00.000Z' }));
  await P.db.remove('meta', 'syncPull'); // pull everything again
  me.posts = 0;
  await P.sync.run();
  assert.equal((await P.sync.status()).problem, null);
  assert.notDeepEqual((await P.db.get('packs', k.id)).cardIds, ['x']);
  assert.deepEqual(await P.db.all('outbox'), []);
  assert.equal(me.posts, 0);
});

test('first sign-in as a phone with explorers of its own: all of them go up, or none and nothing is set up', async () => {
  const Q = await device();
  const OWN = '66666666-6666-4666-8666-666666666666';
  await Q.db.put('profiles', explorer(OWN, 'Pip'));
  await assert.rejects(Q.sync.setUp([], { role: 'watch' }));
  assert.equal(await Q.sync.stage(), 'choose');
  assert.equal(await Q.db.getRole(), 'explorers');
  await Q.sync.setUp([OWN], { role: 'watch' });
  assert.equal(await Q.db.getRole(), 'watch');
  assert.ok(server.rows.profiles.has(OWN));
  assert.deepEqual((await Q.db.getMeta('sync')).localOnly, []);
});

test('becoming a phone: refused while an explorer is on this device only or something is held back; otherwise only the role changes', async () => {
  const me = ownAuth();
  const R = await device(me.auth);
  const KEPT = '77777777-7777-4777-8777-777777777777';
  await R.db.put('profiles', explorer(KEPT, 'Kit'));
  await R.sync.setUp([]); // Kit stays on this device only
  assert.equal(await R.sync.setRole('watch'), 'local-only');
  await R.sync.addToFamily(KEPT);
  server.refuse = (table, r) => table === 'collection' && r.card_id === 'stuck';
  try {
    await R.db.put('collection', card(KEPT, 1, 'stuck', later()));
    assert.equal(await R.sync.setRole('watch'), 'held');
  } finally { server.refuse = () => false; }
  await R.db.put('collection', card(KEPT, 1, 'stuck', later(1))); // changed: goes up now
  server.offline = true;
  try { assert.equal(await R.sync.setRole('watch'), 'offline'); } finally { server.offline = false; }
  assert.equal(await R.db.getRole(), 'explorers');
  assert.equal(await R.sync.setRole('watch'), null);
  assert.equal(await R.db.getRole(), 'watch');
  assert.ok(server.rows.collection.has(`${KEPT}:1:stuck`)); // saved before the switch
  me.posts = 0;
  await R.sync.run();
  assert.equal(me.posts, 0); // the switch itself sends nothing
  assert.deepEqual(await R.db.all('outbox'), []);
  assert.equal(await R.sync.setRole('explorers'), null); // back: always allowed
  assert.equal(await R.db.getRole(), 'explorers');
});

test('"Sign out and remove the family": only the family\'s explorers go, with everything of theirs; nothing is sent', async () => {
  const me = ownAuth();
  const S = await device(me.auth);
  const KEPT = '88888888-8888-4888-8888-888888888888';
  await S.db.put('profiles', explorer(KEPT, 'Kept'));
  await S.db.put('quiz', { id: `${KEPT}:pictures`, profileId: KEPT, kind: 'pictures', best: 4 });
  await S.sync.setUp([]); // Kept stays here only
  await S.sync.join();
  await S.db.put('quiz', { id: `${MIA}:pictures`, profileId: MIA, kind: 'pictures', best: 7 });
  await S.db.put('notes', { id: `${MIA}:page-1`, profileId: MIA, pageId: 'page-1', cardIds: [] });
  await S.db.setMeta('activeProfile', MIA);
  const before = new Map(server.rows.profiles);
  // Something held back: refused, nothing removed.
  server.refuse = (table, r) => table === 'profiles' && r.id === MIA;
  try {
    const mia = await S.db.get('profiles', MIA);
    await S.db.put('profiles', { ...mia, name: 'Held', settingsAt: iso(Date.now() + 3 * 864e5) });
    assert.equal(await S.sync.removeFamily(), 'held');
    assert.ok(await S.db.get('profiles', MIA));
  } finally { server.refuse = () => false; }
  const mia = await S.db.get('profiles', MIA);
  await S.db.put('profiles', { ...mia, name: (before.get(MIA)).name, settingsAt: mia.settingsAt }); // changed back: goes up
  const files = [];
  me.posts = 0;
  assert.equal(await S.sync.removeFamily(async ids => files.push(...ids)), null);
  const postsDuringRemove = me.posts;
  assert.deepEqual((await S.db.all('profiles')).map(p => p.id), [KEPT]);
  assert.deepEqual((await S.db.all('quiz')).map(q => q.profileId), [KEPT]);
  for (const store of ['packs', 'collection', 'badges', 'notes', 'outbox']) assert.deepEqual(await S.db.all(store), [], store);
  for (const key of ['sync', 'syncPull', 'device', 'activeProfile']) assert.equal(await S.db.getMeta(key, null), null, key);
  assert.ok(files.includes(MIA));
  assert.equal(me.signedOut, true);
  assert.ok(postsDuringRemove <= 1); // at most the profile changed back, before removing
  assert.ok(server.rows.profiles.has(MIA) && !server.rows.profiles.get(MIA).deleted_at); // the family keeps everything
  assert.ok(server.rows.packs.size > 0);
});

// ---------- No longer in the family (removed by the owner, or left) ----------

test('a grown-up no longer in the family: nothing goes up or comes down, back in the family it carries on, and removing the family drops what waited', async () => {
  const OTHER = '22222222-2222-4222-8222-222222222222'; // the new family of their own
  const me = ownAuth();
  const D = await device(me.auth);
  assert.equal(await D.sync.join({ role: 'explorers' }), 'on');
  const mia = await D.db.get('profiles', MIA);
  await D.db.put('profiles', { ...mia, avatar: 6, settingsAt: iso(Date.now() + 4 * 864e5) });

  server.familyOf = () => OTHER;
  try {
    me.posts = 0;
    const pulls = server.pulls.length;
    await D.sync.run();
    assert.equal(await D.sync.stage(), 'removed');
    assert.equal(statusKey(await D.sync.status()), 'sync.removed');
    assert.equal(me.posts, 0);
    assert.equal(server.pulls.length, pulls);
    assert.equal((await D.db.all('outbox')).length, 1); // still waiting
    assert.equal(await D.sync.setRole('watch'), 'not-set-up');
  } finally { server.familyOf = () => FAMILY; }

  await D.sync.run(); // back in the family (invited again)
  assert.equal(await D.sync.stage(), 'on');
  assert.equal((await D.db.getMeta('sync')).leftAt, undefined);
  assert.equal(server.rows.profiles.get(MIA).avatar, 6);
  assert.deepEqual(await D.db.all('outbox'), []);

  // Removed again, with a change waiting: the device notices on removing, and drops it.
  await D.db.put('profiles', { ...(await D.db.get('profiles', MIA)), avatar: 7, settingsAt: iso(Date.now() + 5 * 864e5) });
  server.familyOf = () => OTHER;
  try {
    me.posts = 0;
    assert.equal(await D.sync.removeFamily(), null);
    assert.equal(me.posts, 0);
    assert.deepEqual(await D.db.all('profiles'), []);
    assert.deepEqual(await D.db.all('outbox'), []);
    assert.equal(await D.db.getMeta('sync', null), null);
    assert.equal(me.signedOut, true);
    assert.equal(server.rows.profiles.get(MIA).avatar, 6); // the family keeps what it had
  } finally { server.familyOf = () => FAMILY; }
});
