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
