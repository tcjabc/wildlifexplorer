// js/cloud/merge.js: rows pulled from the family account merged into local records, with
// the rules of the server's merge triggers, and device-only fields left alone.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProfile, mergePack, mergeCard, mergeBadge, Invalid } from '../js/cloud/merge.js';
import { toRow } from '../js/cloud/sync.js';

const FAMILY = '11111111-1111-4111-8111-111111111111';
const PID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-11-04T12:00:00.000Z';
// The server sends times as '…+00:00', with its own columns added.
const served = row => ({
  ...Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === 'string' && /T\d\d:.*Z$/.test(v) ? v.replace('Z', '+00:00') : v])),
  updated_at: '2026-11-04T11:00:00.123456+00:00',
});

const profile = (over = {}) => ({
  id: PID, name: 'Ada', lang: 'both', age: 7, ageAsOf: '2026-01-01T00:00:00.000Z', heightCm: 120, weightKg: 22, homeCountry: 'TW',
  avatar: 3, zhuyin: true, rate: 'normal', notesInput: 'pen', notesPenSeen: true,
  parent: { dropDay: 6, dropTime: '09:00', length: 'metric', temp: 'C', preview: true },
  timeline: { epoch: 1, startAt: '2026-09-01T09:00:00.000Z' }, settingsAt: '2026-10-01T00:00:00.000Z',
  detailsAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-09-01T09:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', deletedAt: null, ...over,
});
const profileRow = (over = {}) => served({ ...toRow('profiles', profile(), FAMILY), ...over });

test('a new explorer from the server: its synced fields, and device-only ones empty', () => {
  const { record, ahead } = mergeProfile(undefined, profileRow(), NOW);
  assert.equal(ahead, false);
  assert.deepEqual(record, {
    id: PID, name: 'Ada', lang: 'both', avatar: 3, zhuyin: true, rate: 'normal',
    age: 7, ageAsOf: '2026-01-01T00:00:00.000Z', heightCm: 120, weightKg: 22, homeCountry: 'TW', detailsAt: '2026-10-01T00:00:00.000Z',
    parent: { dropDay: 6, dropTime: '09:00', length: 'metric', temp: 'C', preview: false },
    timeline: { epoch: 1, startAt: '2026-09-01T09:00:00.000Z' }, settingsAt: '2026-10-01T00:00:00.000Z',
    createdAt: '2026-09-01T09:00:00.000Z', deletedAt: null, updatedAt: NOW,
  });
  // And it goes back up as the same row.
  assert.deepEqual(served(toRow('profiles', record, FAMILY)), profileRow());
});

test('an explorer deleted before this device ever had it is not kept', () => {
  assert.equal(mergeProfile(undefined, profileRow({ deleted_at: '2026-10-02T00:00:00+00:00' }), NOW), null);
});

test('what the server has already: nothing changes', () => {
  assert.equal(mergeProfile(profile(), profileRow(), NOW), null);
});

test('newer settings from the server win, all of them, and device-only fields stay', () => {
  const row = profileRow({ name: 'Ada L', lang: 'zh', avatar: 5, zhuyin: false, rate: 'slow', length_unit: 'imperial', temp_unit: 'F',
    drop_day: 2, drop_time: '17:30', client_updated_at: '2026-10-05T00:00:00+00:00' });
  const { record, ahead } = mergeProfile(profile(), row, NOW);
  assert.equal(ahead, false);
  assert.deepEqual(record, profile({
    name: 'Ada L', lang: 'zh', avatar: 5, zhuyin: false, rate: 'slow',
    parent: { dropDay: 2, dropTime: '17:30', length: 'imperial', temp: 'F', preview: true },
    settingsAt: '2026-10-05T00:00:00.000Z', updatedAt: NOW,
  }));
});

test('Welcome details: newer ones win, all of them, and settings don\'t decide it', () => {
  const row = profileRow({ age: 8, age_as_of: '2026-10-04T00:00:00+00:00', height_cm: 125.5, weight_kg: null, home_country: 'JP', details_at: '2026-10-05T00:00:00+00:00', client_updated_at: '2026-09-15T00:00:00+00:00' });
  const { record, ahead } = mergeProfile(profile(), row, NOW);
  assert.equal(ahead, true, 'this device\'s settings are newer');
  assert.deepEqual(record, profile({ age: 8, ageAsOf: '2026-10-04T00:00:00.000Z', heightCm: 125.5, weightKg: null, homeCountry: 'JP', detailsAt: '2026-10-05T00:00:00.000Z', updatedAt: NOW }));
});

test('Welcome details: older ones lose and this device\'s go up; on a tie the server\'s win', () => {
  assert.equal(mergeProfile(profile(), profileRow({ home_country: 'JP', details_at: '2026-09-15T00:00:00+00:00' }), NOW), null, 'unchanged here; its outbox entry sends it');
  const { record } = mergeProfile(profile(), profileRow({ home_country: 'JP' }), NOW);
  assert.equal(record.homeCountry, 'JP');
});

