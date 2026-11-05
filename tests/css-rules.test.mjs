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

// One shadow value per item, splitting on commas outside brackets (color-mix has its own).
function layers(value) {
  const out = [''];
  let depth = 0;
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) out.push('');
    else out[out.length - 1] += ch;
  }
  return out.map(s => s.trim());
}

test('shadows are flat: no blur, no drop-shadow filter', () => {
  for (const { f, css } of sheets) {
    assert.doesNotMatch(css, /drop-shadow/, f);
    for (const [, value] of css.matchAll(/(?:box-shadow|text-shadow|--shadow-\d)\s*:\s*([^;]+);/g)) {
      for (const layer of layers(value)) {
        if (layer === 'none' || layer.startsWith('var(--shadow-')) continue;
        const parts = layer.replace(/^inset\s+/, '').match(/calc\([^)]*\)\)?|var\([^)]*\)|[^\s]+/g);
        assert.equal(parts[2], '0', `${f}: ${layer}`); // offset x, offset y, blur
      }
    }
  }
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
