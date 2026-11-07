// Field Notes under real touches: selecting and moving what is on the page: tweezers, handles, ✕, ✎. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-select-touch.test.mjs
import assert from 'node:assert/strict';
import { K, onPage, stroke, label, open, tweezers, zoomOf, run, rail, STAMP, at, seen } from './fixtures/notes-browser.mjs';

run('tweezers: a tap selects text, a drag moves it, a tap elsewhere lets go, and none of it leaves a mark', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await tweezers(f);
  const px = await f.page.evaluate(() => { const s = document.querySelector('.nb__sheet').getBoundingClientRect(); return { x: s.x + (360 * s.width) / 1120, y: s.y + (520 * s.height) / 1400 }; });
  await f.tap(px);
  assert.ok(await f.box('.nb-sel'), 'selected, and the click ending the tap did not land on ✕');
  assert.deepEqual(await f.items(a), [label(300, 500)], 'a tap leaves it where it was, and no dot');
  await f.drag(px, { x: px.x + 100, y: px.y + 60 });
  const [moved] = await f.items(a);
  assert.equal(moved.t, 'x');
  assert.ok(moved.x > 400, String(moved.x));
  await f.tap(onPage(900, 1200));
  assert.equal(await f.box('.nb-sel'), undefined, 'let go');
  assert.equal((await f.items(a)).length, 1, 'no dot');
  await f.tap(onPage(900, 1200));
  assert.equal((await f.items(a)).length, 1, 'tweezers never mark the page');
});

run('tweezers: one press selects and drags, in a single move', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await tweezers(f);
  const at = onPage(360, 520);
  await f.drag(at, { x: at.x + 100, y: at.y + 60 });
  const [moved] = await f.items(a);
  assert.ok(moved.x > 400 && moved.y > 550, JSON.stringify(moved));
  assert.ok(await f.box('.nb-sel'), 'and it stays selected');
});

run('tweezers never touch a line, and a drag on bare paper never turns the page', async f => {
  const lines = [stroke(100, 300), stroke(100, 500)];
  const [a] = await f.seed([lines, [], [], []]);
  await f.show(a);
  await tweezers(f);
  await f.tap(onPage(150, 300));
  assert.equal(await f.box('.nb-sel'), undefined, 'a line can\'t be selected');
  await f.drag(onPage(150, 500), { x: 500, y: 400 });
  assert.deepEqual(await f.items(a), lines);
  await f.drag({ x: 600, y: 700 }, { x: 610, y: 300 });
  assert.equal(await f.place(), 1, 'a missed grab keeps the page');
  await f.two([{ x: 500, y: 700 }, { x: 700, y: 700 }], [{ x: 500, y: 400 }, { x: 700, y: 400 }]);
  assert.equal(await f.place(), 2, 'two fingers still turn it');
});

run('tweezers work with a finger in pen-only mode', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await f.page.evaluate(() => { t.state.profile.notesInput = 'pen'; });
  await tweezers(f);
  const at = onPage(360, 520);
  await f.drag(at, { x: at.x + 100, y: at.y });
  assert.ok((await f.items(a))[0].x > 400);
});

run('an animal stamp can be moved, resized and turned with the tweezers, and removed with ✕', async f => {
  const [id] = await rail.collect(f, 1);
  const stamp = { t: 'm', c: '#444444', card: id, x: 400, y: 700, s: 180, r: 0 };
  const [a] = await f.seed([[stamp], []]);
  await f.show(a);
  await tweezers(f);
  const c = onPage(400, 700);
  await f.tap(c);
  const grab = async sel => { const b = await f.box(sel); return { x: b.x + b.w / 2, y: b.y + b.h / 2 }; };
  const h = await grab('.nb-sel__resize');
  await f.drag(h, { x: h.x + 60, y: h.y + 60 });
  const [big] = await f.items(a);
  assert.ok(big.s > 260, String(big.s));
  const r = await grab('.nb-sel__rotate');
  await f.drag(r, { x: r.x + 80, y: r.y + 80 });
  const [turned] = await f.items(a);
  assert.ok(Math.abs(turned.r) > 0.2, String(turned.r));
  await f.tap(await grab('.nb-sel__del'));
  assert.equal((await f.items(a)).length, 0);
});

