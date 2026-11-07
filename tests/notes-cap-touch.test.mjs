// Field Notes under real touches: the page's bitmap, the full page and the page's animal. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-cap-touch.test.mjs
import assert from 'node:assert/strict';
import { onPage, run, rail, openTagged, at, tape, paintsOn, fullPage } from './fixtures/notes-browser.mjs';

run('tweezers: what is selected comes out of the bitmap, moves without touching it, and goes back when let go', async f => {
  const [a] = await f.seed([[tape(500, 700), tape(500, 900)], []]);
  await f.show(a);
  const paper = await rail.pixel(f, 500, 1200);
  assert.notDeepEqual(await rail.pixel(f, 500, 700), paper);
  await rail.rack(f, 'tweezers');
  const at = onPage(500, 700), to = onPage(500, 400);
  await f.tap(at);
  assert.deepEqual(await rail.pixel(f, 500, 700), paper, 'held out of the page');
  const paints = await paintsOn(f, async () => {
    await f.send('touchStart', [{ ...at, id: 1 }]);
    for (let i = 1; i <= 6; i++) { await f.send('touchMove', [{ x: at.x, y: at.y + ((to.y - at.y) * i) / 6, id: 1 }]); await f.wait(20); }
    await f.send('touchEnd', []);
    await f.wait(100);
  });
  assert.equal(paints, 0, 'nothing drawn on the page while it moved');
  await f.tap(onPage(900, 1200));
  assert.notDeepEqual(await rail.pixel(f, 500, 400), paper, 'back on the page, where it was let go');
  assert.deepEqual(await rail.pixel(f, 500, 700), paper);
  assert.notDeepEqual(await rail.pixel(f, 500, 900), paper, 'the rest of the page as it was');
});

run('a page turned with something selected has it on the page, in the picture that turns too', async f => {
  const [a, b] = await f.seed([[tape(500, 700)], []]);
  await f.show(a);
  await rail.rack(f, 'tweezers');
  await f.tap(onPage(500, 700));
  await f.page.click('.nb__nav--next');
  await f.wait(60);
  assert.equal(await f.where(), b);
  const face = await f.page.evaluate(() => {
    const c = document.querySelector('.nb-leaf__face, .nb-bk__turn canvas');
    if (!c?.getContext) return null;
    const k = c.width / 1120;
    return [...c.getContext('2d').getImageData(Math.round(500 * k), Math.round(700 * k), 1, 1).data];
  });
  assert.ok(face, 'a picture of the page turns');
  assert.notDeepEqual(face.slice(0, 3), [251, 247, 236], 'with the tape on it');
});

run('a pinch scales the bitmap: nothing is drawn on it, even on a very full page', async f => {
  const id = await f.page.evaluate(async () => {
    const { heavyItems } = await import('/js/notes-debug.js');
    const ids = await t.seed([heavyItems(t.state.cards.filter(c => c.silhouette?.file).map(c => c.id), 1120, 1400)]);
    return ids[0];
  });
  await f.show(id);
  assert.equal((await f.items(id)).length, 420, '400 stamps and 20 trails, as saved');
  const c = onPage(560, 700);
  const paints = await paintsOn(f, async () => {
    await f.send('touchStart', [{ x: c.x - 40, y: c.y, id: 1 }, { x: c.x + 40, y: c.y, id: 2 }]);
    for (let i = 1; i <= 8; i++) { await f.send('touchMove', [{ x: c.x - 40 - i * 15, y: c.y, id: 1 }, { x: c.x + 40 + i * 15, y: c.y, id: 2 }]); await f.wait(20); }
  });
  assert.equal(paints, 0);
  assert.notEqual(await f.transform(), 'matrix(1, 0, 0, 1, 0, 0)');
  await f.send('touchEnd', []);
  await f.wait(200);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb__detail').hidden), false, 'the sharp view once it settles');
});

