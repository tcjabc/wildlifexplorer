// The Globe's filters: OR within a section, AND across sections, and the counts in the drawer.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, noFilters, filterCount, optionCount, onGlobe, pinShown, pinHint } from '../js/globe-filter.js';

const cards = [
  { id: 'magpie', group: 'birds', continents: ['asia'], biomes: ['forest', 'mountains'] },
  { id: 'hornbill', group: 'birds', continents: ['asia', 'africa'], biomes: ['rainforest'] },
  { id: 'lion', group: 'mammals', continents: ['africa'], biomes: ['grassland'] },
  { id: 'penguin', group: 'birds', continents: ['antarctica'], biomes: ['polar'] },
  { id: 'untagged', group: 'mammals' },
];
const ids = f => cards.filter(c => matches(c, f)).map(c => c.id);
const pick = sel => { const f = noFilters(); for (const [k, v] of Object.entries(sel)) f[k] = new Set(v); return f; };

test('no filters: everything', () => {
  assert.equal(ids(noFilters()).length, cards.length);
  assert.equal(filterCount(noFilters()), 0);
});

test('OR within a section', () => {
  assert.deepEqual(ids(pick({ continents: ['asia', 'antarctica'] })), ['magpie', 'hornbill', 'penguin']);
  assert.deepEqual(ids(pick({ biomes: ['polar', 'grassland'] })), ['lion', 'penguin']);
});

test('AND across sections', () => {
  assert.deepEqual(ids(pick({ continents: ['asia'], biomes: ['rainforest'], groups: ['birds'] })), ['hornbill']);
  assert.deepEqual(ids(pick({ continents: ['antarctica'], biomes: ['rainforest'] })), []);
  assert.deepEqual(ids(pick({ continents: ['africa'], groups: ['mammals'] })), ['lion']);
});

test('a card without tags only shows when that section is not in use', () => {
  assert.ok(ids(pick({ groups: ['mammals'] })).includes('untagged'));
  assert.ok(!ids(pick({ groups: ['mammals'], continents: ['africa'] })).includes('untagged'));
});

test('N counts every selected item', () => {
  assert.equal(filterCount(pick({ continents: ['asia', 'africa'], biomes: ['forest'], groups: ['birds'] })), 4);
});

test('an option counts its own cards, given the other sections', () => {
  assert.equal(optionCount(cards, noFilters(), 'groups', 'birds'), 3);
  assert.equal(optionCount(cards, pick({ continents: ['asia'] }), 'groups', 'birds'), 2);
  assert.equal(optionCount(cards, pick({ continents: ['asia'] }), 'groups', 'mammals'), 0);
});

test('its own section does not narrow it: other choices there are OR', () => {
  const f = pick({ continents: ['asia'] });
  assert.equal(optionCount(cards, f, 'continents', 'antarctica'), 1);
  assert.equal(optionCount(cards, f, 'continents', 'asia'), 2);
});

test('Antarctica + Rainforest cannot be reached: the option is 0 either way round', () => {
  assert.equal(optionCount(cards, pick({ continents: ['antarctica'] }), 'biomes', 'rainforest'), 0);
  assert.equal(optionCount(cards, pick({ biomes: ['rainforest'] }), 'continents', 'antarctica'), 0);
});

test('hidden: no pin shows, whatever the filters say or the card it was opened from', () => {
  assert.equal(pinShown(cards[0], noFilters(), { hidden: true }), false);
  assert.equal(pinShown(cards[0], noFilters(), { hidden: true, keep: cards[0] }), false);
  assert.equal(pinShown(cards[0], noFilters()), true);
});

test('the card the globe was opened from shows past a filter, and only that card', () => {
  const f = pick({ continents: ['antarctica'] });
  assert.equal(pinShown(cards[0], f), false);
  assert.equal(pinShown(cards[0], f, { keep: cards[0] }), true);
  assert.equal(pinShown(cards[2], f, { keep: cards[0] }), false);
  assert.equal(pinShown(cards[3], f, { keep: cards[0] }), true, 'what matches still shows');
});

test('the hint under the globe: none until the pins are placed, none while they are hidden', () => {
  const at = o => pinHint({ hidden: false, ready: true, placed: 3, shown: true, ...o });
  assert.equal(at({}), null);
  assert.equal(at({ placed: 0, shown: false }), 'globe.empty');
  assert.equal(at({ shown: false }), 'globe.filterNone');
  assert.equal(at({ placed: 0, shown: false, ready: false }), null);
  assert.equal(at({ placed: 0, shown: false, hidden: true }), null);
  assert.equal(at({ shown: false, hidden: true }), null);
});

test('a card can be on the globe by its range, or a place of its own', () => {
  assert.ok(onGlobe({ range: 'x.json' }));
  assert.ok(onGlobe({ fossilSite: { lat: 1, lng: 2 } }));
  assert.ok(onGlobe({ place: { lat: 1, lng: 2 } }));
  assert.ok(onGlobe({ pin: { lat: 1, lng: 2 } }));
  assert.equal(onGlobe({}), false);
});
