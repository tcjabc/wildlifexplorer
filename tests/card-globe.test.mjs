// From a card's map to the globe and back: the range fit (with its zoom cap), what the card
// screen keeps to come back to, which maps open the globe, and the globe's data loading on
// its first open (offline: an error the view shows, and a retry that works once online).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rangeFit, FIT_K_MAX, loadLand } from '../js/globe.js';
import * as cardReturn from '../js/card-return.js';
const { opensGlobe } = cardReturn;

const src = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const box = (w, s, e, n) => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];

// ---------- range fit ----------

test(`a small range (Taiwan only) is capped at zoom ${FIT_K_MAX}, so the coasts around it still show`, () => {
  const taiwan = [box(120.0, 21.9, 122.0, 25.3)];
  const fit = rangeFit(taiwan);
  assert.equal(fit.k, FIT_K_MAX);
  assert.ok(Math.abs(fit.lon - 121) < 0.3 && Math.abs(fit.lat - 23.6) < 0.5, `centred on Taiwan (${fit.lon}, ${fit.lat})`);
  // At the cap the view still reaches past the Fujian coast and the Ryukyus: more than 8°.
  const reach = Math.asin(0.5 / (0.42 * FIT_K_MAX)) * 180 / Math.PI;
  assert.ok(reach > 8, `the view reaches ${reach.toFixed(1)}° from the centre`);
  // A tiny range (a single island) is capped the same way.
  assert.equal(rangeFit([box(121.5, 22.0, 121.6, 22.1)]).k, FIT_K_MAX);
});

test('a middling range fills part of the view; a wide one shows the whole globe', () => {
  const borneo = rangeFit([box(109, -4, 119, 7)]);
  assert.ok(borneo.k > 1.5 && borneo.k < FIT_K_MAX, `Borneo: zoom ${borneo.k.toFixed(2)}`);
  const africa = rangeFit([box(-17, -35, 51, 37)]);
  assert.equal(africa.k, 1);
  // A bigger range never zooms in further than a smaller one inside it.
  assert.ok(rangeFit([box(100, -10, 140, 20)]).k <= borneo.k);
});

test('a range across the antimeridian is centred on it, not on the other side of the world', () => {
  const fiji = rangeFit([box(176, -20, 180, -15), box(-180, -20, -178, -15)]);
  assert.ok(Math.abs(Math.abs(fiji.lon) - 180) < 3, `centre lon ${fiji.lon}`);
  assert.equal(rangeFit([]), null);
});

// ---------- coming back to the card ----------

test('the card screen is kept once for the card left, and only that card takes it', () => {
  cardReturn.remember({ cardId: 'formosan-black-bear', side: 'back', viaMap: true, notes: { expanded: true, view: 'pages', scope: { kind: 'animal', id: 'formosan-black-bear' }, pageId: 'p1' } });
  assert.equal(cardReturn.cameFromMap('formosan-black-bear'), true);
  assert.equal(cardReturn.cameFromMap('sika-deer'), false);
  assert.equal(cardReturn.take('sika-deer'), null, 'another card opens as usual');
  // take() for another card forgets it too: an old state never comes back later.
  assert.equal(cardReturn.take('formosan-black-bear'), null);

  cardReturn.remember({ cardId: 'formosan-black-bear', side: 'back', viaMap: false, notes: { expanded: false } });
  const s = cardReturn.take('formosan-black-bear');
  assert.equal(s.side, 'back');
  assert.deepEqual(s.notes, { expanded: false });
  assert.equal(cardReturn.take('formosan-black-bear'), null, 'once');
  assert.equal(cardReturn.cameFromMap('formosan-black-bear'), false);
  cardReturn.remember(null);
  assert.equal(cardReturn.take('formosan-black-bear'), null);
});

test('which side was showing', () => {
  assert.equal(cardReturn.sideOf({ p: 0, f: 0 }), 'front');
  assert.equal(cardReturn.sideOf({ p: 1, f: 0 }), 'inside');
  assert.equal(cardReturn.sideOf({ p: 0, f: 1 }), 'back');
  assert.deepEqual(cardReturn.SIDES, ['front', 'inside', 'back']);
});

