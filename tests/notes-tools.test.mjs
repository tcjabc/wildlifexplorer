// The tools' shared settings and the ruler's geometry: plain data, no browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PENCILS, HIGHLIGHTS, DEFAULTS, SIZES, paletteOf, widthOf, isFine, cleanTools, colourOf, sizeOf, withColour, withSize, canStamp, usedStamp, stampRow,
} from '../js/notes-tools.js';
import { RULER_L, RULER_H, onRuler, edgeAt, snapTo, clampRuler } from '../js/notes-ruler.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, msg ?? `${a} ≈ ${b}`);

test('white is in every palette but the highlighter\'s, which is cyan, yellow and magenta only', () => {
  assert.deepEqual(HIGHLIGHTS, ['cyan', 'yellow', 'magenta']);
  for (const tool of ['pencil', 'pen', 'text', 'stamp', 'roller']) assert.ok(paletteOf(tool).includes('white'), tool);
  assert.deepEqual(paletteOf('highlighter'), HIGHLIGHTS);
});

test('settings from storage: nothing stored gives the defaults, and what makes no sense is replaced', () => {
  assert.deepEqual(cleanTools(undefined), DEFAULTS);
  assert.deepEqual(cleanTools('nonsense'), DEFAULTS);
  const set = cleanTools({ pencil: { colour: 'white', size: 'huge' }, highlighter: { colour: 'white', size: 'thin' }, ink: 'plaid', foot: 'bear', stampCard: 7 });
  assert.deepEqual(set.pencil, { colour: 'white', size: 'thin' });
  assert.deepEqual(set.highlighter, { colour: 'yellow', size: 'thin' }, 'no white highlighter');
  assert.equal(set.ink, DEFAULTS.ink);
  assert.equal(set.foot, 'bear');
  assert.equal(set.stampCard, null);
});

test('one colour per drawing tool, and one ink for the stamps', () => {
  let set = cleanTools();
  set = withColour(set, 'pen', 'red');
  set = withColour(set, 'text', 'green');
  assert.equal(colourOf(set, 'pen'), 'red');
  assert.equal(colourOf(set, 'pencil'), DEFAULTS.pencil.colour, 'the pencil keeps its own');
  for (const tool of ['text', 'stamp', 'roller']) assert.equal(colourOf(set, tool), 'green', tool);
  set = withSize(set, 'highlighter', 'thin');
  assert.equal(sizeOf(set, 'highlighter'), 'thin');
  assert.equal(sizeOf(set, 'pencil'), 'thin');
  assert.ok(widthOf('highlighter', 'thin') > widthOf('pencil', 'thick'), 'a highlighter is wide');
  assert.equal(PENCILS.length, 9);
});

test('the eraser has no colour of its own: its controls speak for the pencil', () => {
  const set = withColour(cleanTools(), 'eraser', 'blue');
  assert.equal(set.pencil.colour, 'blue');
  assert.equal(colourOf(set, 'eraser'), 'blue');
});

test('a stamp needs a group of living things, the card\'s flag and a silhouette', () => {
  const card = { stamp: true, silhouette: { file: 'a.svg' } }, living = { stampable: true };
  assert.equal(canStamp(card, living), true);
  assert.equal(canStamp(card, {}), false, 'Behaviour, World Explorer, Conservation, How Animals Work');
  assert.equal(canStamp({ ...card, stamp: undefined }, living), false);
  assert.equal(canStamp({ stamp: true }, living), false);
  assert.equal(canStamp(card, undefined), false);
});

