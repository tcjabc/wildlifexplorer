// The heading grid (js/headings.js): the same places on every card, greyed out and never missing,
// and what each heading shows, on the real cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SPECIES_HEADINGS, TOPIC_HEADINGS, VIEW_HAS, headingSet, headingsFor, isTopic, textOf, viewFor,
} from '../js/headings.js';
import { modesFor, sizeOf } from '../js/compare-data.js';

const cards = JSON.parse(await readFile(new URL('../data/animals.json', import.meta.url), 'utf8'));
const species = cards.filter(c => !isTopic(c));
const topics = cards.filter(isTopic);
const on = id => species.filter(c => headingsFor(c).find(x => x.id === id).enabled).map(c => c.id);

test('both sets fill the grid: eight headings, one to a place', () => {
  for (const set of [SPECIES_HEADINGS, TOPIC_HEADINGS]) {
    assert.deepEqual(set.map(x => x.slot), [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(new Set(set.map(x => x.id)).size, 8);
    assert.equal(new Set(set.map(x => x.icon)).size, 8);
  }
});

test('🌍 ❤️ 💡 are in the same places in both sets', () => {
  for (const icon of ['🌍', '❤️', '💡']) {
    assert.equal(SPECIES_HEADINGS.find(x => x.icon === icon).slot, TOPIC_HEADINGS.find(x => x.icon === icon).slot, icon);
  }
});

test('every card shows all eight, in the same order, greyed out or not', () => {
  for (const card of cards) {
    const grid = headingsFor(card);
    assert.deepEqual(grid.map(x => x.id), headingSet(card).map(x => x.id), card.id);
    assert.deepEqual(grid.map(x => x.icon), headingSet(card).map(x => x.icon), card.id);
  }
});

test('a card with no data at all still has the whole grid, all greyed out', () => {
  const grid = headingsFor({ id: 'x', group: 'mammals', name: { en: 'X', zh: 'X' } });
  assert.equal(grid.length, 8);
  assert.ok(grid.every(x => !x.enabled));
});

test('topic cards are the four topic groups; T. rex and plants are species', () => {
  assert.deepEqual([...new Set(topics.map(c => c.group))].sort(), ['behavior', 'conservation', 'how-animals-work', 'world-explorer']);
  assert.ok(species.some(c => c.group === 'prehistoric') && species.some(c => c.group === 'plants'));
});

test('text marked todo is for grown-ups only', () => {
  const card = { group: 'mammals', factFile: { habitat: [{ en: 'a', zh: 'b', todo: 'check' }] } };
  const habitat = SPECIES_HEADINGS[0];
  assert.deepEqual(textOf(card, habitat), []);
  assert.equal(textOf(card, habitat, { preview: true }).length, 1);
  assert.equal(headingsFor(card)[0].enabled, false);
  assert.equal(headingsFor(card, { preview: true })[0].enabled, true);
});

test('a heading falls back to the photo, and a card can choose its own view', () => {
  const food = SPECIES_HEADINGS[1], behaviour = SPECIES_HEADINGS[3];
  assert.equal(viewFor({ group: 'mammals' }, food), 'photo');
  assert.equal(viewFor({ group: 'mammals', stats: { dietIcons: ['🌰'] } }, food), 'diet');
  const callouts = [{ x: 1, y: 1, en: 'a', zh: 'b' }];
  assert.equal(viewFor({ group: 'mammals', photo: { file: 'a.webp' }, profile: { callouts } }, behaviour), 'profile');
  assert.equal(viewFor({ group: 'mammals', stage: { food: 'status' }, status: 'VU' }, food), 'status');
  assert.equal(viewFor({ group: 'mammals', stage: { food: 'status' } }, food), 'photo', 'it can\'t: the usual one');
  assert.equal(viewFor({ group: 'mammals', stage: { food: 'stepper' } }, food), 'photo', 'a view not built yet is ignored');
});

test('every view a heading asks for is known', () => {
  for (const { views } of [...SPECIES_HEADINGS, ...TOPIC_HEADINGS]) for (const id of views) assert.ok(VIEW_HAS[id], id);
});

test('a size can be a length, a height or a wingspan', () => {
  assert.deepEqual(sizeOf({ stats: { lengthCm: { min: 100, max: 200 } } }), { cm: 150, across: true });
  assert.deepEqual(sizeOf({ stats: { heightCm: { min: 300 } } }), { cm: 300, across: false });
  assert.deepEqual(sizeOf({ stats: { wingspanCm: { min: 20 } } }), { cm: 20, across: true });
  assert.deepEqual(sizeOf({ compare: { height: 80 }, stats: { lengthCm: { min: 100 } } }), { cm: 80, across: false }, 'the silhouette\'s own size wins');
  assert.equal(sizeOf({}), null);
  assert.equal(modesFor({ stats: { heightCm: { min: 300 } } }).length, false, 'no silhouette to draw');
});

test('on today\'s 30 species cards: what is lit and what is grey', () => {
  assert.equal(species.length, 30);
  assert.equal(on('habitat').length, 30);
  assert.equal(on('behaviour').length, 30);
  assert.equal(on('dyk').length, 30);
  assert.equal(on('where').length, 30, 'a range map, or the continent');
  assert.deepEqual(species.map(c => c.id).filter(id => !on('food').includes(id)), ['taiwan-barbet']);
  assert.deepEqual(species.map(c => c.id).filter(id => !on('babies').includes(id)), ['red-and-white-giant-flying-squirrel', 'eurasian-otter']);
  assert.deepEqual(species.map(c => c.id).filter(id => !on('status').includes(id)), ['atlas-moth', 'tardigrade-water-bear']);
  assert.equal(on('size').length, 16);
});
