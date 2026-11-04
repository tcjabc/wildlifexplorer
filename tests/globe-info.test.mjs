// The globe's info panel (js/globe-info.js, js/globe-art.js, js/views/globe.js): a panel for
// every layer, its strings in both languages, keys without sentences, colours and drawings
// that exist, where the panel goes on each screen, and the room it leaves the globe.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INFO, panelMode, PHONE_MAX, infoKeys, keyLabels } from '../js/globe-info.js';
import { ART } from '../js/globe-art.js';
import { LAYERS, DEPTHS } from '../js/layers.js';
import { roomFit } from '../js/globe.js';

const src = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const en = JSON.parse(src('lang/en.json'));
const zh = JSON.parse(src('lang/zh-TW.json'));
const tokens = src('css/tokens.css');
const css = src('css/app.css');

test('every layer, and Everywhere, has a panel: a key, "What am I looking at?" with a drawing, and more', () => {
  assert.deepEqual(Object.keys(INFO).sort(), ['everywhere', ...LAYERS.map(L => L.id)].sort());
  for (const [id, info] of Object.entries(INFO)) {
    assert.ok(info.key === 'temp' || (Array.isArray(info.key) && info.key.length > 0), `${id}: a key`);
    assert.ok(info.what.length >= 1 && info.what.length <= 2, `${id}: one or two lines`);
    assert.ok(info.more.length >= 1, `${id}: something for older children`);
    assert.ok(ART[info.art], `${id}: drawing ${info.art} exists`);
  }
  assert.equal(INFO.temp.key, 'temp');
});

test('every panel string is in both languages, and the Chinese is not the English', () => {
  for (const k of infoKeys()) {
    assert.ok(en[k]?.trim(), `en: ${k}`);
    assert.ok(zh[k]?.trim(), `zh-TW: ${k}`);
    assert.notEqual(zh[k], en[k], `zh-TW is translated: ${k}`);
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort(), 'the same keys in both files');
});

test('the keys are short labels, never sentences', () => {
  for (const id of Object.keys(INFO)) {
    for (const k of keyLabels(id)) {
      for (const [lang, s] of [['en', en[k]], ['zh', zh[k]]]) {
        assert.ok(!/[.!?。！？]$/.test(s), `${lang} ${k}: no full stop (${s})`);
        assert.ok(s.length <= 32, `${lang} ${k}: short (${s.length} characters)`);
      }
    }
  }
});

test('the key colours are design tokens', () => {
  for (const [id, info] of Object.entries(INFO)) {
    if (!Array.isArray(info.key)) continue;
    for (const k of info.key) {
      if (!k.token) continue;
      assert.ok(tokens.includes(`${k.token}:`), `${id}: ${k.token} is in css/tokens.css`);
    }
  }
  for (const t of ['--gpanel-w', '--gpanel-strip', '--gpanel-art', '--gpanel-sheet', '--c-twilight']) assert.ok(tokens.includes(`${t}:`), t);
});

test('depth: the key goes from the lightest (top) to the darkest, one step per zone, each with a name and an animal', () => {
  const { key, zones } = INFO.depth;
  assert.equal(key.length, DEPTHS.length + 1);
  assert.equal(zones.length, key.length);
  assert.deepEqual(key.map(k => k.token), ['--c-map-sea', ...DEPTHS.map((_, i) => `--c-depth-${i + 1}`)]);
  assert.deepEqual(key.slice(1).map(k => Number(k.short.replace(',', ''))), DEPTHS, 'each step starts at its zone\'s top');
  for (const z of zones) {
    assert.match(z.animal.card, /^[a-z0-9-]+$/, 'a card id');
    assert.ok(z.animal.art, 'a drawing when the card is not built yet');
  }
});

test('every drawing class the panel uses has a style (coloured by tokens)', () => {
  const art = src('js/globe-art.js');
  const used = new Set([...art.matchAll(/'(art__[a-z-]+)/g)].map(m => m[1]));
  assert.ok(used.size > 10);
  for (const cls of used) {
    if (cls === 'art__zone') continue;
    assert.ok(css.includes(`.${cls}`), `.${cls} is styled in css/app.css`);
  }
  for (let i = 0; i <= DEPTHS.length; i++) assert.ok(css.includes(`.art__zone--${i}`), `zone ${i}`);
  assert.ok(!/#[0-9a-f]{3,6}\b/i.test(art), 'no colours in the drawings themselves');
});

test('where the panel goes: a column in landscape, a sheet on a portrait tablet, a strip on a phone', () => {
  assert.equal(panelMode(1180, 820), 'side');
  assert.equal(panelMode(1366, 1024), 'side');
  assert.equal(panelMode(820, 1180), 'sheet');
  assert.equal(panelMode(768, 1024), 'sheet');
  assert.equal(panelMode(375, 812), 'strip');
  assert.equal(panelMode(PHONE_MAX - 1, 400), 'strip', 'a phone held sideways too');
});

test('roomFit: beside the side panel the globe moves right and fits the free space', () => {
  // Tablet landscape: a 1180 × 736 view, chips taking 60 px, the panel and its gaps 324 px.
  const side = roomFit({ w: 1180, h: 736, top: 60, left: 324 });
  assert.equal(side.dx, 162, 'centred in the space right of the panel');
  assert.ok(Math.abs(side.fit - (736 - 60) / 736) < 1e-9, 'as tall as the space under the chips');
  assert.equal(side.dy, 30);
  // A narrow window: the width left over decides, and the globe never shrinks below 55 %.
  const narrow = roomFit({ w: 700, h: 600, top: 60, left: 324 });
  assert.ok(Math.abs(narrow.fit - (700 - 324) / 600) < 1e-9, 'the width right of the panel decides');
  assert.ok(roomFit({ w: 700, h: 600, left: 650 }).fit >= 0.55);
  // Nothing in the way: the whole view.
  assert.deepEqual(roomFit({ w: 800, h: 600 }), { fit: 1, dx: 0, dy: 0 });
});

test('the panel never covers the chips, and the expanded sheet leaves part of the globe showing', () => {
  assert.match(css, /\.gpanel\[data-mode="side"\][^}]*top: calc\(var\(--gpanel-top/);
  assert.match(css, /max-height: min\(var\(--gpanel-sheet\)/);
  const view = src('js/views/globe.js');
  assert.match(view, /--gpanel-top/, 'the view sets the panel\'s top below the chips');
  assert.match(view, /globePanel/, 'the open / collapsed choice is remembered');
});