run('a wide silhouette is selected and wiped by all of its width, not just a square in the middle', async f => {
  const [id] = await f.page.evaluate(() => {
    const wide = t.state.cards.filter(c => c.silhouette?.file);
    for (const c of wide) t.state.collected[c.id] = { cardId: c.id };
    return wide.map(c => c.id);
  });
  const [a] = await f.seed([[{ t: 'm', c: '#444444', card: id, x: 500, y: 700, s: 200, r: 0 }], []]);
  await f.show(a);
  await f.wait(300); // its picture arrives
  const ratio = await f.page.evaluate(src => new Promise(done => { const i = new Image(); i.onload = () => done(i.naturalWidth / i.naturalHeight); i.src = src; }), await f.page.evaluate(c => t.state.byId.get(c).silhouette.file, id));
  assert.ok(ratio > 1.2, String(ratio));
  const px = onPage;
  await tweezers(f);
  await f.tap(px(500 + (100 * ratio) - 12, 700)); // near its far end, well outside a 200 square
  const box = await f.box('.nb-sel');
  assert.ok(box, 'selected');
  assert.ok(Math.abs(box.w - 200 * ratio * K) < 3, `${box.w}`);
  await f.page.click('.nb-rack[data-rack="sponge"]');
  await f.tap(px(500 - (100 * ratio) + 12, 700));
  assert.equal((await f.items(a)).length, 0);
});

run('✕ ignores a tap straight after selecting, and works after that', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await tweezers(f);
  const px = await f.page.evaluate(() => { const s = document.querySelector('.nb__sheet').getBoundingClientRect(); return { x: s.x + (360 * s.width) / 1120, y: s.y + (520 * s.height) / 1400 }; });
  await f.send('touchStart', [{ ...px, id: 1 }]);
  await f.send('touchEnd', []);
  await f.page.waitForSelector('.nb-sel__del');
  const del = await f.box('.nb-sel__del'), at = { x: del.x + del.w / 2, y: del.y + del.h / 2 };
  await f.tap(at); // the second half of a quick double tap
  assert.equal((await f.items(a)).length, 1, 'still there');
  await f.tap(at);
  assert.equal((await f.items(a)).length, 0, 'a deliberate tap removes it');
});

run('a pinch on the selected item resizes it and leaves the page\'s zoom alone', async f => {
  const [a] = await f.seed([[{ t: 'p', id: 'missing', x: 500, y: 700, w: 400, h: 300, r: 0 }], []]);
  await f.show(a);
  const c = await f.page.evaluate(() => { const s = document.querySelector('.nb__sheet').getBoundingClientRect(); return { x: s.x + s.width / 2, y: s.y + s.height / 2 }; });
  await tweezers(f);
  await f.tap(c);
  await f.two([{ x: c.x - 30, y: c.y }, { x: c.x + 30, y: c.y }], [{ x: c.x - 60, y: c.y }, { x: c.x + 60, y: c.y }]);
  const [photo] = await f.items(a);
  assert.ok(Math.abs(photo.w - 800) < 8, String(photo.w));
  assert.equal(zoomOf(await f.transform()), 1);
});

run('the selected text has a pencil button to edit it, and nothing else does', async f => {
  const [a] = await f.seed([[label(300, 500), STAMP], []]);
  await f.show(a);
  await tweezers(f);
  await f.tap(onPage(340, 520));
  const b = await f.box('.nb-sel__edit');
  assert.ok(b.w >= 44 && b.h >= 44);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb-sel__edit').getAttribute('aria-label')), 'Edit the text');
  await f.tap({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb-text').value), 'Hello');
  await f.page.keyboard.type(' there');
  await f.page.keyboard.press('Enter');
  await f.wait(550);
  assert.equal((await f.items(a))[0].v, 'Hello there');
  await f.tap(onPage(300, 1000));
  assert.equal(await seen(f, '.nb-sel__edit'), false, 'a stamp has no text to edit');
});

run('a double tap on text with the tweezers edits it; two slow taps don\'t; with a pencil it is two dots', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await tweezers(f);
  const at = onPage(340, 520);
  await f.tap(at);
  await f.wait(300);
  await f.tap(at);
  assert.equal(await f.box('.nb-text'), undefined, 'slow');
  await f.tap(onPage(900, 1200));
  await f.send('touchStart', [{ ...at, id: 1 }]); await f.send('touchEnd', []);
  await f.wait(90);
  await f.send('touchStart', [{ ...at, id: 1 }]); await f.send('touchEnd', []);
  await f.wait(150);
  assert.ok(await f.box('.nb-text'), 'quick');
  await f.page.keyboard.press('Escape');
  await rail.pick(f, 'pen');
  await f.wait(300);
  await f.send('touchStart', [{ ...at, id: 1 }]); await f.send('touchEnd', []);
  await f.wait(90);
  await f.send('touchStart', [{ ...at, id: 1 }]); await f.send('touchEnd', []);
  await f.wait(550);
  assert.equal(await f.box('.nb-text'), undefined);
  assert.equal((await f.items(a)).length, 3);
});

run('✎ works on the finger lifting when no click comes, and only for a press on ✎ itself', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await tweezers(f);
  await f.tap(onPage(340, 520));
  // The drag's own click, with no press on ✎: nothing.
  await f.page.evaluate(() => document.querySelector('.nb-sel__edit').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
  await f.wait(150);
  assert.equal(await f.box('.nb-text'), undefined, 'a click with no press does nothing');
  // A lift ending a press somewhere else: nothing.
  await f.page.evaluate(() => document.querySelector('.nb-sel__edit').dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 9, pointerType: 'touch' })));
  await f.wait(150);
  assert.equal(await f.box('.nb-text'), undefined, 'a lift with no press does nothing');
  // After dragging a handle, the first tap comes with no click.
  const r = await f.box('.nb-sel__resize');
  await f.drag({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, { x: r.x + r.w / 2 + 20, y: r.y + r.h / 2 + 20 });
  await f.page.evaluate(() => { const e = document.querySelector('.nb-sel__edit'), go = t => e.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 7, pointerType: 'touch' })); go('pointerdown'); go('pointerup'); });
  await f.wait(200);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb-text')?.value), 'Hello', 'the very first tap opens it');
  await f.page.keyboard.press('Escape');
});