test('Welcome details: an empty row clears nothing, and a record from before they synced goes up', () => {
  const empty = { age: null, age_as_of: null, height_cm: null, weight_kg: null, home_country: null, details_at: null };
  const { detailsAt, ...old } = profile();
  const { record, ahead } = mergeProfile(old, profileRow(empty), NOW);
  assert.equal(ahead, true);
  assert.deepEqual(record, profile({ detailsAt: old.updatedAt, updatedAt: NOW }));
  // A device that has none takes them; with none on either side nothing changes.
  const none = { age: null, ageAsOf: null, heightCm: null, weightKg: null, homeCountry: null, detailsAt: null };
  assert.equal(mergeProfile(profile(none), profileRow({ ...empty }), NOW), null);
  assert.equal(mergeProfile(profile(none), profileRow(), NOW).record.homeCountry, 'TW');
});

test('a row with Welcome details this app can\'t use is refused', () => {
  for (const bad of [{ age: 200 }, { age: 7.5 }, { height_cm: 10 }, { weight_kg: 900 }, { home_country: 'japan' }, { details_at: 'soon' }, { age_as_of: 'then' }]) {
    assert.throws(() => mergeProfile(undefined, profileRow(bad), NOW), Invalid, JSON.stringify(bad));
  }
});

test('older settings from the server lose; on a tie the server\'s win', () => {
  const older = profileRow({ name: 'Old', client_updated_at: '2026-09-15T00:00:00+00:00' });
  assert.equal(mergeProfile(profile(), older, NOW), null);
  const tie = mergeProfile(profile(), profileRow({ name: 'Same time' }), NOW);
  assert.equal(tie.record.name, 'Same time');
  assert.equal(tie.ahead, false);
});

test('timeline: a higher epoch wins; on the same epoch the server\'s start; a higher local epoch stays', () => {
  const up = mergeProfile(profile(), profileRow({ timeline_epoch: 2, timeline_start_at: '2026-10-10T08:00:00+00:00' }), NOW);
  assert.deepEqual(up.record.timeline, { epoch: 2, startAt: '2026-10-10T08:00:00.000Z' });
  const sameEpoch = mergeProfile(profile(), profileRow({ timeline_start_at: '2026-09-02T09:00:00+00:00' }), NOW);
  assert.deepEqual(sameEpoch.record.timeline, { epoch: 1, startAt: '2026-09-02T09:00:00.000Z' });
  const local = profile({ timeline: { epoch: 3, startAt: '2026-10-20T00:00:00.000Z' } });
  assert.equal(mergeProfile(local, profileRow({ timeline_epoch: 2 }), NOW), null);
  // Newer settings still come in; the record is ahead (its epoch goes up next push).
  const mixed = mergeProfile(local, profileRow({ timeline_epoch: 2, name: 'New', client_updated_at: '2026-10-21T00:00:00+00:00' }), NOW);
  assert.equal(mixed.record.name, 'New');
  assert.equal(mixed.record.timeline.epoch, 3);
  assert.equal(mixed.ahead, true);
});

test('a deletion sticks either way, at the earliest time', () => {
  const del = mergeProfile(profile(), profileRow({ deleted_at: '2026-10-02T00:00:00+00:00' }), NOW);
  assert.equal(del.record.deletedAt, '2026-10-02T00:00:00.000Z');
  assert.equal(del.ahead, false);
  assert.equal(mergeProfile(profile({ deletedAt: '2026-10-03T00:00:00.000Z' }), profileRow(), NOW), null);
  const earlier = mergeProfile(profile({ deletedAt: '2026-10-03T00:00:00.000Z' }), profileRow({ deleted_at: '2026-10-02T00:00:00+00:00' }), NOW);
  assert.equal(earlier.record.deletedAt, '2026-10-02T00:00:00.000Z');
});

test('a row this app can\'t use is refused', () => {
  assert.throws(() => mergeProfile(undefined, profileRow({ lang: 'ja' }), NOW), Invalid);
  assert.throws(() => mergePack(undefined, served({ profile_id: PID, epoch: 0, drop_id: 's1-w01' }), NOW), Invalid);
});

const pack = (over = {}) => ({
  id: `${PID}:1:s1-w02`, profileId: PID, epoch: 1, seq: 1, dropId: 's1-w02', cardIds: ['emu', 'koala', 'wombat'],
  dueAt: '2026-09-12T09:00:00.000Z', grantedAt: '2026-09-12T09:05:00.000Z', notifiedAt: '2026-09-12T09:05:00.000Z', openedAt: null,
  createdAt: '2026-09-12T09:05:00.000Z', updatedAt: '2026-09-12T09:05:00.000Z', deletedAt: null, ...over,
});
const packRow = (over = {}) => served({ ...toRow('packs', pack(), FAMILY), ...over });

