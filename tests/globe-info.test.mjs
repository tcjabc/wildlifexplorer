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
import { roomFit, WIDE_SHARE } from '../js/globe.js';
const RADIUS_K = 0.42; // the globe's radius at zoom 1, a share of the smaller side (js/globe.js RADIUS)

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

test('only the plain map has animal rows: all three of its rows, which dim while pins are hidden', () => {
  assert.deepEqual(INFO.everywhere.key.map(k => k.animals), [true, true, true]);
  for (const [id, info] of Object.entries(INFO)) {
    if (id !== 'everywhere' && Array.isArray(info.key)) assert.ok(info.key.every(k => !k.animals), id);
  }
  assert.ok(css.includes('.pins-off .gkey__item--animals { opacity: var(--o-dimmed); }'));
  assert.match(tokens, /--o-dimmed:/);
});

test('the paw button says what a tap will do, in both languages', () => {
  for (const k of ['globe.pins.hide', 'globe.pins.show']) {
    assert.ok(en[k]?.trim() && zh[k]?.trim(), k);
    assert.notEqual(zh[k], en[k], k);
  }
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
  for (const t of ['--gpanel-w', '--gpanel-art', '--gpanel-sheet', '--c-twilight']) assert.ok(tokens.includes(`${t}:`), t);
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

test('where the toolbar goes: down the left on a tablet either way up, a strip on a phone', () => {
  assert.equal(panelMode(1180, 820), 'side');
  assert.equal(panelMode(1366, 1024), 'side');
  assert.equal(panelMode(820, 1180), 'side');
  assert.equal(panelMode(768, 1024), 'side');
  assert.equal(panelMode(375, 812), 'strip');
  assert.equal(panelMode(PHONE_MAX - 1, 400), 'strip', 'a phone held sideways too');
});

test('roomFit: beside the side panel the globe moves right and fits the free space', () => {
  // Tablet landscape: a 1180 × 736 view, chips taking 60 px, the panel and its gaps 324 px.
  const side = roomFit({ w: 1180, h: 736, top: 60, left: 324 });
  assert.equal(side.dx, 162, 'centred in the space right of the panel');
  // Wider than tall beside the panel: the globe grows to WIDE_SHARE of the free height.
  assert.ok(Math.abs(side.fit * RADIUS_K * 736 - WIDE_SHARE * (736 - 60)) < 1e-6, 'grown into the spare width');
  assert.ok(side.fit > (736 - 60) / 736, 'bigger than before the panel feedback');
  assert.ok(2 * side.fit * RADIUS_K * 736 < 736 - 60, 'still under the chips and above the bottom');
  assert.ok(2 * side.fit * RADIUS_K * 736 < 1180 - 324, 'and inside the width beside the panel');
  assert.equal(side.dy, 30);
  // A narrow window: the width left over decides, and the globe never shrinks below 55 %.
  const narrow = roomFit({ w: 700, h: 600, top: 60, left: 324 });
  assert.ok(Math.abs(narrow.fit * RADIUS_K * 600 - 0.46 * (700 - 324)) < 1e-9, 'the width right of the panel decides');
  assert.ok(roomFit({ w: 700, h: 600, left: 650 }).fit >= 0.55);
  // Nothing in the way: the whole view.
  assert.deepEqual(roomFit({ w: 800, h: 600 }), { fit: 1, dx: 0, dy: 0 });
});

test('roomFit: portrait keeps the globe at full size, the toolbar floating over its corner', () => {
  const portrait = roomFit({ w: 800, h: 1196, top: 60 });
  assert.equal(portrait.fit, 1);
  assert.equal(portrait.dx, 0);
  assert.match(src('js/views/globe.js'), /const left = panel\.dataset\.over === 'true' \? 0 : room;/);
});

test('the toolbar keeps clear of Back to card and the filters, and a phone\'s open strip leaves part of the globe showing', () => {
  assert.match(css, /\.gpanel\[data-mode="side"\][^}]*top: calc\(var\(--gtool-top/);
  assert.match(css, /\.gtop \{[^}]*left: max\(var\(--edge-l\), var\(--gtool-room/);
  assert.match(css, /max-height: min\(var\(--gpanel-sheet\)/);
  const view = src('js/views/globe.js');
  assert.match(view, /--gtool-room/, 'the view moves the top row clear of the toolbar');
  assert.match(view, /--gpanel-top/, 'and keeps a phone\'s strip below it');
  assert.match(view, /globePanel/, 'the open / collapsed choice is remembered');
});

test('the toolbar: hero, key, and the button at the bottom; rows on one fixed icon column', () => {
  const view = src('js/views/globe.js');
  assert.match(view, /'aria-label': label\('info\.what'\) \}, hero, panelBody, panelToggle\)/);
  assert.match(css, /\.gkey__item \{[^}]*grid-template-columns: var\(--legend-sw\) minmax\(0, 1fr\)/);
  assert.match(css, /\.gpanel__body \{[^}]*flex: 0 1 auto/, 'the card is as tall as what it shows, and scrolls inside');
  assert.doesNotMatch(css, /\.gpanel\[data-mode="side"\]\[data-state/, 'one width, open or not');
  assert.doesNotMatch(css, /\.gpanel\[data-mode="side"\] \{[^}]*bottom:/, 'no full-height column');
  assert.doesNotMatch(view, /glayers/, 'the ribbon is gone');
  assert.match(css, /\.gpanel__toggle \{[^}]*width: 100%; height: var\(--tap-xs\)/, 'the whole bottom row is the button');
  assert.match(view, /const up = open === \(panel\.dataset\.mode === 'side'\);/, 'the chevron points the way the panel will move');
});

test('the key swatches are 24 px, in the map\'s own colours, with their marks inside', async () => {
  assert.match(tokens, /--legend-sw: 24px;/);
  for (const k of INFO.relief.key) assert.ok(k.mark, 'topography: a mark in each swatch');
  for (const k of INFO.forests.key) assert.ok(k.tree, 'forests: a tree in each swatch');
  assert.equal(INFO.reefs.key[0].paint, 'reef', 'reefs: the see-through fill on the sea');
  assert.equal(INFO.reefs.key[0].token, '--c-reef-fill');
  assert.deepEqual(INFO.night.key.map(k => k.paint ?? null), [null, 'dusk', 'night', 'lights'], 'night: the land under the overlay');
  // The topography swatches are the picture's colours where those lands are.
  const { createRequire } = await import('node:module');
  const sharp = createRequire(import.meta.url)('sharp');
  const { data, info } = await sharp(new URL('../assets/layers/relief-4k.webp', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (lon, lat) => { const x = Math.floor(((lon + 180) / 360) * info.width), y = Math.floor(((90 - lat) / 180) * info.height), i = (y * info.width + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const hex = name => tokens.match(new RegExp(`${name}: #([0-9a-f]{6})`))[1].match(/../g).map(x => parseInt(x, 16));
  const near = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i]))) < 40;
  assert.ok(near(at(-62, -4), hex('--c-relief-low')), 'the Amazon lowlands');
  assert.ok(near(at(12, 24), hex('--c-relief-dry')), 'the Sahara');
  assert.ok(near(at(88, 33), hex('--c-relief-high')), 'the Tibetan plateau');
});

test('the open depth guide shows a zone\'s name once when the kid name and the scientific name are the same', () => {
  const same = INFO.depth.zones.map((z, i) => zh[z.sci] === zh[INFO.depth.key[i].label].split(' · ').pop());
  assert.deepEqual(same, [false, false, false, true, false], '深淵帶 is both, for 4,000–6,000 m');
  const view = src('js/views/globe.js');
  assert.match(view, /function sciName\(k, zone\)/);
  assert.match(view, /\['en', 'zh'\]\.filter\(l => !same\(l\)\)/, 'only the language that adds something');
});

test('the panel reads at about 16 px, with headings to match and bigger drawings', () => {
  assert.match(css, /\.gpanel \{[^}]*font-size: var\(--fs-sm\);/);
  assert.match(tokens, /--fs-sm: 1rem;/);
  assert.match(css, /\.gtile--hero \{[^}]*font-size: var\(--fs-sm\);/);
  assert.match(css, /\.gpanel__heading \{[^}]*font-size: var\(--fs-sm\);/);
  assert.match(tokens, /--gpanel-art: 280px;/, 'drawings over twice as big as before (132 px)');
});
