// Field Notes under real touches: what else is in the tray: the stamp picker, the sponge, washi tape and the Polaroids. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-tray-touch.test.mjs
import assert from 'node:assert/strict';
import { onPage, stroke, label, tweezers, run, rail, openTagged, STAMP, TRAIL, at, shot, photosOn, tabs, tape, PORTRAIT } from './fixtures/notes-browser.mjs';

run('in portrait the popover stays on the screen: the ink pad at the top opens downward', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.click('.nb-rack--ink');
  const pop = await f.box('.nb-pop--rail'), pad = await f.box('.nb-rack--ink');
  assert.ok(pop.y >= pad.y + pad.h - 1);
}, PORTRAIT);

run('a long press on the panda stamp shows them the binder\'s way: its groups as tabs, only stamps, thumbnails loaded lazily', async f => {
  await rail.collect(f, 3);
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const b = await f.box('.nb-rack[data-rack="stamp"]');
  await f.send('touchStart', [{ x: b.x + b.w / 2, y: b.y + b.h / 2, id: 1 }]);
  await f.wait(650);
  await f.send('touchEnd', []);
  await f.wait(100);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.nb-pick .tile').length), 3);
  assert.deepEqual(await f.page.evaluate(() => [...document.querySelectorAll('.nb-pick .tile img')].map(i => i.loading)), ['lazy', 'lazy', 'lazy']);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.nb-pick .tab').length), 1);
});

run('the picker: another group\'s tab shows its stamps; a topic card and a card without the flag are never there', async f => {
  const picked = await f.page.evaluate(() => {
    const pick = g => t.state.cards.find(c => c.group === g);
    const ids = [pick('mammals'), pick('birds'), pick('conservation'), t.state.cards.find(c => c.group === 'mammals' && !c.stamp)].map(c => c.id);
    for (const id of ids) t.state.collected[id] = { cardId: id };
    return ids;
  });
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.rack(f, 'stamp');
  await f.page.click('.nb-pop--stamps .nb-tool:last-child');
  assert.deepEqual(await f.page.evaluate(() => [...document.querySelectorAll('.nb-pick .tab')].map(e => e.dataset.group)), ['mammals', 'birds']);
  await f.page.click('.nb-pick .tab[data-group="birds"]');
  await f.page.click(`.nb-pick .tile[data-card="${picked[1]}"]`);
  await f.tap({ x: 450, y: 600 });
  assert.equal((await f.items(a))[0].card, picked[1]);
});

run('the panda: a tap never moves to another animal; the row is the page\'s animal, then the last used, and a pick takes', async f => {
  const ids = await rail.collect(f, 4);
  const [a] = await f.seed([[], []]);
  await openTagged(f, a, ids[2]);
  await rail.rack(f, 'stamp');
  const row = () => f.page.evaluate(() => [...document.querySelectorAll('.nb-pop--stamps [data-card]')].map(b => b.dataset.card));
  assert.deepEqual(await row(), [ids[2]]);
  await f.page.click(`.nb-pop--stamps [data-card="${ids[2]}"]`);
  await f.tap({ x: 450, y: 600 });
  assert.equal((await f.items(a))[0].card, ids[2]);
  await rail.rack(f, 'stamp');
  await rail.rack(f, 'stamp');
  await f.page.mouse.click(5, 5);
  await f.tap(onPage(900, 1200));
  assert.equal((await f.items(a))[1].card, ids[2], 'tapping the panda changed nothing');
});

run('the sponge rubs off stamps, trails and text in one undo step, and leaves lines and photos', async f => {
  const photo = { t: 'p', id: 'missing', x: 700, y: 1000, w: 300, h: 200, r: 0 };
  const start = [stroke(100, 300), label(100, 500), TRAIL, STAMP, photo];
  const [a] = await f.seed([start, []]);
  await f.show(a);
  await f.page.click('.nb-rack[data-rack="sponge"]');
  assert.deepEqual(await f.page.evaluate(() => [...document.querySelectorAll('.nb-rack[data-raised]')].map(b => b.dataset.rack)), ['sponge']);
  await f.drag(at(150, 280), at(300, 1000), 24);
  assert.deepEqual((await f.items(a)).map(i => i.t), ['s', 'p'], 'over the line and past the rest');
  await f.tap(at(700, 1000));
  assert.deepEqual((await f.items(a)).map(i => i.t), ['s', 'p'], 'photos keep their ✕');
  await f.page.click('.nb-undo');
  await f.wait(550);
  assert.deepEqual(await f.items(a), start, 'undo puts each back in its place');
  await f.page.click('.nb__railfoot .nb-tool:nth-child(2)');
  await f.wait(550);
  assert.deepEqual((await f.items(a)).map(i => i.t), ['s', 'p'], 'and redo takes them again');
});

