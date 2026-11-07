// Field Notes under real touches: lines and the tools that draw them: pencil, pen, highlighter, eraser, the slider and colours. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-drawing-touch.test.mjs
import assert from 'node:assert/strict';
import { onPage, LEFT, stroke, label, run, inHand, rail, STAMP, at, panel } from './fixtures/notes-browser.mjs';

run('one finger draws on the page, as a vector stroke', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.drag(onPage(800, 800), onPage(1000, 840));
  const [mark] = await f.items(a);
  assert.equal(mark.t, 's');
  assert.equal(mark.p.length % 3, 0, 'x, y, pressure');
  assert.ok(Math.abs(mark.p[0] - 800) < 2 && Math.abs(mark.p[1] - 800) < 2, 'in the page\'s own units');
});

run('undo goes back in the order things were done', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.drag(LEFT, { x: LEFT.x + 150, y: LEFT.y });
  await f.drag({ x: LEFT.x, y: LEFT.y + 60 }, { x: LEFT.x + 150, y: LEFT.y + 60 });
  await f.page.click('.nb-undo');
  await f.wait(550);
  assert.equal((await f.items(a)).length, 1);
  await f.page.click('.nb-undo');
  await f.wait(550);
  assert.equal((await f.items(a)).length, 0);
});

run('with a pencil, pen or highlighter a tap on a stamp, text or photo is a dot', async f => {
  const items = [label(100, 300), { t: 'p', id: 'missing', x: 500, y: 900, w: 400, h: 300, r: 0 }];
  const [a] = await f.seed([items, []]);
  await f.show(a);
  for (const tool of ['pen', 'highlighter', 'pencil']) {
    await rail.pick(f, tool);
    await f.tap(onPage(160, 320));
    await f.tap(onPage(500, 900));
    assert.equal(await f.box('.nb-sel'), undefined, tool);
  }
  const after = await f.items(a);
  assert.deepEqual(after.slice(0, 2), items);
  assert.deepEqual(after.slice(2).map(i => i.t), Array(6).fill('s'));
});

run('with the eraser, and for a finger in pen-only mode, a tap selects nothing', async f => {
  const [a] = await f.seed([[label(100, 300)], []]);
  await f.show(a);
  await rail.pick(f, 'eraser');
  const at = onPage(160, 320);
  await f.tap(at);
  assert.equal(await f.box('.nb-sel'), undefined);
  await rail.pick(f, 'pencil');
  await f.page.evaluate(() => { t.state.profile.notesInput = 'pen'; });
  await f.tap(at);
  assert.equal(await f.box('.nb-sel'), undefined);
  assert.equal((await f.items(a)).length, 1);
});

run('the roll shows the colours and thickness of the tool in hand; a colour brings its tool to hand', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const colours = () => f.page.evaluate(() => [...document.querySelectorAll('.nb-roll__colours button')].map(b => b.dataset.colour ?? b.dataset.hl));
  assert.equal((await colours()).length, 9);
  assert.ok((await colours()).includes('white'));
  await rail.pick(f, 'highlighter');
  assert.deepEqual(await colours(), ['cyan', 'yellow', 'magenta'], 'only these for the highlighter, and no white');
  await rail.pick(f, 'eraser');
  await f.wait(50);
  assert.equal(await f.page.evaluate(() => getComputedStyle(document.querySelector('.nb-roll__colours')).visibility), 'hidden', 'the eraser has none to show');
  await rail.rack(f, 'sponge');
  await f.wait(50);
  assert.deepEqual(await colours(), ['cyan', 'yellow', 'magenta'], 'with something from the tray, the last drawing tool\'s stay');
  await f.page.click('.nb-roll__colours [data-hl="magenta"]');
  await f.wait(100);
  assert.equal(await inHand(f), 'highlighter', 'a colour is for drawing: its tool comes to hand');
  assert.equal(await f.page.evaluate(() => t.state.profile.notesTools.highlighter.colour), 'magenta');
});

run('the slider has five notches, each its own line width, and the panel\'s thin and thick are two of them', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const set = v => f.page.evaluate(n => { const i = document.querySelector('.nb-slider'); i.value = n; i.dispatchEvent(new Event('input', { bubbles: true })); }, v);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb-slider').value), '1', 'thin, as ever');
  const widths = [];
  for (let n = 0; n < 5; n++) {
    await set(n);
    await f.drag({ x: 500, y: 200 + n * 60 }, { x: 650, y: 200 + n * 60 });
    widths.push((await f.items(a))[n].w);
  }
  assert.deepEqual(widths, [...widths].sort((x, y) => x - y));
  assert.equal(new Set(widths).size, 5);
  assert.equal(widths[1], 5, 'a thin pencil is as it was');
  assert.equal(widths[3], 12, 'and a thick one');
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb-slider').getAttribute('aria-valuetext')), 'Very thick');
});