run('with a real tap the box to type in opens once, and stays open', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await tweezers(f);
  await f.tap(onPage(340, 520));
  const b = await f.box('.nb-sel__edit');
  await f.tap({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.nb-text').length), 1);
  assert.equal(await f.page.evaluate(() => document.activeElement.className), 'nb-text');
});

run('the handles go while two fingers are down, and come back; a finger on ✕ or ✎ does nothing in a pinch', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await tweezers(f);
  await f.tap(onPage(340, 520));
  const shown = () => f.page.evaluate(() => [...document.querySelectorAll('.nb-sel__h')].filter(h => getComputedStyle(h).visibility === 'visible' && !h.hidden).length);
  assert.equal(await shown(), 4);
  const edit = await f.box('.nb-sel__edit'), del = await f.box('.nb-sel__del');
  const on = { x: edit.x + edit.w / 2, y: edit.y + edit.h / 2 }, off = { x: del.x + del.w / 2, y: del.y + del.h / 2 };
  await f.send('touchStart', [{ ...on, id: 1 }]);
  await f.send('touchStart', [{ ...on, id: 1 }, { ...off, id: 2 }]);
  await f.wait(40);
  assert.equal(await shown(), 0, 'gone with two down, even with a finger on one');
  await f.send('touchMove', [{ x: on.x - 20, y: on.y + 20, id: 1 }, { x: off.x + 20, y: off.y - 20, id: 2 }]);
  await f.wait(40);
  await f.send('touchEnd', []);
  await f.wait(600);
  assert.equal(await f.box('.nb-text'), undefined, '✎ did nothing');
  assert.equal((await f.items(a)).length, 1, '✕ did nothing');
  assert.equal(await shown(), 4, 'and back when they lift');
});

run('a finger on a handle, then a second: the handle lets go and the pinch resizes the item', async f => {
  const [a] = await f.seed([[{ t: 'p', id: 'missing', x: 560, y: 700, w: 300, h: 300, r: 0 }], []]);
  await f.show(a);
  await tweezers(f);
  await f.tap(onPage(560, 700));
  const r = await f.box('.nb-sel__resize'), c = onPage(560, 700);
  const handle = { x: r.x + r.w / 2, y: r.y + r.h / 2 }, other = { x: 2 * c.x - handle.x, y: 2 * c.y - handle.y };
  await f.send('touchStart', [{ ...handle, id: 1 }]);
  await f.send('touchStart', [{ ...handle, id: 1 }, { ...other, id: 2 }]);
  for (let i = 1; i <= 6; i++) { await f.send('touchMove', [{ x: handle.x + i * 6, y: handle.y + i * 6, id: 1 }, { x: other.x - i * 6, y: other.y - i * 6, id: 2 }]); await f.wait(16); }
  await f.send('touchEnd', []);
  await f.wait(600);
  const [photo] = await f.items(a);
  assert.ok(photo.w > 330, 'bigger, from both sides');
  assert.ok(Math.abs(photo.x - 560) < 4 && Math.abs(photo.y - 700) < 4, 'about its middle, as a pinch does');
});
