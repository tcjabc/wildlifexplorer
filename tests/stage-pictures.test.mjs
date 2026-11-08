// Stage pictures (js/stage-pictures.js) and the Babies stage: one photo of the young on 21 species
// cards, credited like the photos; the rest keep the gallery photo for now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { babiesOf, stagePicture } from '../js/stage-pictures.js';
import { SPECIES_HEADINGS, headingsFor, isTopic, viewFor } from '../js/headings.js';
import { isAllowedLicenseName } from '../scripts/lib/licenses.mjs';
import { thumbPath } from '../scripts/lib/images.mjs';

const cards = JSON.parse(await readFile(new URL('../data/animals.json', import.meta.url), 'utf8'));
const species = cards.filter(c => !isTopic(c));
const at = f => new URL(`../${f}`, import.meta.url);
const babies = SPECIES_HEADINGS[2];

// The cards with no photo of their young yet (see the Babies sheet): still the gallery.
const GAPS = ['formosan-black-bear', 'chinese-pangolin', 'taiwan-serow', 'formosan-flying-fox', 'masked-palm-civet',
  'red-and-white-giant-flying-squirrel', 'mikado-pheasant', 'formosan-landlocked-salmon', 'taiwan-cherry'];

test('a stage picture is one of our own WebP files, with its credit', () => {
  assert.deepEqual(stagePicture({ image: 'img/a.webp', credit: { author: 'X' } }), { file: 'img/a.webp', author: 'X' });
  for (const bad of [null, 'img/a.webp', { image: 'https://example.com/a.webp' }, { image: 'img/a.jpg' }, { image: '../a.webp' }]) {
    assert.equal(stagePicture(bad), null, JSON.stringify(bad));
  }
});

test('21 species cards have a photo of their young, credited like the photos', () => {
  const have = species.filter(c => babiesOf(c));
  assert.equal(have.length, 21);
  assert.deepEqual(species.filter(c => !babiesOf(c)).map(c => c.id).sort(), [...GAPS].sort());
  for (const c of have) {
    const pic = babiesOf(c);
    assert.ok(existsSync(at(pic.file)) && existsSync(at(thumbPath(pic.file))), `${c.id}: files`);
    assert.ok(isAllowedLicenseName(pic.license), `${c.id}: licence ${pic.license}`);
    for (const k of ['author', 'license', 'licenseUrl', 'sourceUrl']) assert.ok(pic[k], `${c.id}: no ${k}`);
    assert.ok(!/@/.test(pic.author), `${c.id}: no email in the credit`);
  }
});

test('Babies shows the photo where there is one, its placeholder where there isn\'t', () => {
  for (const c of species) assert.equal(viewFor(c, babies), babiesOf(c) ? 'babies' : 'placeholder', c.id);
  const noText = { ...species.find(c => c.id === 'eurasian-otter'), factFile: {} };
  assert.equal(headingsFor(noText)[2].view, 'babies', 'its photo even with no Babies text');
});

// Behaviour: one photo of what its text says it does, on 27 species cards. The bear and the macaque
// keep their Profile magnifier; the Atlas moth has none yet (docs/stage-gaps.md).
test('27 species cards have a behaviour photo; the Profile comes first where there is one', async () => {
  const { behaviourOf } = await import('../js/stage-pictures.js');
  const behaviour = SPECIES_HEADINGS[3];
  const have = species.filter(c => behaviourOf(c));
  assert.equal(have.length, 27);
  assert.deepEqual(species.filter(c => !behaviourOf(c)).map(c => c.id).sort(), ['atlas-moth', 'formosan-black-bear', 'formosan-rock-macaque']);
  for (const c of have) {
    const pic = behaviourOf(c);
    assert.ok(existsSync(at(pic.file)) && existsSync(at(thumbPath(pic.file))), `${c.id}: files`);
    assert.ok(isAllowedLicenseName(pic.license), `${c.id}: licence ${pic.license}`);
    for (const k of ['author', 'license', 'licenseUrl', 'sourceUrl']) assert.ok(pic[k], `${c.id}: no ${k}`);
    assert.ok(!/@/.test(pic.author), `${c.id}: no email in the credit`);
    assert.equal(viewFor(c, behaviour), 'behaviour', c.id);
  }
  for (const id of ['formosan-black-bear', 'formosan-rock-macaque']) assert.equal(viewFor(species.find(c => c.id === id), behaviour), 'profile', id);
  assert.equal(viewFor(species.find(c => c.id === 'atlas-moth'), behaviour), 'placeholder', 'its placeholder, for now');
  const pics = cards.flatMap(c => [babiesOf(c), behaviourOf(c)].filter(Boolean).map(p => p.sourceUrl));
  assert.equal(new Set(pics).size, pics.length, 'no photo used twice');
});