run('a full page: the note comes when the tap or the trail lands on something too', async f => {
  const ids = await rail.collect(f, 1);
  const [a] = await f.seed([fullPage(), []]);
  await f.show(a);
  const note = () => f.page.evaluate(() => document.querySelector('.nb__toast--note')?.textContent ?? '');
  const clear = () => f.page.evaluate(() => document.querySelector('.nb__toast')?.remove());
  const on = onPage(400, 400);
  await rail.rack(f, 'washi');
  await f.tap(on);
  assert.match(await note(), /Page full/);
  await clear();
  await rail.rack(f, 'roller');
  await f.send('touchStart', [{ ...on, id: 1 }]);
  await f.send('touchMove', [{ x: on.x + 80, y: on.y, id: 1 }]);
  await f.wait(30);
  await f.send('touchEnd', []);
  await f.wait(100);
  assert.match(await note(), /Page full/);
  assert.equal(await f.box('.nb-sel'), undefined, 'a trail that can\'t be laid selects nothing');
  await clear();
  await rail.rack(f, 'stamp');
  await f.page.mouse.click(5, 5);
  await f.tap(on);
  assert.match(await note(), /Page full/);
  await f.wait(450);
  assert.equal((await f.items(a)).length, 150);
  assert.equal(ids.length, 1);
});

run('a full page: a note on the desk and nothing placed; lines still draw, and old pages keep everything', async f => {
  const [a] = await f.seed([fullPage(), []]);
  await f.show(a);
  const note = () => f.page.evaluate(() => document.querySelector('.nb__toast--note')?.textContent ?? '');
  const spot = onPage(1000, 1300);
  await rail.rack(f, 'washi');
  await f.tap(spot);
  assert.match(await note(), /Page full/);
  await rail.rack(f, 'roller');
  await f.page.evaluate(() => document.querySelector('.nb__toast')?.remove());
  await f.send('touchStart', [{ ...spot, id: 1 }]);
  await f.send('touchMove', [{ x: spot.x - 100, y: spot.y, id: 1 }]);
  await f.wait(30);
  await f.send('touchEnd', []);
  await f.wait(100);
  assert.match(await note(), /Page full/);
  await rail.rack(f, 'text');
  await f.page.evaluate(() => document.querySelector('.nb__toast')?.remove());
  await f.tap(spot);
  assert.equal(await f.box('.nb-text'), undefined);
  assert.match(await note(), /Page full/);
  await f.page.waitForTimeout(450);
  assert.equal((await f.items(a)).length, 150, 'nothing placed');
  await rail.pick(f, 'pencil');
  await f.send('touchStart', [{ ...spot, id: 1 }]);
  await f.send('touchMove', [{ x: spot.x - 60, y: spot.y, id: 1 }]);
  await f.wait(30);
  await f.send('touchEnd', []);
  await f.wait(600);
  assert.equal((await f.items(a)).length, 151, 'a line is no object');
});

run('a page linked to an animal has its silhouette in the corner of the paper; a topic card or no link, plain paper', async f => {
  const [animal, topic] = await f.page.evaluate(() => [t.state.cards.find(c => c.silhouette?.file && c.group === 'mammals').id, t.state.cards.find(c => c.group === 'conservation').id]);
  const [a, b, c] = await f.seed([[], [], []]);
  const ink = () => f.page.evaluate(() => {
    const cv = document.querySelector('.nb__base'), x = cv.getContext('2d'), k = cv.width / 1120;
    const d = x.getImageData(Math.round(600 * k), Math.round(900 * k), Math.round(480 * k), Math.round(460 * k)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 245 || d[i + 2] < 215) n++; // darker than paper; the dots count a little
    return n;
  });
  await f.show(c);
  await f.wait(300);
  const freeInk = await ink();
  await openTagged(f, b, topic);
  await f.wait(300);
  const topicInk = await ink();
  await openTagged(f, a, animal);
  await f.wait(300);
  const animalInk = await ink();
  assert.equal(topicInk, freeInk, 'a topic card stays plain');
  assert.ok(animalInk > freeInk * 3, 'the animal is there');
  await f.page.evaluate(() => document.querySelector('.nb-tag__x').click());
  await f.wait(300);
  assert.equal(await ink(), freeInk, 'taking the tag off takes the silhouette');
});

run('the silhouette is no object: not in the page, not counted, and the sponge leaves it', async f => {
  const animal = await f.page.evaluate(() => t.state.cards.find(c => c.silhouette?.file && c.group === 'mammals').id);
  const [a] = await f.seed([[], []]);
  await openTagged(f, a, animal);
  await f.wait(300);
  const before = await f.page.evaluate(() => document.querySelector('.nb__base').toDataURL());
  await rail.rack(f, 'sponge');
  const at = onPage(850, 1150);
  await f.send('touchStart', [{ ...at, id: 1 }]);
  await f.send('touchMove', [{ x: at.x + 60, y: at.y, id: 1 }]);
  await f.wait(40);
  await f.send('touchEnd', []);
  await f.wait(150);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb__base').toDataURL()), before);
  assert.deepEqual(await f.items(a), []);
});
