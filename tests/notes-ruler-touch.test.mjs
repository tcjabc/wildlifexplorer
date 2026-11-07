// Field Notes under real touches: the ruler. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-ruler-touch.test.mjs
import assert from 'node:assert/strict';
import { run, inHand, rail, at } from './fixtures/notes-browser.mjs';

run('the ruler: tapped out across the page, one finger moves it, and it is never saved', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  assert.equal(await rail.ruler(f), null);
  await rail.pick(f, 'ruler');
  const at = await rail.ruler(f);
  assert.ok(at);
  assert.equal(await inHand(f), 'pencil', 'the pencil stays in the hand');
  await f.drag({ x: 640, y: 410 }, { x: 640, y: 510 });
  assert.ok(Math.abs((await rail.ruler(f)).top - at.top - 100) < 2);
  assert.equal((await f.items(a)).length, 0, 'moving it draws nothing');
  await rail.pick(f, 'ruler');
  assert.equal(await rail.ruler(f), null, 'back in its loop');
  const page = await f.page.evaluate(i => t.notes.loadPage(i), a);
  assert.deepEqual(Object.keys(page).sort(), ['createdAt', 'editedAt', 'header', 'h', 'id', 'items', 'paper', 'tags', 'version', 'w'].sort());
});

run('the ruler can be dragged from its loop onto the page, and goes back if let go off it', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const b = await f.box('.nb-pt[data-pt="ruler"]'), from = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  await f.drag(from, { x: 640, y: 400 });
  const at = await rail.ruler(f);
  assert.ok(at && at.left > 0, 'on the page');
  await rail.pick(f, 'ruler');
  await f.drag(from, { x: 40, y: 700 });
  assert.equal(await rail.ruler(f), null);
});

run('two fingers starting on the ruler turn it, and leave the page where it is', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'ruler');
  const view = await f.transform();
  await f.two([{ x: 490, y: 410 }, { x: 790, y: 410 }], [{ x: 490, y: 350 }, { x: 790, y: 470 }]);
  const { turn } = await rail.ruler(f);
  assert.ok(Math.abs(turn - Math.atan2(120, 300)) < 0.02, String(turn));
  assert.equal(await f.transform(), view);
  assert.equal((await f.items(a)).length, 0);
});

run('two fingers elsewhere pan and zoom as ever, and the ruler stays on the page with them', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'ruler');
  const at = await rail.ruler(f), view = await f.transform();
  await f.two([{ x: 590, y: 620 }, { x: 690, y: 620 }], [{ x: 490, y: 620 }, { x: 790, y: 620 }]);
  assert.notEqual(await f.transform(), view);
  assert.deepEqual(await rail.ruler(f), at);
});

run('one finger on the ruler and one off it: a pan or zoom, and the ruler stays put', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'ruler');
  const at = await rail.ruler(f), view = await f.transform();
  await f.two([{ x: 640, y: 410 }, { x: 640, y: 650 }], [{ x: 640, y: 310 }, { x: 640, y: 750 }]);
  assert.notEqual(await f.transform(), view);
  assert.deepEqual(await rail.ruler(f), at);
});

run('a second finger on the ruler turns it even long after the first, while one off it by then is a brush of the hand', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'ruler');
  const view = await f.transform();
  await f.send('touchStart', [{ x: 490, y: 410, id: 1 }]);
  await f.wait(350);
  await f.send('touchStart', [{ x: 490, y: 410, id: 1 }, { x: 790, y: 410, id: 2 }]);
  await f.wait(30);
  await f.send('touchMove', [{ x: 490, y: 410, id: 1 }, { x: 790, y: 510, id: 2 }]);
  await f.wait(30);
  await f.send('touchEnd', []);
  await f.wait(100);
  const { turn } = await rail.ruler(f);
  assert.ok(turn > 0.2, String(turn));
  assert.equal(await f.transform(), view);
});

run('a line started beside the ruler runs straight along its edge, with any tool; one started away from it does not', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'ruler');
  const wobble = async (x, y, h = 25) => {
    await f.send('touchStart', [{ x, y, id: 1 }]);
    for (let i = 1; i <= 10; i++) { await f.send('touchMove', [{ x: x + i * 30, y: y + (i % 2 ? h : -h) * 0.5, id: 1 }]); await f.wait(16); }
    await f.send('touchEnd', []);
    await f.wait(550);
  };
  await wobble(480, 443);
  await rail.pick(f, 'highlighter');
  await wobble(480, 377);
  await wobble(480, 560);
  const [low, high, free] = await f.items(a);
  const ys = it => it.p.filter((_, i) => i % 3 === 1);
  assert.ok(ys(low).every(y => Math.abs(y - 748) < 0.01), 'the lower edge');
  assert.ok(ys(high).every(y => Math.abs(y - 652) < 0.01), 'the upper edge');
  assert.ok(Math.max(...ys(free)) - Math.min(...ys(free)) > 10, 'away from it, the line goes where the finger goes');
});

run('a line along a turned ruler follows it', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'ruler');
  await f.two([{ x: 490, y: 410 }, { x: 790, y: 410 }], [{ x: 490, y: 310 }, { x: 790, y: 510 }]);
  const { turn } = await rail.ruler(f);
  // Just off its lower edge, then roughly along it.
  const x0 = 640 - Math.sin(turn) * 35, y0 = 410 + Math.cos(turn) * 35;
  await f.send('touchStart', [{ x: x0, y: y0, id: 1 }]);
  for (let i = 1; i <= 8; i++) { await f.send('touchMove', [{ x: x0 + i * 15, y: y0 + i * 12, id: 1 }]); await f.wait(16); }
  await f.send('touchEnd', []);
  await f.wait(550);
  const dots = (await f.items(a)).filter(i => i.p.length > 3).at(-1).p;
  const slope = (dots[dots.length - 2] - dots[1]) / (dots[dots.length - 3] - dots[0]);
  assert.ok(Math.abs(Math.atan(slope) - turn) < 0.01, `${Math.atan(slope)} and ${turn}`);
});

run('a pen on the ruler draws along it and never moves it', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'ruler');
  const at = await rail.ruler(f);
  const cdp = await f.page.context().newCDPSession(f.page);
  const pen = (type, x, y) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, pointerType: 'pen', force: 0.5 });
  await pen('mousePressed', 480, 420);
  for (let i = 1; i <= 6; i++) { await pen('mouseMoved', 480 + i * 30, 425); await f.wait(16); }
  await pen('mouseReleased', 660, 425);
  await f.wait(550);
  assert.deepEqual(await rail.ruler(f), at);
  const [line] = await f.items(a);
  assert.ok(line.p.filter((_, i) => i % 3 === 1).every(y => Math.abs(y - 748) < 0.01), 'the nearer edge');
});
