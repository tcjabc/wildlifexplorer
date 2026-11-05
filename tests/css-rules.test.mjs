// Rules that keep the app light on the baseline tablet (Android 9) and its layout in one place.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const dir = new URL('../css/', import.meta.url);
const files = (await readdir(dir)).filter(f => f.endsWith('.css'));
const sheets = await Promise.all(files.map(async f => ({
  f, css: (await readFile(new URL(f, dir), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, ''),
})));

test('no backdrop-filter', () => {
  for (const { f, css } of sheets) assert.doesNotMatch(css, /backdrop-filter/, f);
});

test('screen height and safe areas come from the tokens', () => {
  for (const { f, css } of sheets) {
    if (f === 'tokens.css') continue;
    assert.doesNotMatch(css, /\benv\(safe-area/, f);
    // @keyframes are left out: they only move things off the screen.
    const rules = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
    assert.doesNotMatch(rules, /[\d.]d?vh\b/, f);
  }
});
