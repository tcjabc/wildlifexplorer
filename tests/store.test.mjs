// js/store.js on an upgraded database: explorers see what they saw before, and "Start over"
// starts a new epoch without touching the old one's packs, cards and badges.
// Run: npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import 'fake-indexeddb/auto';
import { records, buildV3, readAll, visibleV3, ADA, BEN } from './fixtures/v3.mjs';

// The app's data files, read from the repo.
globalThis.fetch = async url => ({ json: async () => JSON.parse(readFileSync(new URL(`../${url}`, import.meta.url), 'utf8')) });

let store;
before(async () => {
  await buildV3();
  store = await import('../js/store.js');
  await store.init();
});

const shown = () => ({
  cards: Object.keys(store.state.collected).sort(),
  badges: Object.keys(store.state.badges).sort(),
  packs: store.state.packs.map(p => [p.id, Boolean(p.openedAt)]).sort(),
});

test('after the upgrade every explorer sees exactly what version 3 showed', async () => {
  assert.deepEqual(store.state.profiles.map(p => p.name), ['Ada', 'Ben', 'Dan']);
  const before3 = visibleV3(records);
  for (const p of store.state.profiles) {
    await store.selectProfile(p.id);
    assert.deepEqual(shown(), before3[p.name], p.name);
  }
  await store.selectProfile(BEN);
  assert.deepEqual(store.state.quiz.best, { sizes: 6 });
});

test('"Start over" begins a new epoch and leaves the old records alone', async () => {
  await store.selectProfile(ADA);
  const old = await readAll();
  await store.resetProfile(ADA);
  assert.equal(store.state.profile.timeline.epoch, 4);
  assert.deepEqual(store.state.collected, {});
  assert.deepEqual(store.state.badges, {});
  const now = await readAll();
  assert.deepEqual(now.collection, old.collection);
  assert.deepEqual(now.badges, old.badges);
  assert.deepEqual(now.packs.filter(r => r.epoch < 4), old.packs);
});

test('a pack in the new epoch collects cards under new keys', async () => {
  await store.updateProfile(ADA, { parent: { preview: true } }); // packs arrive without waiting for facts
  await store.grantDue();
  const [pack] = store.unopenedPacks();
  assert.equal(pack.id, `${ADA}:4:${store.state.drops[0].id}`);
  await store.openPack(pack.id);
  const s = await readAll();
  for (const cardId of pack.cardIds) {
    const r = s.collection.find(x => x.id === `${ADA}:4:${cardId}`);
    assert.equal(r.epoch, 4);
    assert.equal(r.dropId, pack.dropId);
    assert.equal(r.packId, pack.id);
  }
  // Epoch 3's cards are still there, as they were.
  assert.ok(s.collection.find(x => x.id === `${ADA}:3:red-fox` && !x.deletedAt));
  assert.equal(Object.keys(store.state.collected).length, new Set(pack.cardIds).size);
  // Badges earned now are in epoch 4 too.
  assert.equal(s.badges.filter(b => b.profileId === ADA && b.epoch === 4).length, Object.keys(store.state.badges).length);
});

test('settingsAt changes with a setting the family account keeps, not with height or preview', async () => {
  const ben = () => store.state.profiles.find(p => p.id === BEN);
  const first = ben().settingsAt; // the fixture is from before settingsAt
  await store.updateProfile(BEN, { heightCm: 131 });
  await store.updateProfile(BEN, { parent: { preview: true } });
  assert.equal(ben().settingsAt, first);
  await store.updateProfile(BEN, { name: 'Benny' });
  const named = ben().settingsAt;
  assert.equal(named, ben().updatedAt);
  await new Promise(r => setTimeout(r, 5));
  await store.updateProfile(BEN, { parent: { dropDay: 3 } });
  assert.ok(ben().settingsAt > named);
  // Each of those writes queued the profile for the family account.
  assert.ok((await readAll()).outbox.some(e => e.id === `profiles:${BEN}`));
});

