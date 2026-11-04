// Every glossary term used in card text must be in data/glossary.json, with its term and
// definition in both languages; the markup must be well formed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { termsOf, FACT_SECTIONS } from '../scripts/lib/card-schema.mjs';

const read = p => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const cards = read('data/animals.json');
const { terms } = read('data/glossary.json');

test('every glossary term used on a card is in data/glossary.json', () => {
  const missing = [];
  for (const c of cards) for (const id of termsOf(c)) if (!terms[id]) missing.push(`${c.id}: [[${id}]]`);
  assert.deepEqual(missing, [], `Missing glossary entries:\n  ${missing.join('\n  ')}`);
});

test('every glossary entry has its term and definition in English and Chinese', () => {
  const bad = Object.entries(terms).filter(([id, e]) => !/^[a-z0-9-]+$/.test(id)
    || !e.term?.en?.trim() || !e.term?.zh?.trim() || !e.def?.en?.trim() || !e.def?.zh?.trim()).map(([id]) => id);
  assert.deepEqual(bad, []);
});

test('glossary markup is well formed: every [[ is closed, ids are lowercase, Chinese gives the words to show', () => {
  const bad = [];
  for (const c of cards) {
    for (const k of [...FACT_SECTIONS, 'didYouKnow']) {
      for (const p of c.factFile?.[k] ?? []) {
        for (const lang of ['en', 'zh']) {
          const s = p[lang] ?? '';
          const opens = (s.match(/\[\[/g) ?? []).length, closes = (s.match(/\]\]/g) ?? []).length;
          const marks = [...s.matchAll(/\[\[([^\]|]*)(\|[^\]]*)?\]\]/g)];
          if (opens !== closes || marks.length !== opens) bad.push(`${c.id} ${k} ${lang}: unbalanced [[ ]]`);
          for (const m of marks) {
            if (!/^[a-z0-9-]+$/.test(m[1])) bad.push(`${c.id} ${k} ${lang}: bad id "${m[1]}"`);
            if (lang === 'zh' && !m[2]) bad.push(`${c.id} ${k} zh: [[${m[1]}]] needs |中文`);
          }
        }
      }
    }
  }
  assert.deepEqual(bad, []);
});
