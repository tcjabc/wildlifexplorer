// The Food stage (js/food.js): one to three photos of what each species card's animal eats, credited
// like the photos, on our own files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { FOOD_MAX, foodOf } from '../js/food.js';
import { SPECIES_HEADINGS, VIEW_HAS, headingsFor, isTopic, viewFor } from '../js/headings.js';
import { isAllowedLicenseName } from '../scripts/lib/licenses.mjs';
import { thumbPath } from '../scripts/lib/images.mjs';

const cards = JSON.parse(await readFile(new URL('../data/animals.json', import.meta.url), 'utf8'));
const species = cards.filter(c => !isTopic(c));
const at = f => new URL(`../${f}`, import.meta.url);
const food = SPECIES_HEADINGS[1];

test('every species card has one to three food photos, credited like the photos', () => {
  for (const c of species) {
    const list = foodOf(c);
    assert.ok(list.length >= 1 && list.length <= FOOD_MAX, `${c.id}: ${list.length}`);
    assert.equal(list.length, c.stage.food.length, `${c.id}: every entry can be shown`);
    for (const pic of list) {
      assert.ok(existsSync(at(pic.file)), `${c.id}: ${pic.file} missing`);
      assert.ok(existsSync(at(thumbPath(pic.file))), `${c.id}: thumbnail missing`);
      assert.ok(isAllowedLicenseName(pic.license), `${c.id}: licence ${pic.license}`);
      for (const k of ['author', 'license', 'licenseUrl', 'sourceUrl']) assert.ok(pic[k], `${c.id}: no ${k}`);
    }
    assert.equal(new Set(list.map(p => p.file)).size, list.length, `${c.id}: no photo twice`);
  }
  assert.ok(cards.filter(isTopic).every(c => foodOf(c).length === 0), 'topic cards have none yet');
});

test('Food shows the tray on every species card; the plate is gone', () => {
  for (const c of species) assert.equal(viewFor(c, food), 'food', c.id);
  assert.ok(species.every(c => headingsFor(c)[1].enabled));
  assert.equal(VIEW_HAS.diet, undefined);
  assert.ok(species.every(c => !c.stats?.dietIcons), 'no emoji plate data left');
  assert.equal(viewFor({ group: 'mammals' }, food), 'photo', 'no photos: the gallery as before');
});

test('a food list keeps only what it can show, three at most', () => {
  const card = food => ({ stage: { food } });
  assert.deepEqual(foodOf(card('img/a.webp')), [], 'not a list');
  assert.deepEqual(foodOf(card([{ image: 'https://example.com/a.webp' }, { image: 'img/b.webp', credit: { author: 'X' } }])),
    [{ file: 'img/b.webp', author: 'X' }]);
  assert.equal(foodOf(card(['a', 'b', 'c', 'd'].map(n => ({ image: `img/${n}.webp` })))).length, 3);
});
