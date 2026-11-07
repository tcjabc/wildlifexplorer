// Field Notes under real touches: zoom and pan, and what two fingers mean. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-zoom-touch.test.mjs
import assert from 'node:assert/strict';
import { LEFT, stroke, open, zoomOf, run, rail, at } from './fixtures/notes-browser.mjs';

run('two fingers zoom without marking the page, and the sharp canvas stays screen sized', async f => {
  const [a] = await f.seed([[stroke(200, 400)], []]);
  await f.show(a);
  await f.two([{ x: 540, y: 400 }, { x: 740, y: 400 }], [{ x: 390, y: 400 }, { x: 890, y: 400 }]);
  assert.ok(zoomOf(await f.transform()) > 2, await f.transform());
  assert.equal((await f.items(a)).length, 1);
  const detail = await f.page.evaluate(() => { const c = document.querySelector('.nb__detail'); return { hidden: c.hidden, w: c.width, h: c.height }; });
  assert.equal(detail.hidden, false);
  assert.ok(detail.w <= 585 * 1.5 + 1 && detail.h <= 732 * 1.5 + 1, JSON.stringify(detail));
  const base = await f.page.evaluate(() => document.querySelector('.nb__base').width);
  assert.ok(base < 900, 'the page bitmap stays at the fitted size');
});

run('drawing while zoomed in lands where the finger is', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.two([{ x: 540, y: 400 }, { x: 740, y: 400 }], [{ x: 440, y: 400 }, { x: 840, y: 400 }]); // 2x around x 640
  const before = await f.page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.nb__book')).transform);
    const desk = document.querySelector('.nb__desk').getBoundingClientRect(), sheet = document.querySelector('.nb__sheet');
    const unit = sheet.offsetWidth / 1120;
    return { x: (640 - desk.left - m.e) / m.a / unit, y: (300 - desk.top - m.f) / m.d / unit };
  });
  await f.drag({ x: 640, y: 300 }, { x: 700, y: 300 });
  const [mark] = await f.items(a);
  assert.ok(Math.abs(mark.p[0] - before.x) < 2 && Math.abs(mark.p[1] - before.y) < 2, JSON.stringify([mark.p.slice(0, 2), before]));
});

run('a clear two-finger swipe up turns the page, and down turns it back; a pinch never does', async f => {
  const [a] = await f.seed([[], [], [], []]);
  await f.show(a);
  // A pinch drifting up the whole way.
  await f.two([{ x: 600, y: 700 }, { x: 700, y: 700 }], [{ x: 500, y: 200 }, { x: 700, y: 200 }]);
  assert.equal(await f.place(), 1, 'a pinch that drifts does not turn');
  await f.page.evaluate(() => t.open(t.ids()[0]));
  await f.wait(600);
  // Only just a pinch: 6% apart at the widest, then back.
  await f.two([{ x: 500, y: 700 }, { x: 700, y: 700 }], [{ x: 500, y: 300 }, { x: 712, y: 300 }]);
  assert.equal(await f.place(), 1, 'over 5% is a pinch');
  await f.page.evaluate(() => t.open(t.ids()[0]));
  await f.wait(600);
  // Too short.
  await f.two([{ x: 500, y: 700 }, { x: 700, y: 700 }], [{ x: 500, y: 640 }, { x: 700, y: 640 }]);
  assert.equal(await f.place(), 1, 'too short');
  // Too slanted.
  await f.two([{ x: 500, y: 600 }, { x: 700, y: 600 }], [{ x: 600, y: 400 }, { x: 800, y: 400 }]);
  assert.equal(await f.place(), 1, 'not straight up');
  // Sideways is nothing here.
  await f.two([{ x: 700, y: 300 }, { x: 900, y: 300 }], [{ x: 400, y: 300 }, { x: 600, y: 300 }]);
  assert.equal(await f.place(), 1, 'not sideways');
  // Clear.
  await f.two([{ x: 500, y: 700 }, { x: 700, y: 700 }], [{ x: 500, y: 400 }, { x: 700, y: 400 }]);
  assert.equal(await f.place(), 2, 'one page on');
  await f.two([{ x: 500, y: 300 }, { x: 700, y: 300 }], [{ x: 500, y: 600 }, { x: 700, y: 600 }]);
  assert.equal(await f.place(), 1, 'and back');
});

