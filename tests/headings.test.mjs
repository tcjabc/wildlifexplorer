// The heading grid (js/headings.js): the same places on every card, greyed out and never missing,
// and what each heading shows, on the real cards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SPECIES_HEADINGS, TOPIC_HEADINGS, VIEW_HAS, backSections, hasCall, headingSet, headingsFor, isTopic, narrationFiles, textOf, viewFor,
} from '../js/headings.js';
import { KEY_ORDER } from '../scripts/lib/card-schema.mjs';
import { EVERYDAY, PARTNERS, compareImage, modesFor, sizeOf, sizeStat, startWith, whoOf } from '../js/compare-data.js';

const cards = JSON.parse(await readFile(new URL('../data/animals.json', import.meta.url), 'utf8'));
const species = cards.filter(c => !isTopic(c));
const topics = cards.filter(isTopic);
// The cards whose heading shows something of its own (not the placeholder).
const own = id => species.filter(c => headingsFor(c).find(x => x.id === id).view !== 'placeholder').map(c => c.id);
const without = id => species.map(c => c.id).filter(i => !own(id).includes(i));

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

test('a card with no data at all still has the whole grid, every heading showing its placeholder', () => {
  const grid = headingsFor({ id: 'x', group: 'mammals', name: { en: 'X', zh: 'X' } });
  assert.equal(grid.length, 8);
  assert.ok(grid.every(x => x.view === 'placeholder'));
  assert.ok(grid.every(x => !('enabled' in x)), 'nothing is greyed out any more');
});

test('every heading on every card shows something: its own view, or its placeholder', () => {
  for (const c of cards) for (const x of headingsFor(c, { related: 1, lookalikes: 1 })) assert.ok(x.view, `${c.id} ${x.id}`);
  for (const set of [SPECIES_HEADINGS, TOPIC_HEADINGS]) for (const x of set) assert.equal(x.views.at(-1), 'placeholder', x.id);
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
  assert.deepEqual(headingsFor(card)[0].text, []);
  assert.equal(headingsFor(card, { preview: true })[0].text.length, 1);
});

