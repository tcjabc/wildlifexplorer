// The Habitat stage (js/habitat.js): every species card's picture of its real home, its credit, and
// the sums that decide whether a tap found the animal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { coverBox, findOnBox, habitatOf, isFound } from '../js/habitat.js';
import { SPECIES_HEADINGS, headingsFor, isTopic, viewFor } from '../js/headings.js';
import { isAllowedLicenseName } from '../scripts/lib/licenses.mjs';
import { thumbPath as thumbOf } from '../scripts/lib/images.mjs';

const cards = JSON.parse(await readFile(new URL('../data/animals.json', import.meta.url), 'utf8'));
const species = cards.filter(c => !isTopic(c));
const at = f => new URL(`../${f}`, import.meta.url);
const habitat = SPECIES_HEADINGS[0];

test('every species card has a habitat picture, credited like the photos', () => {
  for (const c of species) {
    const hab = habitatOf(c);
    assert.ok(hab, `${c.id}: no habitat picture`);
    assert.ok(existsSync(at(hab.file)), `${c.id}: ${hab.file} missing`);
    assert.ok(existsSync(at(thumbOf(hab.file))), `${c.id}: thumbnail missing`);
    assert.ok(isAllowedLicenseName(hab.license), `${c.id}: licence ${hab.license}`);
    for (const k of ['author', 'license', 'licenseUrl', 'sourceUrl']) assert.ok(hab[k], `${c.id}: no ${k}`);
    assert.match(hab.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/, c.id);
  }
  assert.ok(cards.filter(isTopic).every(c => !habitatOf(c)), 'topic cards have none yet');
});

test('17 cards have the animal to find, each one inside its picture', () => {
  const finds = species.filter(c => habitatOf(c).find);
  assert.equal(finds.length, 17);
  for (const c of finds) {
    const { x, y, r } = habitatOf(c).find;
    assert.ok(x > 0 && x < 1 && y > 0 && y < 1 && r > 0 && r < 0.5, c.id);
  }
});

test('Habitat shows the picture; with none, the photo as before', () => {
  for (const c of species) assert.equal(viewFor(c, habitat), 'habitat', c.id);
  assert.equal(viewFor({ group: 'mammals' }, habitat), 'photo');
  assert.equal(viewFor({ group: 'mammals', stage: { habitat: { image: 'https://example.com/a.webp' } } }, habitat), 'photo', 'only our own img/ files');
  assert.equal(viewFor({ group: 'mammals', stage: { habitat: { image: 'img/a.webp' } } }, habitat), 'habitat');
  assert.ok(headingsFor({ group: 'mammals', stage: { habitat: { image: 'img/a.webp' } } })[0].enabled, 'a picture of its own lights the heading');
});

test('a find with numbers out of range is no find: the picture stays static', () => {
  const card = f => ({ stage: { habitat: { image: 'img/a.webp', find: f } } });
  assert.deepEqual(habitatOf(card({ x: 0.5, y: 0.5, r: 0.2 })).find, { x: 0.5, y: 0.5, r: 0.2 });
  for (const f of [{ x: 1.5, y: 0.5, r: 0.2 }, { x: 0.5, y: 0.5, r: 0 }, { x: '0.5', y: 0.5, r: 0.2 }, null]) {
    assert.equal(habitatOf(card(f)).find, null, JSON.stringify(f));
  }
});

test('the picture covers the stage around the animal, so a tap is measured on what is drawn', () => {
  // A 1200 × 800 picture on a square 400 stage: drawn 600 × 400, cropped at the sides.
  const centre = coverBox(1200, 800, 400, 400);
  assert.deepEqual(centre, { w: 600, h: 400, left: -100, top: 0 });
  // The animal at the left edge: the crop slides so it is in view.
  const left = coverBox(1200, 800, 400, 400, 0.1, 0.5);
  assert.equal(left.left, -20);
  const find = { x: 0.1, y: 0.5, r: 0.1 };
  const c = findOnBox(find, left);
  assert.deepEqual(c, { x: 40, y: 200, r: 40 });
  assert.ok(c.x - c.r >= 0, 'the whole ring is on the stage');
  assert.ok(isFound(find, left, 40, 200));
  assert.ok(isFound(find, left, 40 + 39, 200));
  assert.ok(!isFound(find, left, 40 + 41, 200), 'just outside: nothing');
  assert.ok(!isFound(find, left, 300, 100), 'anywhere else: nothing');
});
