// The size comparison's pictures: every one exists, the everyday figures are traced from photos
// (scripts/make-figures.mjs), not the old hand-drawn shapes, and the app's sizes and credits match
// the files. Plus the tracing geometry (scripts/lib/trace.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { PARTNERS, compareImage } from '../js/compare-data.js';
import { FIGURES } from '../scripts/figures.config.mjs';
import { bend, bezier, bounds, resample, simplify, smoothPath, taper, trace } from '../scripts/lib/trace.mjs';

const read = f => readFile(new URL(`../${f}`, import.meta.url), 'utf8');
const cards = JSON.parse(await read('data/animals.json'));
const lookalikes = JSON.parse(await read('data/lookalikes.json'));
const viewBox = svg => svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/).slice(1).map(Number);
// The people stay drawn (owner's choice, 2026-11-14); everything else is traced.
const DRAWN = ['assets/child.svg', 'assets/grown-up.svg'];

test('every picture a comparison draws is there', async () => {
  const files = new Set([...DRAWN, ...Object.values(PARTNERS).map(p => p.img)]);
  for (const c of cards) if (compareImage(c)) files.add(compareImage(c));
  for (const e of Object.values(lookalikes.entries ?? {})) if (e.silhouette?.file) files.add(e.silhouette.file);
  for (const f of files) {
    const s = await stat(new URL(`../${f}`, import.meta.url));
    assert.ok(s.size > 100, `${f} is empty`);
    if (f.endsWith('.svg')) {
      const [w, h] = viewBox(await read(f));
      assert.ok(w > 0 && h > 0, `${f}: a viewBox`);
    }
  }
});

test('the everyday figures are traced from photos, not the old drawn shapes', async () => {
  const traced = Object.values(FIGURES).map(f => f.file);
  // Every comparison picture in assets/ is either a drawn person or a traced figure.
  const inAssets = [...Object.values(PARTNERS).map(p => p.img), ...cards.map(compareImage).filter(f => f?.startsWith('assets/'))];
  for (const f of inAssets) assert.ok(DRAWN.includes(f) || traced.includes(f), `${f}: drawn by hand`);
  for (const fig of Object.values(FIGURES)) {
    const svg = await read(fig.file);
    assert.match(svg, /Traced by scripts\/make-figures\.mjs/, `${fig.file}: made by the script`);
    assert.doesNotMatch(svg, /Drawn for WildFile|<ellipse|<rect|<polygon|stroke=/, `${fig.file}: none of the old shapes`);
    const [w, h] = viewBox(svg);
    assert.equal(Math.max(w, h), 1000, `${fig.file}: 1000 units on its long side`);
    assert.match(svg, new RegExp(`width="${w}" height="${h}"`), `${fig.file}: its size, so <img> knows its shape`);
    assert.ok(Buffer.byteLength(svg) <= 8 * 1024, `${fig.file}: small (${Buffer.byteLength(svg)} bytes)`);
    assert.ok(svg.includes(fig.sourceUrl), `${fig.file}: says where it comes from`);
  }
});

test('the app draws each figure at the size and shape its file says, and credits its photo', async () => {
  for (const fig of Object.values(FIGURES)) {
    const svg = await read(fig.file);
    const [w, h] = viewBox(svg);
    const cm = Number(svg.match(/, ([\d.]+) cm (across|tall)\./)[1]);
    const partner = Object.values(PARTNERS).find(p => p.img === fig.file);
    const card = cards.find(c => c.compare?.silhouette?.file === fig.file);
    assert.ok(partner || card, `${fig.file} is used`);
    const credit = partner?.credit ?? card.compare.silhouette;
    for (const k of ['author', 'license', 'sourceUrl']) assert.equal(credit[k], fig[k], `${fig.file}: ${k}`);
    assert.equal(credit.licenseUrl, fig.licenseUrl, `${fig.file}: licenceUrl`);
    if (partner) {
      assert.ok(Math.abs(partner.ratio - h / w) < 0.001, `${partner.id}: ratio ${partner.ratio} vs ${h / w}`);
      assert.equal(partner.across, fig.measure.across, `${partner.id}: measured the same way`);
      assert.ok(Math.abs(partner.cm / cm - 1) < 0.02, `${partner.id}: ${partner.cm} cm vs ${cm} cm in the file`);
    } else {
      assert.ok(Math.abs(card.compare.height / cm - 1) < 0.02, `${card.id}: ${card.compare.height} cm vs ${cm}`);
    }
  }
});