test('a heading falls back to its placeholder, and a card can choose its own view', () => {
  const food = SPECIES_HEADINGS[1], behaviour = SPECIES_HEADINGS[3];
  assert.equal(viewFor({ group: 'mammals' }, food), 'placeholder');
  assert.equal(viewFor({ group: 'mammals', stage: { food: [{ image: 'img/a.webp' }] } }, food), 'food');
  const callouts = [{ x: 1, y: 1, en: 'a', zh: 'b' }];
  assert.equal(viewFor({ group: 'mammals', photo: { file: 'a.webp' }, profile: { callouts } }, behaviour), 'profile');
  assert.equal(viewFor({ group: 'mammals', stage: { food: 'status' }, status: 'VU' }, food), 'status');
  assert.equal(viewFor({ group: 'mammals', stage: { food: 'status' } }, food), 'placeholder', 'it can\'t: the usual one');
  assert.equal(viewFor({ group: 'mammals', stage: { food: 'stepper' } }, food), 'placeholder', 'a view not built yet is ignored');
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

test('on today\'s 30 species cards: what shows something of its own, and what the placeholder', () => {
  assert.equal(species.length, 30);
  assert.equal(own('habitat').length, 30);
  assert.deepEqual(without('behaviour'), ['atlas-moth']);
  assert.equal(own('dyk').length, 0, 'the placeholder until its photos come');
  assert.equal(own('where').length, 30, 'a range map, or the continent');
  assert.equal(own('food').length, 30, 'the food carousel');
  assert.equal(without('babies').length, 9, 'the Babies gaps in docs/stage-gaps.md');
  assert.deepEqual(without('status'), ['formosan-landlocked-salmon', 'atlas-moth', 'tyrannosaurus-rex', 'tardigrade-water-bear', 'taiwan-cherry'], 'no Red List status: its text, and the placeholder');
  assert.deepEqual(without('size'), []);
});

test('the back: the headings with something to read, in the grid order, none greyed out', () => {
  const ids = c => backSections(c).map(x => x.id);
  const card = cards.find(c => c.id === 'red-and-white-giant-flying-squirrel');
  // With its babies text still to check (todo), only a grown-up in preview reads it.
  const squirrel = { ...card, factFile: { ...card.factFile, breeding: card.factFile.breeding.map(q => ({ ...q, todo: 'check' })) } };
  assert.deepEqual(ids(squirrel), ['habitat', 'food', 'behaviour', 'where', 'status', 'dyk']);
  assert.deepEqual(backSections(squirrel, { preview: true }).map(x => x.id), ['habitat', 'food', 'babies', 'behaviour', 'where', 'status', 'dyk']);
  for (const c of cards) {
    const set = headingSet(c).map(x => x.id);
    const back = backSections(c, { related: 1 });
    assert.deepEqual(back.map(x => x.id), set.filter(id => back.some(x => x.id === id)), `${c.id}: grid order`);
    assert.ok(!back.some(x => x.id === 'size'), `${c.id}: size is the statistics block`);
  }
  assert.deepEqual(backSections({ id: 'x', group: 'mammals' }), [], 'nothing to read: an empty back');
});

test('topic cards turn over to their own headings', () => {
  for (const c of topics) {
    const ids = backSections(c).map(x => x.id);
    assert.ok(ids.every(id => TOPIC_HEADINGS.some(x => x.id === id)), c.id);
    assert.ok(ids.length > 0, `${c.id} has something on its back`);
  }
  const who = { id: 't', group: 'behavior', related: ['a'] };
  assert.deepEqual(backSections(who, { related: 1 }).map(x => x.id), ['who'], 'the animals to look for, by name');
});

test('a size number with a source names one that is on the card', () => {
  for (const c of cards) {
    for (const s of c._sources ?? []) {
      for (const f of s.for ?? []) assert.ok(c.stats?.[f.replace('stats.', '')], `${c.id}: ${f}`);
    }
  }
});

test('a comparison starts with the child only if their profile has the number it needs', () => {
  assert.equal(startWith('length', { heightCm: 95 }), 'you');
  assert.equal(startWith('weight', { heightCm: 95 }), 'adult');
  assert.equal(startWith('length', { heightCm: null, weightKg: 14 }), 'adult');
  assert.equal(startWith('length', null), 'adult');
});

test('the partners\' pictures have the shape the scenes draw them at', async () => {
  for (const p of Object.values(PARTNERS)) {
    const svg = await readFile(new URL(`../${p.img}`, import.meta.url), 'utf8');
    const [, , w, h] = svg.match(/viewBox="([\d. ]+)"/)[1].split(' ').map(Number);
    assert.ok(Math.abs(h / w - p.ratio) < 0.001, p.id);
    // A grain of sand, a hair or a grain of salt is drawn at a scale of its own.
    if (p.cm >= 1) assert.equal(p.across ? w : h, p.cm, `${p.id}: 1 unit = 1 cm`);
  }
});

test('a card can have partners of its own, and they are all known', () => {
  assert.deepEqual(whoOf({}), EVERYDAY);
  for (const c of cards) for (const id of whoOf(c)) assert.ok(id === 'you' || PARTNERS[id], `${c.id}: ${id}`);
  const list = ['sand', 'hair', 'salt'];
  assert.equal(startWith('length', { heightCm: 95 }, list), 'sand', 'no child on the list: the first on it');
  assert.equal(startWith('length', { heightCm: 95 }, ['you', 'adult', 'car']), 'you');
});

test('a comparison can draw another picture than the card\'s silhouette', () => {
  const cherry = cards.find(c => c.id === 'taiwan-cherry');
  assert.equal(compareImage(cherry), 'assets/cherry-tree.svg');
  assert.match(cherry.silhouette.file, /^img\/silhouettes\//, 'the stamp stays the fruit');
  assert.equal(compareImage({ silhouette: { file: 'a.svg' } }), 'a.svg');
  assert.equal(compareImage({}), null);
  assert.deepEqual(sizeOf(cherry), { cm: 550, across: false });
  assert.deepEqual(whoOf(cherry), ['you', 'adult', 'car']);
});

test('the caption says what the card says, not how big the picture is drawn', () => {
  const stat = id => sizeStat(cards.find(c => c.id === id));
  assert.deepEqual(stat('bengal-tiger'), { min: 164, max: 211 });
  assert.deepEqual(stat('hippopotamus'), { min: 330, max: 345 }, 'drawn by height, and it has no height');
  assert.deepEqual(stat('taiwan-serow'), { min: 50, max: 70 });
  assert.deepEqual(stat('western-lowland-gorilla'), { min: 140, max: 180 });
  assert.deepEqual(stat('formosan-flying-fox'), { min: 124, max: 141 }, 'wings out: its wingspan');
  assert.deepEqual(stat('atlas-moth'), { min: 20, max: 25 });
  assert.deepEqual(stat('taiwan-cherry'), { min: 300, max: 800 });
  assert.equal(sizeStat({ compare: { width: 50 } }), null);
});

test('only a sound in audio/calls/ counts as a card\'s call', () => {
  assert.equal(hasCall({}), false);
  assert.equal(hasCall({ call: { file: 'audio/calls/bear.m4a' } }), true);
  assert.equal(hasCall({ call: { file: 'https://example.com/bear.m4a' } }), false);
  assert.equal(hasCall({ call: { file: 'audio/calls/../secret.m4a' } }), false);
  assert.ok(cards.every(c => !c.call), 'none yet');
});

test('new card fields keep their place in the data', () => {
  for (const k of ['factHeadings', 'stage', 'call', 'narration']) assert.ok(KEY_ORDER.includes(k), k);
});

test('a heading\'s narration: only recordings in audio/narration/, in the language, and none is fine', () => {
  const card = { narration: { habitat: { en: 'audio/narration/a-en.m4a', zh: 'audio/narration/a-zh.m4a' }, food: { en: 'https://example.com/a.m4a' }, status: { zh: 'audio/narration/b-zh.m4a' } } };
  assert.deepEqual(narrationFiles(card, 'habitat', 'en'), ['audio/narration/a-en.m4a']);
  assert.deepEqual(narrationFiles(card, 'habitat', 'zh'), ['audio/narration/a-zh.m4a']);
  assert.deepEqual(narrationFiles(card, 'habitat', 'both'), ['audio/narration/a-en.m4a', 'audio/narration/a-zh.m4a']);
  assert.deepEqual(narrationFiles(card, 'status', 'en'), [], 'no English file');
  assert.deepEqual(narrationFiles(card, 'food', 'en'), [], 'not from elsewhere');
  assert.deepEqual(narrationFiles(card, 'behaviour'), []);
  assert.deepEqual(narrationFiles({}, 'habitat'), []);
  assert.ok(cards.every(c => !c.narration), 'none yet');
});

test('the topic cards have their facts under the headings the owner put them under', () => {
  const lit = id => headingsFor(cards.find(c => c.id === id)).filter(x => x.text.length).map(x => x.id);
  assert.deepEqual(lit('migration'), ['what', 'who', 'wow']);
  assert.deepEqual(lit('central-mountain-range'), ['what', 'how', 'wow']);
  assert.deepEqual(lit('kenting-coral-reefs'), ['what', 'when', 'where']);
  assert.deepEqual(lit('saving-the-formosan-black-bear'), ['what', 'help']);
  assert.deepEqual(lit('how-animals-fly'), ['how', 'wow']);
  for (const c of topics) {
    assert.equal(c.factHeadings.length, c.facts.length, c.id);
    for (const id of c.factHeadings) assert.ok(TOPIC_HEADINGS.some(x => x.id === id), `${c.id}: ${id}`);
  }
});

test('a topic card nobody has sorted yet still shows its facts', () => {
  const card = { group: 'behavior', facts: [{ en: 'a', zh: 'b' }, { en: 'c', zh: 'd' }, { en: 'e', zh: 'f' }] };
  assert.deepEqual(headingsFor(card).filter(x => x.text.length).map(x => x.id), ['what', 'wow', 'dyk']);
});