test('a pack from the server: unopened, it is shown as arrived once here; opened, it isn\'t', () => {
  const fresh = mergePack(undefined, packRow(), NOW).record;
  assert.deepEqual(fresh, { ...pack({ notifiedAt: null, createdAt: NOW, updatedAt: NOW }) });
  const opened = mergePack(undefined, packRow({ opened_at: '2026-09-13T10:00:00+00:00' }), NOW).record;
  assert.equal(opened.openedAt, '2026-09-13T10:00:00.000Z');
  assert.equal(opened.notifiedAt, '2026-09-13T10:00:00.000Z');
});

test('packs: the server\'s grant details, the earliest opening, and when it was shown here stays', () => {
  const local = pack({ notifiedAt: null, cardIds: ['emu', 'koala', 'quoll'], grantedAt: '2026-09-12T10:00:00.000Z' });
  const { record, ahead } = mergePack(local, packRow({ opened_at: '2026-09-13T10:00:00+00:00' }), NOW);
  assert.deepEqual(record.cardIds, ['emu', 'koala', 'wombat']);
  assert.equal(record.grantedAt, '2026-09-12T09:05:00.000Z');
  assert.equal(record.openedAt, '2026-09-13T10:00:00.000Z');
  assert.equal(record.notifiedAt, '2026-09-13T10:00:00.000Z');
  assert.equal(ahead, false);
  // Opened here first (or only here): stays opened, goes up again.
  assert.equal(mergePack(pack({ openedAt: '2026-09-13T08:00:00.000Z' }), packRow({ opened_at: '2026-09-13T10:00:00+00:00' }), NOW), null);
  assert.equal(mergePack(pack({ openedAt: '2026-09-13T08:00:00.000Z' }), packRow(), NOW), null);
  const kept = mergePack(pack({ openedAt: '2026-09-13T08:00:00.000Z', cardIds: ['x'] }), packRow(), NOW);
  assert.equal(kept.record.openedAt, '2026-09-13T08:00:00.000Z');
  assert.equal(kept.ahead, true);
});

const card = (over = {}) => ({
  id: `${PID}:1:emu`, profileId: PID, epoch: 1, cardId: 'emu', collectedAt: '2026-09-13T10:00:00.000Z',
  packId: `${PID}:1:s1-w02`, dropId: 's1-w02', createdAt: '2026-09-13T10:00:00.000Z', updatedAt: '2026-09-13T10:00:00.000Z', deletedAt: null, ...over,
});
const cardRow = (over = {}) => served({ ...toRow('collection', card(), FAMILY), ...over });

test('cards: the earliest collection wins, with the pack it came in', () => {
  assert.deepEqual(mergeCard(undefined, cardRow(), NOW).record, card({ createdAt: NOW, updatedAt: NOW }));
  const later = card({ collectedAt: '2026-09-20T10:00:00.000Z', dropId: 's1-w03', packId: `${PID}:1:s1-w03` });
  assert.deepEqual(mergeCard(later, cardRow(), NOW).record, card({ createdAt: later.createdAt, updatedAt: NOW }));
  assert.equal(mergeCard(card(), cardRow({ collected_at: '2026-09-20T10:00:00+00:00', drop_id: 's1-w03' }), NOW), null);
  assert.equal(mergeCard(card(), cardRow(), NOW), null);
  // From before packs: no pack, and the local record's own packId stays.
  const old = card({ dropId: null, packId: null });
  assert.equal(mergeCard(old, cardRow({ drop_id: null }), NOW), null);
});

test('progress this device marked deleted (version 3) gives way to the server\'s', () => {
  const { record } = mergeCard(card({ deletedAt: '2026-09-30T00:00:00.000Z', createdAt: '2026-09-01T00:00:00.000Z' }), cardRow(), NOW);
  assert.equal(record.deletedAt, null);
  assert.equal(record.createdAt, '2026-09-01T00:00:00.000Z');
});

test('badges: the earliest time it was earned', () => {
  const badge = { id: `${PID}:1:group:birds`, profileId: PID, epoch: 1, badgeId: 'group:birds', earnedAt: '2026-10-01T10:00:00.000Z',
    createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', deletedAt: null };
  const row = served(toRow('badges', badge, FAMILY));
  assert.deepEqual(mergeBadge(undefined, row, NOW).record, { ...badge, createdAt: NOW, updatedAt: NOW });
  assert.equal(mergeBadge(badge, row, NOW), null);
  assert.equal(mergeBadge(badge, { ...row, earned_at: '2026-10-02T00:00:00+00:00' }, NOW), null);
  assert.equal(mergeBadge({ ...badge, earnedAt: '2026-10-05T00:00:00.000Z' }, row, NOW).record.earnedAt, '2026-10-01T10:00:00.000Z');
});