run('fingers 60 px apart turn the page with 8 px of drift, but not with 14', async f => {
  const [a] = await f.seed([[], [], [], []]);
  await f.show(a);
  await f.two([{ x: 600, y: 700 }, { x: 660, y: 700 }], [{ x: 600, y: 400 }, { x: 668, y: 400 }]);
  assert.equal(await f.place(), 2, '8 px of drift turns the page');
  await f.two([{ x: 600, y: 300 }, { x: 660, y: 300 }], [{ x: 600, y: 600 }, { x: 674, y: 600 }]);
  assert.equal(await f.place(), 2, '14 px is a pinch');
});

run('zoomed in, a two-finger swipe pans instead of turning', async f => {
  const [a] = await f.seed([[], [], []]);
  await f.show(a);
  await f.two([{ x: 540, y: 400 }, { x: 740, y: 400 }], [{ x: 440, y: 400 }, { x: 840, y: 400 }]);
  const m1 = await f.transform();
  await f.two([{ x: 500, y: 700 }, { x: 700, y: 700 }], [{ x: 500, y: 400 }, { x: 700, y: 400 }]);
  assert.equal(await f.place(), 1);
  assert.notEqual(await f.transform(), m1);
});

run('a second finger soon after the first is a gesture; a late one leaves the line alone', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  // Soon: nothing is drawn.
  await f.send('touchStart', [{ ...LEFT, id: 1 }]);
  await f.wait(40);
  await f.send('touchStart', [{ ...LEFT, id: 1 }, { x: LEFT.x + 100, y: LEFT.y, id: 2 }]);
  await f.wait(40);
  await f.send('touchEnd', []);
  await f.wait(550);
  assert.equal((await f.page.evaluate(i => t.items(i), a)).length, 0);
  // Late: the line goes on.
  await f.send('touchStart', [{ ...LEFT, id: 1 }]);
  await f.send('touchMove', [{ x: LEFT.x + 50, y: LEFT.y, id: 1 }]);
  await f.wait(260);
  await f.send('touchStart', [{ x: LEFT.x + 50, y: LEFT.y, id: 1 }, { x: 800, y: 200, id: 2 }]);
  await f.send('touchMove', [{ x: LEFT.x + 120, y: LEFT.y, id: 1 }, { x: 800, y: 200, id: 2 }]);
  await f.wait(30);
  await f.send('touchEnd', []);
  await f.wait(550);
  const items = await f.items(a);
  assert.equal(items.length, 1);
  assert.equal(zoomOf(await f.transform()), 1);
});

run('the magnifying glass zooms by steps, back to the whole page, with no second finger', async f => {
  const [a] = await f.seed([[stroke(200, 400)], []]);
  await f.show(a);
  const b = await f.box('.nb-rack[data-rack="zoom"]');
  assert.ok(b.w >= 44 && b.h >= 44);
  await rail.rack(f, 'zoom');
  await f.page.click('[data-zoom="in"]');
  await f.wait(100);
  assert.ok(Math.abs(zoomOf(await f.transform()) - 1.5) < 0.01);
  await f.page.click('[data-zoom="in"]');
  await f.wait(100);
  assert.ok(Math.abs(zoomOf(await f.transform()) - 2.25) < 0.01, 'the glass stays open for another step');
  await f.page.click('[data-zoom="out"]');
  await f.wait(100);
  assert.ok(Math.abs(zoomOf(await f.transform()) - 1.5) < 0.01);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb__detail').hidden), false, 'sharp');
  await f.page.click('[data-zoom="reset"]');
  await f.wait(100);
  assert.equal(zoomOf(await f.transform()), 1);
  assert.equal((await f.items(a)).length, 1);
});
