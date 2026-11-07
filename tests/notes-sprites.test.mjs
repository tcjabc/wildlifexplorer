// The pictures a page is stamped with (js/notes-sprites.js): what size they are made at, and that
// they are made once and given up oldest first.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeFor, sprite } from '../js/notes-sprites.js';

globalThis.document = { createElement: () => ({ getContext: () => ({}) }) };

test('a stamp shares a picture with others near its size, and big ones stop growing', () => {
  assert.equal(sizeFor(10), 32);
  assert.equal(sizeFor(140), 128); // a stamp of the usual size on the tablet
  assert.equal(sizeFor(160), 256);
  assert.equal(sizeFor(5000), 512);
});

test('a sprite is made once, and the least used goes first when there are too many', () => {
  let made = 0;
  const get = key => sprite(key, 1000, 1000, () => { made++; });
  const a = get('a');
  assert.equal(get('a'), a);
  assert.equal(made, 1);
  for (const k of 'bcde') get(k);
  get('a');                     // used again: now the newest
  get('f');                     // 6 × 1,000,000 px is the limit, so this one pushes the oldest out
  get('g');
  assert.equal(get('a'), a, 'the one in use stayed');
  const before = made;
  get('b');
  assert.equal(made, before + 1, 'the oldest had gone');
});
