// The grown-ups' gate: its question in words, in both languages, and the tab that leads to it.
// How it looks is in tests/parents-layout.test.mjs.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const en = JSON.parse(src('lang/en.json')), zh = JSON.parse(src('lang/zh-TW.json'));

test('every factor has its word in both languages', () => {
  const words = lang => [2, 3, 4, 5, 6, 7, 8, 9].map(n => lang[`parents.gate.${n}`]);
  assert.deepEqual(words(en), ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']);
  assert.deepEqual(words(zh), ['二', '三', '四', '五', '六', '七', '八', '九']);
});

test('the question reads as asked for', () => {
  const fill = (s, a, b) => s.replace('{a}', a).replace('{b}', b);
  assert.equal(fill(en['parents.gate'], 'six', 'seven'), 'What is six times seven?');
  assert.equal(fill(zh['parents.gate'], '六', '七'), '六乘以七是多少？');
});

test('factors from 2 to 9, and an answer that fits the pad', () => {
  const gate = src('js/components.js');
  assert.match(gate, /const FACTOR_MIN = 2, FACTOR_MAX = 9;/);
  assert.match(gate, /const MAX_DIGITS = 2;/);
});

test('the grown-ups\' tab is the lock', () => {
  assert.match(src('js/chrome.js'), /view: 'parents', icon: '🔒'/);
  for (const file of ['js/chrome.js', 'js/views/parents.js', 'README.md', 'lang/en.json', 'lang/zh-TW.json']) assert.doesNotMatch(src(file), /⚙/, file);
});
