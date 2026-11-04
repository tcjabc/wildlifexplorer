import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrateCard, factFileTodo, statsTodo, todosOf, termsOf, KEY_ORDER } from '../scripts/lib/card-schema.mjs';

const pair = (en, zh) => ({ en, zh });
const blank = pair('', '');
const old = () => ({
  id: 'bear', group: 'mammals', scientificName: 'Ursus thibetanus', name: pair('Bear', '熊'),
  facts: [pair('a', '甲')],
  habitat: pair('Mountain forests.', '山區森林。'),
  status: 'VU',
  profile: { image: 'illustration', callouts: [{ x: 0.2, y: 0.3, en: 'Ears', zh: '耳朵' }] },
  stats: { lengthCm: { min: 120, max: 180 }, gestation: pair('7–8 months', '7到8個月'), gestationDays: { min: 200, max: 240 } },
  lifeCycle: [pair('Bears mate in summer.', '熊在夏天交配。'), pair('Cubs are born in winter.', '冬天生小熊。')],
  _draft: ['facts', 'habitat', 'lifeCycle'],
});

test('habitat and life cycle move into the Fact File word for word; the rest are empty slots', () => {
  const c = migrateCard(old());
  assert.equal('habitat' in c, false);
  assert.equal('lifeCycle' in c, false);
  assert.deepEqual(c.factFile.habitat, [pair('Mountain forests.', '山區森林。')]);
  assert.deepEqual(c.factFile.breeding, old().lifeCycle);
  for (const k of ['behaviour', 'foodAndHunting', 'conservation']) assert.deepEqual(c.factFile[k], [blank]);
  assert.deepEqual(c.factFile.didYouKnow, [blank]);
  assert.deepEqual(c._draft, ['facts', 'factFile.habitat', 'factFile.breeding']);
  assert.deepEqual(c.related, []);
  assert.deepEqual(c.profile.callouts[0].detail, blank);
  assert.deepEqual(Object.keys(c), KEY_ORDER.filter(k => k in c));
});

test('gestation becomes the generic development row', () => {
  const c = migrateCard(old());
  assert.deepEqual(c.stats.development, { kind: 'gestation', days: { min: 200, max: 240 }, en: '7–8 months', zh: '7到8個月' });
  assert.equal('gestation' in c.stats, false);
  assert.equal('gestationDays' in c.stats, false);
  assert.deepEqual(c.stats.lengthCm, { min: 120, max: 180 });
});

test('running it again changes nothing, and the input is left alone', () => {
  const input = old();
  const once = migrateCard(input);
  assert.deepEqual(migrateCard(once), once);
  assert.deepEqual(input, old());
});

test('text already in the Fact File wins over the old fields; extra keys you added are kept', () => {
  const c = migrateCard({ ...old(), factFile: { habitat: [pair('New text.', '新的。')], mine: 1 } });
  assert.deepEqual(c.factFile.habitat, [pair('New text.', '新的。')]);
  assert.deepEqual(c.factFile.breeding, old().lifeCycle);
  assert.equal(c.factFile.mine, 1);
});

test('topic cards get no Fact File or related list unless there is something to keep', () => {
  const topic = migrateCard({ id: 'migration', group: 'behavior', scientificName: null, name: pair('Migration', '遷徙'), facts: [], habitat: blank });
  assert.equal('factFile' in topic, false);
  assert.equal('related' in topic, false);
  const kept = migrateCard({ id: 'reef', group: 'world-explorer', scientificName: null, name: pair('Reef', '珊瑚礁'), facts: [], habitat: pair('Warm seas.', '溫暖的海。') });
  assert.deepEqual(kept.factFile.habitat, [pair('Warm seas.', '溫暖的海。')]);
});

test('the report lists what is still empty', () => {
  const c = migrateCard(old());
  assert.deepEqual(factFileTodo(c), ['behaviour', 'foodAndHunting', 'conservation', 'didYouKnow']);
  assert.deepEqual(statsTodo(c), ['number of young']);
  assert.deepEqual(statsTodo({ ...c, group: 'plants' }), []);
});

test('version 3: food becomes foodAndHunting, didYouKnow a list; todo notes and glossary terms are found', () => {
  const v2 = migrateCard(old());
  v2.factFile.food = [pair('Eats [[omnivore|plants and animals]].', '什麼都吃。')];
  delete v2.factFile.foodAndHunting;
  v2.factFile.didYouKnow = pair('A [[den]] fact.', '[[den|巢穴]]的事。');
  v2.factFile.behaviour = [{ ...pair('Maybe.', '也許。'), todo: 'Check this (tried: source X).' }];
  v2._draft.push('factFile.food');
  const c = migrateCard(v2);
  assert.equal('food' in c.factFile, false);
  assert.deepEqual(c.factFile.foodAndHunting, [pair('Eats [[omnivore|plants and animals]].', '什麼都吃。')]);
  assert.deepEqual(c.factFile.didYouKnow, [pair('A [[den]] fact.', '[[den|巢穴]]的事。')]);
  assert.ok(c._draft.includes('factFile.foodAndHunting'));
  assert.deepEqual(todosOf(c), [{ where: 'factFile.behaviour', note: 'Check this (tried: source X).', en: 'Maybe.' }]);
  assert.deepEqual([...termsOf(c)].sort(), ['den', 'omnivore']);
  assert.deepEqual(migrateCard(c), c);
});

test('data/animals.json is already in the current shape', () => {
  const cards = JSON.parse(readFileSync(new URL('../data/animals.json', import.meta.url), 'utf8'));
  for (const c of cards) assert.deepEqual(migrateCard(c), c, c.id);
});