test('the router keeps the card screen when leaving it, and gives it back coming from the globe', () => {
  const app = src('js/app.js');
  assert.match(app, /cardReturn\.remember\(viewer\.snapshot\(\)\)/);
  assert.match(app, /const restore = shown\.name === 'globe' \? cardReturn\.take\(card\.id\) : null;/);
  // Asked before the binder is drawn behind the card (which changes what is shown).
  assert.ok(app.indexOf("const restore = shown.name === 'globe'") < app.indexOf("if (binderGroup() !== card.group) renderMain"), 'restore is decided first');
  const viewer = src('js/viewer.js');
  assert.match(viewer, /restore\?\.side === 'back'\) v\.f = 1/);
  assert.match(viewer, /start: notes/, 'the notebook opens where it was');
});

// ---------- the map buttons ----------

test('only a card with a range, open in the viewer, gets a map that opens the globe', () => {
  const onMap = () => {};
  assert.equal(opensGlobe({ range: 'data/ranges/x.json' }, onMap), true);
  assert.equal(opensGlobe({ mapBounds: { west: 0, east: 1, south: 0, north: 1 } }, onMap), false, 'no range data: no button');
  assert.equal(opensGlobe({ range: 'data/ranges/x.json' }, undefined), false, 'in a pack reveal: a plain map');
  // Pack reveals build the cover without onMap.
  assert.match(src('js/reveal.js'), /coverPage\(card\)/);
  assert.match(src('js/viewer.js'), /coverPage\(card, \{ onCredit, onMap \}\)/);
  assert.match(src('js/viewer.js'), /backPage\(card, \{ onMap \}\)/);
});

test('the map is a tap target only: a drag that starts on it is still the card\'s', () => {
  // A plain button inside the card: the viewer's gestures start on it like on the other card
  // controls, and js/gesture.js stops the click after a real drag.
  assert.match(src('js/cardparts.js'), /h\('button', \{ class: \['map-open', cls\], type: 'button'/);
  const start = src('js/viewer.js').match(/start: \(\{ x, y, target \}\) => \{[\s\S]*?\n {4}\},/)[0];
  assert.doesNotMatch(start, /map-open/, 'drags may start on the map');
  assert.match(src('js/gesture.js'), /Stop the click that follows a drag or pinch/);
});

// ---------- the globe's data, first time offline ----------

test('offline the first time: the land fails to load, and loads on a retry once online', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(loadLand(), /Failed to fetch/);
    globalThis.fetch = async () => ({ ok: false, status: 504, json: async () => ({}) });
    await assert.rejects(loadLand(), /504/, 'an offline answer from the service worker counts too');
    const data = JSON.parse(src('assets/globe.json'));
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => data });
    const land = await loadLand();
    assert.ok(land.far.length > 0 && land.near.length > 0, 'it tries again, and loads');
  } finally { globalThis.fetch = real; }
});

test('the globe\'s data is not installed with the app: it is kept on its first open', () => {
  const sw = src('sw.js');
  const shell = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1];
  assert.doesNotMatch(shell, /globe\.json|home\.json|assets\/layers/);
  const rule = new RegExp(sw.match(/const GLOBE_FILE = \/(.+)\/;/)[1]);
  for (const p of ['/assets/globe.json', '/assets/home.json', '/assets/layers/depth.topo.json']) assert.ok(rule.test(p), p);
  assert.ok(!rule.test('/assets/world.svg'));
  assert.match(sw, /if \(GLOBE_FILE\.test\(url\.pathname\)\) event\.respondWith\(cacheFirst\(request, LAYER_CACHE\)\)/);
  assert.match(sw, /const LAYERS_VERSION = 'l\d+';/);
  // The view tells the child when it can't load, with Back to card still there.
  const view = src('js/views/globe.js');
  assert.match(view, /onLand: ok => \{ offline\.hidden = ok; \}/);
  assert.match(view, /tx\('globe\.offline'\)/);
  for (const lang of ['en', 'zh-TW']) {
    const s = JSON.parse(src(`lang/${lang}.json`));
    for (const k of ['globe.offline', 'globe.retry', 'globe.backToCard', 'card.mapToGlobe']) assert.ok(s[k], `${lang} ${k}`);
  }
});