test('scale stays true: a car is still about 3.6 children long, a cat about half a child tall', () => {
  // A 120 cm child beside the figures, in cm.
  const car = PARTNERS.car, cat = PARTNERS.cat;
  assert.ok(Math.abs(car.cm / 120 - 3.57) < 0.05);
  assert.ok(Math.abs(car.cm * car.ratio - 144) < 3, `the car is ${car.cm * car.ratio} cm high (a Golf: 144)`);
  const catHigh = cat.cm * cat.ratio;
  assert.ok(catHigh > 25 && catHigh < 45, `the cat is ${catHigh} cm to the top of its ears or tail`);
  // The hair's box is its bend: taller than the hair is thick, not hugely so.
  const hairHigh = PARTNERS.hair.cm * PARTNERS.hair.ratio;
  assert.ok(hairHigh > PARTNERS.hair.showCm && hairHigh < 3 * PARTNERS.hair.showCm, `the hair's box is ${hairHigh} cm high`);
});

// ---------- geometry ----------

const square = (w, h, x0, y0, x1, y1) => Uint8Array.from({ length: w * h }, (_, i) => {
  const x = i % w, y = (i - x) / w;
  return x >= x0 && x < x1 && y >= y0 && y < y1 ? 1 : 0;
});

test('trace walks the outer edge of a shape, corners only', () => {
  assert.deepEqual(trace(square(6, 5, 1, 1, 4, 3), 6, 5), [[1, 1], [4, 1], [4, 3], [1, 3]]);
  // An L: six corners, clockwise on screen.
  const L = square(5, 5, 1, 1, 2, 4).map((v, i) => v || (i % 5 >= 1 && i % 5 < 4 && Math.floor(i / 5) === 3 ? 1 : 0));
  assert.deepEqual(trace(L, 5, 5), [[1, 1], [2, 1], [2, 3], [4, 3], [4, 4], [1, 4]]);
  assert.deepEqual(trace(new Uint8Array(9), 3, 3), []);
});

test('simplify keeps the shape within eps; resample and smoothPath close it', () => {
  const stairs = [];
  for (let i = 0; i < 20; i++) stairs.push([i, i], [i + 1, i]);
  const pts = [...stairs, [20, 20], [0, 20]];
  const s = simplify(pts, 1);
  assert.ok(s.length < 8, `stairs become a line: ${s.length} points`);
  const even = resample([[0, 0], [10, 0], [10, 10], [0, 10]], 2);
  assert.equal(even.length, 20);
  assert.equal(smoothPath([[0, 0], [10, 0], [10, 10]]), 'M5 5Q0 0 5 0Q10 0 10 5Q10 10 5 5Z');
});

test('taper and bend: a stroke narrows to a round tip, a strip bends without losing its ends', () => {
  const line = bezier([[0, 0], [50, 0], [100, 0]], 10);
  assert.deepEqual(line[0], [0, 0]);
  assert.deepEqual(line[10], [100, 0]);
  const o = taper(line, 10, 2);
  const b = bounds([o]);
  assert.ok(Math.abs(b.h - 10) < 1e-9 && Math.abs(b.x1 - 101) < 1e-9, 'as wide as w0, the tip a half circle past the end');
  const strip = [[0, -1], [100, -1], [100, 1], [0, 1]];
  const bent = bend(strip, { x0: 0, x1: 100, yc: 0 }, t => 0.1 * Math.sin(2 * Math.PI * t), t => 1 - t / 2);
  assert.ok(Math.abs(Math.hypot(...bent[0]) - 1) < 1e-6, 'the near end keeps its thickness');
  assert.ok(Math.abs(Math.hypot(bent[1][0] - 100, bent[1][1]) - 0.5) < 1e-6, 'the far end is half as thick');
  assert.deepEqual(bounds([[[0, 0]]], [[5, 5, 2]]), { x0: 0, y0: 0, x1: 7, y1: 7, w: 7, h: 7 });
});
