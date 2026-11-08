// The Food stage (js/food.js): an emoji for every food each species card's text names, most with a
// photo (prey always alive), credited like the photos, on our own files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { foodOf, foodPhotos } from '../js/food.js';
import { SPECIES_HEADINGS, VIEW_HAS, headingsFor, isTopic, viewFor } from '../js/headings.js';
import { isAllowedLicenseName } from '../scripts/lib/licenses.mjs';
import { thumbPath } from '../scripts/lib/images.mjs';

const cards = JSON.parse(await readFile(new URL('../data/animals.json', import.meta.url), 'utf8'));
const species = cards.filter(c => !isTopic(c));
const at = f => new URL(`../${f}`, import.meta.url);
const food = SPECIES_HEADINGS[1];

// The emoji the cards use, all in Emoji 11 or older: the baseline tablet is Android 9, which draws
// anything newer as an empty box. A new emoji goes here only after checking its version.
const EMOJI_11 = new Set(['🌰', '🍎', '🌿', '🐛', '🐭', '🐜', '🍓', '🌾', '🌳', '🌸', '🍄', '🍐', '🥭', '🍍', '🐀', '🐁',
  '🍃', '🐞', '🐝', '🌲', '🐟', '🐠', '🦌', '🐗', '🐃', '🦓', '🌵', '🦗', '🍒', '🐸', '🦎', '🐦', '🦇', '🦕', '🦏',
  '🌱', '🦠', '☀️']);

test('every species card has an emoji for each food, and a photo for most', () => {
  for (const c of species) {
    const items = foodOf(c);
    assert.ok(items.length >= 1 && items.length <= 5, `${c.id}: ${items.length} foods`);
    assert.deepEqual(items.map(i => i.icon), c.stats.dietIcons, `${c.id}: one per emoji, in order`);
    for (const { icon } of items) assert.ok(EMOJI_11.has(icon), `${c.id}: ${icon} is not on the Emoji 11 list`);
    assert.ok(items[0].pic, `${c.id}: it opens on a photo`);
    assert.equal(foodPhotos(c).length, c.stage.food.length, `${c.id}: every photo has its emoji`);
    for (const pic of foodPhotos(c)) {
      assert.ok(existsSync(at(pic.file)) && existsSync(at(thumbPath(pic.file))), `${c.id}: ${pic.file}`);
      assert.ok(isAllowedLicenseName(pic.license), `${c.id}: licence ${pic.license}`);
      for (const k of ['author', 'license', 'licenseUrl', 'sourceUrl']) assert.ok(pic[k], `${c.id}: no ${k}`);
    }
  }
  assert.equal(species.reduce((n, c) => n + foodPhotos(c).length, 0), 72, 'the 72 approved photos');
  const bear = foodOf(species.find(c => c.id === 'formosan-black-bear'));
  assert.deepEqual(bear.map(i => [i.icon, Boolean(i.pic)]), [['🌰', true], ['🍎', false], ['🌿', false], ['🐛', true], ['🐭', false]], 'the old plate, two photos');
  assert.ok(cards.filter(isTopic).every(c => foodOf(c).length === 0), 'topic cards have none yet');
});

test('Food shows the carousel on every species card', () => {
  for (const c of species) assert.equal(viewFor(c, food), 'food', c.id);
  assert.equal(VIEW_HAS.diet, undefined);
  assert.equal(viewFor({ group: 'mammals' }, food), 'placeholder', 'no food: its placeholder');
});

test('each photo goes with its own emoji, two of the same in order; an emoji alone has no photo', () => {
  const card = { stats: { dietIcons: ['🦌', '🦌', '🐗', '🍎'] }, stage: { food: [
    { icon: '🦌', image: 'img/a.webp' }, { icon: '🐗', image: 'img/c.webp' }, { icon: '🦌', image: 'img/b.webp' },
    { icon: '🐟', image: 'https://example.com/x.webp' }] } };
  assert.deepEqual(foodOf(card).map(i => [i.icon, i.pic?.file ?? null]), [['🦌', 'img/a.webp'], ['🦌', 'img/b.webp'], ['🐗', 'img/c.webp'], ['🍎', null]]);
  assert.deepEqual(foodOf({ stage: { food: [{ image: 'img/a.webp' }] } }).map(i => i.icon), ['🍽️'], 'a photo with no emoji still shows');
  assert.deepEqual(foodOf({ stats: { dietIcons: '🌰' } }), [], 'not a list');
});