test('the row: the page\'s animal, the last three used, this week\'s pack; once each, only stamps, and short', () => {
  const can = id => id !== 'topic';
  assert.deepEqual(stampRow({ linked: ['topic', 'owl', 'bat'], recent: ['fox', 'owl'], pack: ['eel', 'topic', 'fox'], can }), ['owl', 'fox', 'eel']);
  assert.deepEqual(stampRow({ recent: ['a', 'b', 'c'], pack: ['d', 'e', 'f', 'g'], can }), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(stampRow({ can }), []);
});

test('the last three used, the newest first', () => {
  assert.deepEqual(usedStamp(['a', 'b', 'c'], 'd'), ['d', 'a', 'b']);
  assert.deepEqual(usedStamp(['a', 'b', 'c'], 'c'), ['c', 'a', 'b']);
  assert.deepEqual(cleanTools({ stampRecent: ['a', 7, '', 'b', 'c', 'd'] }).stampRecent, ['a', 'b', 'c']);
  assert.deepEqual(cleanTools({ stampRecent: 'a' }).stampRecent, []);
});

test('ruler: what is on it, turned or not', () => {
  const flat = { x: 500, y: 700, r: 0 };
  assert.ok(onRuler(flat, 500 + RULER_L / 2 - 1, 700));
  assert.ok(!onRuler(flat, 500, 700 + RULER_H / 2 + 1));
  assert.ok(onRuler(flat, 500, 700 + RULER_H / 2 + 1, 5), 'with some room around it');
  const upright = { ...flat, r: Math.PI / 2 };
  assert.ok(onRuler(upright, 500, 700 + RULER_L / 2 - 1));
  assert.ok(!onRuler(upright, 500 + RULER_L / 2 - 1, 700));
});

test('ruler: a line follows the edge it starts beside, and only there', () => {
  const ruler = { x: 500, y: 700, r: 0 };
  assert.equal(edgeAt(ruler, 300, 700 + RULER_H / 2 + 10), 1);
  assert.equal(edgeAt(ruler, 300, 700 - RULER_H / 2 - 10), -1);
  assert.equal(edgeAt(ruler, 300, 700 + RULER_H / 2 + 60), 0, 'too far off');
  assert.equal(edgeAt(ruler, 500 + RULER_L / 2 + 60, 700 + RULER_H / 2 + 10), 0, 'past its end');
  assert.equal(edgeAt(ruler, 300, 700 + 10), 0, 'on it: a finger moves the ruler');
  assert.equal(edgeAt(ruler, 300, 700 + 10, { inside: true }), 1, 'a pen takes the nearer edge');
  assert.equal(edgeAt(ruler, 300, 700 - 10, { inside: true }), -1);
});

test('ruler: points land on the edge, turned with it, and stop at its ends', () => {
  const ruler = { x: 500, y: 700, r: 0 };
  assert.deepEqual(snapTo(ruler, 1, 320, 790), [320, 700 + RULER_H / 2]);
  assert.deepEqual(snapTo(ruler, -1, 2000, 0), [500 + RULER_L / 2, 700 - RULER_H / 2]);
  const turned = { x: 0, y: 0, r: Math.PI / 2 }; // along it is now downwards; edge 1 is on the left
  const [x, y] = snapTo(turned, 1, -80, 100);
  near(x, -RULER_H / 2);
  near(y, 100);
});

test('ruler: its middle stays on the book', () => {
  assert.deepEqual(clampRuler({ x: -50, y: 5000, r: 1 }, 1000, 1400), { x: 0, y: 1400, r: 1 });
  assert.deepEqual(clampRuler({ x: 1500, y: 700, r: 0 }, 2000, 1400), { x: 1500, y: 700, r: 0 });
});

test('five thicknesses, with thin and thick as they were, and the old settings still good', () => {
  assert.deepEqual(SIZES, ['hair', 'thin', 'mid', 'thick', 'bold']);
  assert.equal(widthOf('pencil', 'thin'), 5);
  assert.equal(widthOf('pencil', 'thick'), 12);
  assert.equal(widthOf('highlighter', 'thick'), 40);
  for (const tool of ['pencil', 'pen', 'highlighter']) {
    const w = SIZES.map(s => widthOf(tool, s));
    assert.deepEqual(w, [...w].sort((a, b) => a - b), tool);
  }
  assert.equal(cleanTools({ pencil: { size: 'thick' } }).pencil.size, 'thick');
  assert.equal(cleanTools({ pencil: { size: 'bold' } }).pencil.size, 'bold');
  assert.equal(isFine('hair'), true);
  assert.equal(isFine('thin'), true);
  assert.equal(isFine('mid'), false);
});

test('the tape in hand is kept, and anything else falls back to the first', () => {
  assert.equal(cleanTools({ washi: 'blue' }).washi, 'blue');
  assert.equal(cleanTools({ washi: 'plaid' }).washi, 'yellow');
  assert.equal(cleanTools({}).washi, 'yellow');
});