test('an edit right after a pull starts from the pulled record, not the copy in state', async () => {
  const db = await import('../js/db.js');
  const pulled = { ...(await db.get('profiles', BEN)), name: 'Ben (from the tablet)', settingsAt: new Date(Date.now() + 60e3).toISOString() };
  await db.tx(['profiles'], 'readwrite', a => a.putFromServer('profiles', pulled));
  await store.updateProfile(BEN, { heightCm: 140 }); // before the app heard about the pull
  const saved = await db.get('profiles', BEN);
  assert.equal(saved.name, 'Ben (from the tablet)');
  assert.equal(saved.settingsAt, pulled.settingsAt);
  assert.equal(saved.heightCm, 140);
});

test('applyPulled: the active explorer\'s progress is read again; deleted elsewhere, there is none', async () => {
  const db = await import('../js/db.js');
  await store.selectProfile(ADA);
  const events = [];
  for (const type of ['profiles', 'profile', 'packs', 'badges']) store.onChange(type, () => events.push(type));
  const at = new Date().toISOString();
  await db.tx(['collection'], 'readwrite', a => a.putFromServer('collection',
    { id: `${ADA}:4:orca`, profileId: ADA, epoch: 4, cardId: 'orca', collectedAt: at, packId: null, dropId: null, createdAt: at, updatedAt: at, deletedAt: null }));
  await store.applyPulled([BEN]); // someone else: just the list
  assert.deepEqual(events, ['profiles']);
  assert.equal(store.state.collected.orca, undefined);
  await store.applyPulled([ADA]);
  assert.equal(store.state.collected.orca, at);
  assert.deepEqual(events.slice(1, 5), ['profiles', 'profile', 'packs', 'badges']);
  const ada = await db.get('profiles', ADA);
  await db.tx(['profiles'], 'readwrite', a => a.putFromServer('profiles', { ...ada, deletedAt: at }));
  await store.applyPulled([ADA]);
  assert.equal(store.state.profile, null);
  assert.equal(store.state.profiles.some(p => p.id === ADA), false);
  assert.equal(events.at(-1), 'profiles');
});

test("watch mode (a grown-up's device): no packs granted or opened, no badges; settings and new explorers still work", async () => {
  const db = await import('../js/db.js');
  const { restoreProgress } = await import('../js/backup.js');
  await db.setMeta('device', { role: 'watch' });
  await store.loadRole();
  assert.equal(store.watching(), true);
  try {
    await store.selectProfile(BEN);
    const ben = store.state.profile;
    await store.updateProfile(BEN, { parent: { preview: true } }); // would grant every ready drop
    assert.deepEqual(await store.grantDue(), []);
    // A pack pulled from the explorers' device: it can't be opened here, or announced.
    const epoch = ben.timeline.epoch;
    const drop = store.state.drops[0];
    const at = new Date().toISOString();
    const id = `${BEN}:${epoch}:${drop.id}`;
    const pulled = { id, profileId: BEN, epoch, seq: 0, dropId: drop.id, cardIds: drop.cards.map(c => c.id), dueAt: at, grantedAt: at,
      notifiedAt: null, openedAt: null, createdAt: at, updatedAt: at, deletedAt: null };
    await db.tx(['packs'], 'readwrite', a => a.putFromServer('packs', pulled));
    await store.applyPulled([BEN]);
    assert.equal(store.unopenedPacks()[0]?.id, id);
    assert.equal(await store.openPack(id), null);
    await store.markNotified([pulled]);
    assert.deepEqual(await db.get('packs', id), pulled);
    assert.deepEqual(await store.awardBadges(), []);
    // Settings and a new explorer: yes.
    await store.updateProfile(BEN, { name: 'Ben W' });
    assert.equal((await db.get('profiles', BEN)).name, 'Ben W');
    const kid = await store.createProfile({ name: 'Zoe', lang: 'en' });
    assert.ok(await db.get('profiles', kid.id));
    // Start over, Delete and Restore: only on the explorers' device.
    await assert.rejects(store.resetProfile(BEN), db.WatchOnly);
    await assert.rejects(store.deleteProfile(BEN), db.WatchOnly);
    await assert.rejects(restoreProgress('{}'), db.WatchOnly);
    assert.equal((await db.get('profiles', BEN)).deletedAt, null);
    // Nothing of the progress kind waits to go up.
    assert.equal((await db.all('outbox')).some(e => db.PROGRESS.includes(e.store) && e.key === id), false);
  } finally {
    await db.setMeta('device', { role: 'explorers' });
    await store.loadRole();
  }
  assert.equal(store.watching(), false);
});
