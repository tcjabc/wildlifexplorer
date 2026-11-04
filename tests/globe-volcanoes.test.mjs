// Volcanoes (scripts/make-layers.mjs volcanoes): NOAA NCEI's locations, the notable ones first,
// last eruptions as periods, Taiwan's two written by hand with sources, every place and
// period with its words in both languages, and the credit.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { LAYER_CREDITS } from '../js/layers.js';

const url = path => new URL(`../${path}`, import.meta.url);
const src = path => readFileSync(url(path), 'utf8');
const d = JSON.parse(src('assets/layers/volcanoes.json'));
const en = JSON.parse(src('lang/en.json')), zh = JSON.parse(src('lang/zh-TW.json'));
const overrides = JSON.parse(src('data/volcano-overrides.json'));
const list = d.v.map(([lon, lat, notable, last, place, nameEn, nameZh]) => ({ lon: lon / 100, lat: lat / 100, notable, last, place, nameEn, nameZh }));

test('about 1,600 volcanoes, a few hundred notable ones first, in a small file', () => {
  assert.deepEqual(d.fields, ['lon', 'lat', 'notable', 'last', 'place', 'en', 'zh']);
  assert.ok(list.length > 1500 && list.length < 1700, `${list.length}`);
  const notable = list.filter(v => v.notable).length;
  assert.ok(notable >= 200 && notable <= 400, `${notable} notable`);
  const firstOther = list.findIndex(v => !v.notable);
  assert.ok(list.slice(firstOther).every(v => !v.notable), 'the notable ones come first (drawn first, and alone zoomed out)');
  for (const v of list) assert.ok(Math.abs(v.lon) <= 180 && Math.abs(v.lat) <= 90);
  assert.ok(statSync(url('assets/layers/volcanoes.json')).size < 100 * 1024);
});

test('notable: erupted since 1964, and Taiwan\'s', () => {
  for (const v of list) if (v.last === 'D1') assert.equal(v.notable, 1, v.nameEn);
  const taiwan = list.filter(v => v.place === 'TW' && v.notable).map(v => v.nameEn);
  assert.ok(taiwan.includes('Tatun Volcanic Group') && taiwan.includes('Kueishantao (Turtle Island)'), taiwan.join(', '));
});

test('Taiwan\'s volcanoes: hand-written, in Taiwan, with sources; Tatun\'s last eruption uncertain', () => {
  for (const [num, o] of Object.entries(overrides)) {
    if (num.startsWith('_')) continue;
    assert.ok(o.sources?.length >= 2, `${o.name.en}: sources`);
    const v = list.find(x => x.nameEn === o.name.en);
    assert.ok(v, o.name.en);
    assert.equal(v.nameZh, o.name.zh);
    assert.equal(v.place, 'TW');
    assert.equal(v.last, o.last);
  }
  assert.equal(list.find(v => v.nameEn === 'Tatun Volcanic Group').last, 'uncertain');
  assert.equal(list.find(v => v.nameEn === 'Tatun Volcanic Group').nameZh, '大屯火山群');
  assert.equal(list.find(v => v.nameEn.startsWith('Kueishantao')).nameZh, '龜山島');
  // Nothing NCEI places in Taiwan is shown elsewhere.
  for (const v of list) if (v.lon > 119.3 && v.lon < 122.2 && v.lat > 21.8 && v.lat < 25.4) assert.notEqual(v.place, 'CN', v.nameEn);
});

test('every place and every last-eruption period has its words in both languages', () => {
  const lasts = new Set(list.map(v => v.last));
  for (const l of lasts) { assert.ok(en[`volcano.last.${l}`], `en ${l}`); assert.ok(zh[`volcano.last.${l}`], `zh ${l}`); }
  for (const v of list) {
    if (v.place.startsWith('sea:')) { const k = `volcano.sea.${v.place.slice(4)}`; assert.ok(en[k] && zh[k], k); }
    else assert.match(v.place, /^[A-Z]{2}$/, `${v.nameEn}: an ISO country code`);
  }
  for (const k of ['volcano.last', 'volcano.unnamed', 'volcano.close', 'info.plates.key.volcano']) assert.ok(en[k] && zh[k], k);
  // NCEI's back-to-front names are turned round.
  assert.ok(list.some(v => v.nameEn === 'Piton de la Fournaise'));
  assert.ok(!list.some(v => /^[^,]+, [^,]+$/.test(v.nameEn)), 'no "Name, First" left');
});

test('zh names only in Traditional script sources, and the notable ones listed for checking', () => {
  const make = src('scripts/make-layers.mjs');
  assert.match(make, /FILTER\(LANG\(\?tw\) = "zh-tw"\)/);
  assert.match(make, /FILTER\(LANG\(\?hant\) = "zh-hant"\)/);
  assert.doesNotMatch(make, /LANG\(\?\w+\) = "zh"\)/, 'never plain zh (often Simplified)');
  const review = src('data/volcano-names-review.md');
  assert.match(review, /\| Tatun Volcanic Group \| 大屯火山群 \| TW \|/);
});

test('drawn as planned and credited: NCEI, public domain; Wikidata, CC0', () => {
  const g = src('js/globe.js');
  assert.match(g, /const VOLC_ALL_K = 2\.5, VOLC_HIT = 22;/, 'all of them from zoom 2.5; a 44 px touch target');
  assert.match(g, /if \(!v\.notable && !all\) break;/);
  const c = LAYER_CREDITS.find(x => x.layer === 'plates' && /NCEI/.test(x.author));
  assert.match(c.license, /Public domain/);
  assert.match(c.author, /Wikidata \(CC0\)/);
  assert.match(src('CREDITS.md'), /NOAA.*NCEI.*Volcano Locations Database.*Public domain/);
});