run('a tap of the sponge takes one stamp, and the page keeps its animal tag', async f => {
  const [id] = await rail.collect(f, 1);
  const [a] = await f.seed([[{ ...STAMP, card: id }], []]);
  await f.page.evaluate(async ([i, card]) => { const p = await t.notes.loadPage(i); p.tags = [card]; await t.notes.savePage(p); }, [a, id]);
  await f.show(a, { start: { view: 'pages', scope: { kind: 'animal', id }, pageId: a } });
  await f.page.click('.nb-rack[data-rack="sponge"]');
  await f.send('touchStart', [{ ...at(300, 1000), id: 1 }]);
  await f.wait(30);
  assert.ok(await f.box('.nb-wipe'), 'it wipes off');
  await f.send('touchEnd', []);
  await f.wait(550);
  assert.equal(await f.box('.nb-wipe'), undefined, 'and the wipe is gone');
  assert.equal(await f.box('.nb-ghost'), undefined);
  assert.equal((await f.items(a)).length, 0);
  assert.deepEqual((await f.page.evaluate(i => t.notes.loadPage(i), a)).tags, [id]);
});

run('the sponge has no wipe with reduced motion, and takes the stamp all the same', async f => {
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  const [a] = await f.seed([[STAMP], []]);
  await f.show(a);
  await f.page.click('.nb-rack[data-rack="sponge"]');
  await f.send('touchStart', [{ ...at(300, 1000), id: 1 }]);
  await f.wait(30);
  assert.equal(await f.box('.nb-wipe'), undefined);
  await f.send('touchEnd', []);
  await f.wait(550);
  assert.equal((await f.items(a)).length, 0);
});

run('washi tape: a drag lays a strip along it, a tap a short one; tweezers and the sponge take it, the eraser doesn\'t', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.rack(f, 'washi');
  await f.drag(onPage(200, 400), onPage(800, 400));
  const [strip] = await f.items(a);
  assert.equal(strip.t, 'w');
  assert.equal(strip.k, 'yellow');
  assert.ok(Math.abs(strip.l - 600) < 8 && Math.abs(strip.x - 500) < 8 && Math.abs(strip.r) < 0.02, JSON.stringify(strip));
  await f.page.click('.nb-rack[data-rack="washi"]');
  await f.page.click('.nb-pop--rail [data-washi="blue"]');
  await f.tap(onPage(500, 900));
  const [, short] = await f.items(a);
  assert.equal(short.k, 'blue');
  assert.ok(short.l > 100);
  await rail.pick(f, 'eraser');
  await f.tap(onPage(500, 900));
  assert.equal((await f.items(a)).length, 2, 'the eraser is for lines');
  await tweezers(f);
  await f.drag(onPage(500, 400), onPage(500, 600));
  assert.ok(Math.abs((await f.items(a))[0].y - 600) < 8, 'moved');
  await rail.rack(f, 'sponge');
  await f.tap(onPage(500, 900));
  assert.equal((await f.items(a)).length, 1, 'rubbed off');
  await f.page.click('.nb-undo');
  await f.wait(550);
  assert.equal((await f.items(a)).length, 2);
});

run('a page with tape goes through a backup and comes back whole', async f => {
  const [a] = await f.seed([[{ t: 'w', k: 'green', x: 300, y: 400, l: 300, s: 56, r: 0.1 }]]);
  const kept = await f.page.evaluate(async i => { const io = await import('/js/notes-io.js'); return io.cleanPage(await t.notes.loadPage(i)).items; }, a);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].t, 'w');
});