run('each tool draws its own kind of line; c stays a plain colour and a pencil line stays as it always was', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.drag({ x: 500, y: 300 }, { x: 600, y: 300 });
  await rail.pick(f, 'pen');
  await f.drag({ x: 500, y: 350 }, { x: 600, y: 350 });
  await rail.pick(f, 'highlighter');
  await f.drag({ x: 500, y: 400 }, { x: 600, y: 400 });
  const [pencil, pen, hl] = await f.items(a);
  assert.deepEqual(Object.keys(pencil).sort(), ['c', 'p', 't', 'w']);
  assert.equal(pen.k, 'pen');
  assert.equal(hl.k, 'highlighter');
  assert.ok(hl.w > pen.w);
  for (const it of [pencil, pen, hl]) { assert.equal(it.t, 's'); assert.match(it.c, /^#[0-9a-f]{6}$/i); }
});

run('a highlighter multiplies: what is under it still shows, and its joints leave no beads', async f => {
  const points = Array.from({ length: 41 }, (_, i) => [100 + i * 20, 400, 0.5]).flat();
  const [a] = await f.seed([[{ t: 's', c: '#000000', w: 30, k: 'pen', p: [300, 300, 0.5, 300, 500, 0.5] }, { t: 's', c: '#ffec3d', w: 40, k: 'highlighter', p: points }], []]);
  await f.show(a);
  const [r, g, b] = await rail.pixel(f, 300, 400);
  assert.ok(r < 30 && g < 30 && b < 30, 'black stays black under yellow');
  const onJoint = await rail.pixel(f, 500, 400), between = await rail.pixel(f, 510, 400);
  assert.deepEqual(onJoint, between);
  assert.ok(onJoint[2] < 100 && onJoint[0] > 200, 'yellow on the paper');
});

run('the eraser takes whole lines of any tool, and leaves stamps and text alone', async f => {
  const [a] = await f.seed([[stroke(100, 300), { ...stroke(100, 500), k: 'highlighter', w: 40 }, label(100, 700)], []]);
  await f.show(a);
  await rail.pick(f, 'eraser');
  await f.tap(onPage(150, 300));
  await f.drag(onPage(150, 480), onPage(150, 760));
  assert.deepEqual((await f.items(a)).map(i => i.t), ['x']);
});

run('a resting finger can\'t wipe in pen-only mode, and the eraser still takes only lines', async f => {
  const start = [stroke(100, 300), STAMP];
  const [a] = await f.seed([start, []]);
  await f.show(a);
  await rail.pick(f, 'eraser');
  await f.tap(at(300, 1000));
  assert.deepEqual(await f.items(a), start, 'the eraser leaves a stamp');
  await f.page.evaluate(() => { t.state.profile.notesInput = 'pen'; });
  await f.page.click('.nb-rack[data-rack="sponge"]');
  await f.tap(at(300, 1000));
  assert.deepEqual(await f.items(a), start, 'a finger on the sponge does nothing with only a pen drawing');
});

run('a pen line is one width whatever the pressure, and curves through its points; a pencil line is as it was', async f => {
  const p = [100, 300, 0.1, 300, 300, 0.1, 500, 300, 1, 700, 300, 1, 900, 300, 1];
  const [a] = await f.seed([[{ t: 's', c: '#000000', w: 20, k: 'pen', p }], []]);
  await f.show(a);
  const across = x => f.page.evaluate(px => {
    const c = document.querySelector('.nb__base'), k = c.width / 1120, g = c.getContext('2d');
    const d = g.getImageData(Math.round(px * k), Math.round(260 * k), 1, Math.round(80 * k)).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 100) n++;
    return n;
  }, x);
  const thin = await across(200), thick = await across(800);
  assert.ok(thin > 4 && Math.abs(thin - thick) <= 1, `${thin} and ${thick}`);
  const calls = await f.page.evaluate(async () => {
    const { drawStroke } = await import('/js/notes-render.js');
    const log = [], ctx = new Proxy({}, { get: (_, k) => (...args) => { log.push(k); }, set: () => true });
    drawStroke(ctx, { t: 's', c: '#000', w: 5, k: 'pen', p: [0, 0, 0.5, 10, 10, 0.5, 20, 0, 0.5, 30, 10, 0.5] });
    const pen = log.slice(); log.length = 0;
    drawStroke(ctx, { t: 's', c: '#000', w: 5, p: [0, 0, 0.5, 10, 10, 0.5, 20, 0, 0.5] });
    return { pen, pencil: log };
  });
  assert.equal(calls.pen.filter(c => c === 'quadraticCurveTo').length, 2);
  assert.equal(calls.pen.filter(c => c === 'stroke').length, 1, 'one line, not pieces');
  assert.equal(calls.pencil.filter(c => c === 'quadraticCurveTo').length, 0);
});

run('a pen line drawn by finger is smooth while drawing and when finished', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'pen');
  await f.send('touchStart', [{ x: 450, y: 300, id: 1 }]);
  for (let i = 1; i <= 10; i++) { await f.send('touchMove', [{ x: 450 + i * 20, y: 300 + (i % 2) * 30, id: 1 }]); await f.wait(16); }
  await f.send('touchEnd', []);
  await f.wait(550);
  const [line] = await f.items(a);
  assert.equal(line.k, 'pen');
  assert.ok(line.p.length > 12);
});