run('the pile opens the picker; the picture waits on the desk, developing, and nothing is kept until it lands', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const [chooser] = await Promise.all([f.page.waitForEvent('filechooser'), rail.rack(f, 'photos')]);
  assert.equal(chooser.isMultiple(), false);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb > input[accept="image/*"]').hasAttribute('capture')), false, 'camera or library, the device\'s own choice');
  await shot(f);
  const blank = await f.page.evaluate(() => { const b = document.querySelector('.nb-polaroid__blank'); const [a] = b.getAnimations(); return { ms: a.effect.getComputedTiming().duration, keys: a.effect.getKeyframes().map(k => k.opacity) }; });
  assert.equal(blank.ms, 2000);
  assert.deepEqual(blank.keys.map(Number), [1, 0]);
  assert.equal(await photosOn(f), 0, 'nothing kept yet');
  const inside = await f.box('.nb-polaroid'), page = await f.box('.nb__sheet');
  assert.ok(inside.x >= page.x + page.w, 'on the desk, off the page');
  await f.wait(2100);
  assert.equal(await f.box('.nb-polaroid__blank'), undefined, 'developed');
  assert.equal((await f.items(a)).length, 0);
});

run('a Polaroid dragged onto the page lands tilted, works with the tweezers, and is kept small', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await shot(f);
  await f.wait(300);
  const b = await f.box('.nb-polaroid');
  await f.drag({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, onPage(600, 800), 10);
  await f.wait(200);
  assert.equal(await f.box('.nb-polaroid'), undefined, 'it went on the page');
  const [photo] = await f.items(a);
  assert.equal(photo.t, 'p');
  assert.ok(Math.abs(photo.x - 600) < 4 && Math.abs(photo.y - 800) < 4, JSON.stringify(photo));
  assert.ok(Math.abs(photo.r) <= (4 * Math.PI) / 180 + 1e-9, String(photo.r));
  assert.ok(Math.max(photo.w, photo.h) === 560);
  assert.equal(await photosOn(f), 1);
  const size = await f.page.evaluate(async i => { const bmp = await createImageBitmap(await t.notes.loadPhotoBlob(i)); return [bmp.width, bmp.height]; }, photo.id);
  assert.deepEqual(size, [1280, 853], 'shrunk from 1800 × 1200');
  await tweezers(f);
  await f.drag(onPage(600, 800), onPage(600, 500));
  assert.ok(Math.abs((await f.items(a))[0].y - 500) < 4);
  await rail.rack(f, 'sponge');
  await f.tap(onPage(600, 500));
  assert.equal((await f.items(a)).length, 1, 'the sponge leaves photos');
});

run('let go off the page, a Polaroid goes back to the desk and nothing is kept', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await shot(f);
  await f.wait(300);
  const b = await f.box('.nb-polaroid');
  await f.drag({ x: b.x + b.w / 2, y: b.y + b.h / 2 }, { x: 250, y: 700 }, 6);
  await f.wait(350);
  const back = await f.box('.nb-polaroid');
  assert.ok(Math.abs(back.x - b.x) < 2 && Math.abs(back.y - b.y) < 2);
  assert.equal(await photosOn(f), 0);
  assert.equal((await f.items(a)).length, 0);
});

run('?debug=taps outlines every tap zone with its size, and none on the roll or tray is red', async f => {
  const [a] = await f.seed([[], []]);
  await f.page.evaluate(async () => { const { tapZones } = await import('/js/notes-debug.js'); window.tapZones = tapZones; });
  await f.show(a);
  const zones = await f.page.evaluate(() => { const z = window.tapZones(document.querySelector('.nb')); z.draw(); return { all: document.querySelectorAll('.nb-taps__zone').length, red: [...document.querySelectorAll('.nb-taps__zone--small')].map(e => e.textContent), sample: document.querySelector('.nb-taps__zone').textContent }; });
  assert.ok(zones.all > 20, String(zones.all));
  assert.deepEqual(zones.red, []);
  assert.match(zones.sample, /^[0-9]+×[0-9]+$/);
});
