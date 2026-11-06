// Field Notes under real touches: the notebook itself (js/notebook.js, its CSS, the store and
// real page files) in Chromium, at the baseline tablet's size, with fingers sent through the
// DevTools protocol. Frame rates and palms on the real tablet can't be tested here.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }
const have = () => { try { return pw && existsSync(pw.chromium.executablePath()); } catch { return false; } };
const skip = !have() && 'chromium not installed';

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const PAGE = `<!doctype html><meta name=viewport content="width=device-width, initial-scale=1">
${['tokens', 'app', 'card', 'notes'].map(n => `<link rel=stylesheet href="/css/${n}.css">`).join('')}
<body class="is-immersive"><main class="main" id="main" data-view="notes"></main>
<script type=module>
import * as store from '/js/store.js';
import * as notes from '/js/notes-store.js';
import { loadStrings, setMode } from '/js/i18n.js';
import { notebook } from '/js/notebook.js';
await loadStrings();
setMode('en');
await store.init();
const p = await store.createProfile({ name: 'Test' });
await store.selectProfile(p.id);
await notes.loadIndex();
window.t = {
  state: store.state, notes,
  // Free pages with these items; returns their ids, oldest first.
  async seed(pages) {
    const ids = [];
    for (const [i, items] of pages.entries()) {
      const page = notes.blankPage();
      page.items = items;
      page.createdAt = page.header.date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
      await notes.savePage(page);
      ids.push(page.id);
    }
    return ids;
  },
  open(pageId, options = {}) {
    window.book = notebook({ start: { view: 'pages', scope: { kind: 'free' }, pageId }, ...options });
    document.getElementById('main').replaceChildren(window.book.el);
  },
  items: async id => (await notes.loadPage(id)).items,
  where: () => window.book.where(),
  ids: () => store.state.notes.map(r => r.pageId),
};
window.ready = true;
</script>`;

let server, url;
before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
    try {
      const body = await readFile(ROOT + path.slice(1));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const LANDSCAPE = { width: 1280, height: 800 }, PORTRAIT = { width: 800, height: 1280 };
// The page at the baseline tablet's size in landscape: its top left and CSS px per page unit.
const K = 592 / 1120;
const onPage = (x, y) => ({ x: 344 + x * K, y: 40 + y * K });
const LEFT = onPage(200, 800);
const stroke = (x, y) => ({ t: 's', c: '#444', w: 5, p: [x, y, 0.5, x + 100, y, 0.5] });
const label = (x, y) => ({ t: 'x', c: '#444', s: 40, x, y, v: 'Hello' });

async function open(viewport = LANDSCAPE) {
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(() => window.ready);
  const cdp = await ctx.newCDPSession(page);
  const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  const wait = ms => page.waitForTimeout(ms);
  const f = {
    browser, page, errors, wait, send,
    seed: pages => page.evaluate(p => t.seed(p), pages),
    async show(id, options) {
      await page.evaluate(([i, o]) => t.open(i, o), [id, options]);
      await page.waitForFunction(() => document.querySelector('.nb')?.dataset.view === 'pages' && document.querySelector('.nb__sheet canvas').width > 1);
      await wait(100);
      await page.waitForFunction(() => !document.getAnimations().length); // the roll has opened
    },
    items: id => page.evaluate(i => t.items(i), id),
    where: () => page.evaluate(() => t.where().pageId),
    // The page open, by what the ribbon says.
    place: () => page.evaluate(() => Number(document.querySelector('.nb__ribbon').getAttribute('aria-label').match(/[0-9]+/)[0])),
    transform: () => page.evaluate(() => getComputedStyle(document.querySelector('.nb__book')).transform),
    box: sel => page.evaluate(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel),
    // One finger along a line.
    async drag(from, to, steps = 8) {
      await send('touchStart', [{ ...from, id: 1 }]);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }]);
        await wait(16);
      }
      await send('touchEnd', []);
      await wait(550); // past the save
    },
    async tap(at) { await send('touchStart', [{ ...at, id: 1 }]); await wait(30); await send('touchEnd', []); await wait(550); },
    // Two fingers, each from its start to its end.
    async two([a0, b0], [a1, b1], steps = 8) {
      await send('touchStart', [{ ...a0, id: 1 }, { ...b0, id: 2 }]);
      for (let i = 1; i <= steps; i++) {
        const at = (p, q) => ({ x: p.x + ((q.x - p.x) * i) / steps, y: p.y + ((q.y - p.y) * i) / steps });
        await send('touchMove', [{ ...at(a0, a1), id: 1 }, { ...at(b0, b1), id: 2 }]);
        await wait(16);
      }
      await send('touchEnd', []);
      await wait(550);
    },
  };
  return f;
}
// Picks up the tweezers, from the tray.
const tweezers = f => f.page.click('.nb-rack[data-rack="tweezers"]');
const zoomOf = m => (m === 'none' ? 1 : Number(m.match(/matrix\(([^,]+)/)[1]));
const run = (name, fn, viewport) => test(name, { skip }, async () => {
  const f = await open(viewport);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});

run('landscape: one page as tall as the desk\'s margins allow, with no app header and no toolbar above it', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const sheets = await f.page.evaluate(() => [...document.querySelectorAll('.nb__sheet')].map(s => { const r = s.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
  assert.deepEqual(sheets, [[344, 40, 592, 740]]);
  assert.equal(await f.box('.nb__bar'), undefined);
  assert.ok(await f.box('.nb__ribbon'));
  // Capped at 1.5 on a 2x screen.
  const canvas = await f.page.evaluate(() => { const c = document.querySelector('.nb__base'); return c.width / c.getBoundingClientRect().width; });
  assert.ok(Math.abs(canvas - 1.5) < 0.01, String(canvas));
});

run('portrait: the tray above the page, the roll below, and the page in all the room between', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const page = await f.box('.nb__sheet'), tray = await f.box('.nb-tray'), roll = await f.box('.nb-roll'), cover = await f.box('.nb-bk__cover');
  assert.ok(tray.y + tray.h <= cover.y && cover.y + cover.h <= roll.y, 'the book between them');
  assert.ok(Math.abs(page.w / page.h - 0.8) < 0.01, '4:5');
  assert.ok(Math.round(cover.y + cover.h - cover.y) >= Math.round(page.h) + 60 - 1 && page.w > 700, JSON.stringify(page));
}, PORTRAIT);

run('rotating keeps the same page open', async f => {
  const [, b] = await f.seed([[], [], []]);
  await f.show(b);
  assert.equal(await f.where(), b);
  await f.page.setViewportSize(PORTRAIT);
  await f.wait(300);
  assert.equal(await f.where(), b);
  await f.page.setViewportSize(LANDSCAPE);
  await f.wait(300);
  assert.equal(await f.where(), b);
});

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

run('two fingers zoom without marking the page, and the sharp canvas stays screen sized', async f => {
  const [a] = await f.seed([[stroke(200, 400)], []]);
  await f.show(a);
  await f.two([{ x: 540, y: 400 }, { x: 740, y: 400 }], [{ x: 390, y: 400 }, { x: 890, y: 400 }]);
  assert.ok(zoomOf(await f.transform()) > 2, await f.transform());
  assert.equal((await f.items(a)).length, 1);
  const detail = await f.page.evaluate(() => { const c = document.querySelector('.nb__detail'); return { hidden: c.hidden, w: c.width, h: c.height }; });
  assert.equal(detail.hidden, false);
  assert.ok(detail.w <= 592 * 1.5 + 1 && detail.h <= 740 * 1.5 + 1, JSON.stringify(detail));
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

run('in the panel a photo goes straight on the page and stays selected, so it can be placed', async f => {
  const [a] = await f.seed([[], []]);
  await panel(f, a);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await f.page.setInputFiles('input[accept="image/*"]', { name: 'p.png', mimeType: 'image/png', buffer: png });
  await f.page.waitForSelector('.nb-sel');
  const b = await f.box('.nb-sel'), c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  await f.wait(500);
  await f.drag(c, { x: c.x + 60, y: c.y + 40 });
  const [photo] = await f.items(a);
  assert.equal(photo.t, 'p');
  assert.ok(photo.x > 580, String(photo.x));
}, { width: 640, height: 700 });

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

run('the tabs turn one page at a time, and the ribbon opens the contents', async f => {
  const [a, b] = await f.seed([[], [], [], []]);
  await f.show(a);
  assert.equal(await f.page.evaluate(() => getComputedStyle(document.querySelector('.nb__nav--prev')).display), 'none', 'nothing before the first page');
  await f.page.click('.nb__nav--next');
  await f.wait(500);
  assert.equal(await f.where(), b);
  await f.page.click('.nb__nav--prev');
  await f.wait(500);
  assert.equal(await f.where(), a);
  await f.page.click('.nb__ribbon');
  await f.wait(650);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'contents');
});

run('new page and the menu stay in reach, and the menu has no page to choose between', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.click('.nb__rail--end .nb__new');
  await f.wait(500);
  assert.equal(await f.page.evaluate(() => t.ids().length), 3);
  await f.page.click('.nb__rail--end .nb__menu');
  await f.wait(100);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb-menu').open), true);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.nb-menu__sides').length), 0);
});

run('an old page keeps all its data through a visit: only what was added changes', async f => {
  const old = [stroke(100, 300), label(120, 500), { t: 'f', c: '#444', k: 'paw', p: [100, 900, 300, 900] }, { t: 'p', id: 'gone', x: 500, y: 1100, w: 300, h: 200, r: 0.05 }];
  const [a] = await f.seed([old, []]);
  await f.show(a);
  await f.drag({ x: 650, y: 300 }, { x: 750, y: 300 });
  const items = await f.items(a);
  assert.deepEqual(items.slice(0, 4), old);
  assert.equal(items.length, 5);
  const page = await f.page.evaluate(i => t.notes.loadPage(i), a);
  assert.deepEqual(Object.keys(page).sort(), ['createdAt', 'editedAt', 'header', 'h', 'id', 'items', 'paper', 'tags', 'version', 'w'].sort());
});

run('beside a card the notebook stays a panel with its bar and toolbar, and two fingers pan the page', async f => {
  const [a] = await f.seed([[], []]);
  await f.page.evaluate(() => { document.body.className = ''; document.getElementById('main').dataset.view = 'binder'; document.getElementById('main').style.height = '500px'; document.getElementById('main').style.padding = '0'; });
  await f.page.evaluate(i => { t.open(i, { beside: true, lead: document.createElement('span') }); }, a);
  await f.page.waitForFunction(() => document.querySelector('.nb__sheet canvas').width > 1);
  await f.wait(1600); // past the nudge
  assert.ok(await f.box('.nb__bar'));
  assert.ok(await f.box('.nb__tools'));
  assert.equal(await f.box('.nb__ribbon'), undefined);
  const y0 = (await f.box('.nb__sheet')).y;
  await f.two([{ x: 300, y: 350 }, { x: 500, y: 350 }], [{ x: 300, y: 200 }, { x: 500, y: 200 }]);
  assert.ok((await f.box('.nb__sheet')).y < y0 - 100);
  assert.equal((await f.items(a)).length, 0);
});

// ---------- the roll and the tray ----------
const rail = {
  // The ruler's place: where its element is, as the notebook set it.
  ruler: f => f.page.evaluate(() => { const r = document.querySelector('.nb-ruler'); return r.hidden ? null : { left: parseFloat(r.style.left), top: parseFloat(r.style.top), turn: parseFloat(r.style.transform.slice(7)) }; }),
  pick: (f, id) => f.page.click(`.nb-pt[data-pt="${id}"]`),
  rack: (f, id) => f.page.click(`.nb-rack[data-rack="${id}"]`),
  // Collected animals with a silhouette.
  collect: (f, n) => f.page.evaluate(k => { const ids = t.state.cards.filter(c => c.silhouette?.file).slice(0, k).map(c => c.id); for (const id of ids) t.state.collected[id] = { cardId: id }; return ids; }, n),
  buzzes: f => f.page.evaluate(() => { window.buzz = []; navigator.vibrate = ms => { window.buzz.push(ms); return true; }; }),
  // A pixel of the page, at page units.
  pixel: (f, x, y) => f.page.evaluate(([px, py]) => {
    const c = document.querySelector('.nb__base'), k = c.width / 1120;
    return [...c.getContext('2d').getImageData(Math.round(px * k), Math.round(py * k), 1, 1).data];
  }, [x, y]),
};
const PHONE_SIDE = { width: 780, height: 360 }, PHONE_UP = { width: 360, height: 740 };

for (const [name, viewport, across] of [['a tablet', LANDSCAPE, true], ['a phone', PHONE_SIDE, true], ['a tablet in portrait', PORTRAIT, false], ['a phone in portrait', PHONE_UP, false]]) {
  run(`${name}: ${across ? 'the roll and the tray beside the book' : 'the tray above the book and the roll below'}, nothing cut off, every tap 44 px`, async f => {
    const [a] = await f.seed([[], []]);
    await f.show(a);
    const start = await f.box('.nb__rail--start'), end = await f.box('.nb__rail--end'), cover = await f.box('.nb-bk__cover');
    if (across) assert.ok(start.x + start.w <= cover.x + 1 && cover.x + cover.w <= end.x + 1);
    else assert.ok(end.y + end.h <= cover.y + 1 && cover.y + cover.h <= start.y + 1);
    const inside = (b, r) => b.x >= r.x - 1 && b.y >= r.y - 1 && b.x + b.w <= r.x + r.w + 1 && b.y + b.h <= r.y + r.h + 1;
    const screen = { x: 0, y: 0, w: viewport.width, h: viewport.height };
    assert.ok(inside(await f.box('.nb__back'), screen));
    const roll = await f.box('.nb-roll');
    for (const sel of ['.nb-roll', '.nb__railfoot', '.nb-undo', '.nb__railfoot .nb-input', '.nb-slider', '.nb-roll__colours', '.nb-pt[data-pt="ruler"]', '.nb-pt[data-pt="eraser"]']) assert.ok(inside(await f.box(sel), sel === '.nb-roll' ? start : roll), sel);
    for (const sel of ['.nb__new', '.nb__menu', '.nb-tray', '.nb-rack--ink', '.nb-rack[data-rack="sponge"]', '.nb-rack[data-rack="tweezers"]', '.nb-rack[data-rack="washi"]', '.nb-rack[data-rack="photos"]']) assert.ok(inside(await f.box(sel), end), sel);
    assert.ok(await f.page.evaluate(() => { const r = document.querySelector('.nb-roll'); return r.scrollHeight <= r.clientHeight + 1 && r.scrollWidth <= r.clientWidth + 1; }), 'nothing spills out of the roll');
    const small = await f.page.evaluate(() => [...document.querySelectorAll('.nb__rail button, .nb__rail input, .nb__back, .nb__ribbon')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.className, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => Math.min(w, h) < 44));
    assert.deepEqual(small, []);
    const clash = await f.page.evaluate(() => { const r = e => e.getBoundingClientRect(), back = r(document.querySelector('.nb__back')); return [...document.querySelectorAll('.nb__rail button')].filter(b => { const q = r(b); return q.right > back.left && q.left < back.right && q.bottom > back.top && q.top < back.bottom; }).length; });
    assert.equal(clash, 0, 'back sits on nothing');
  }, viewport);
}

run('the roll: the tool in use slides out of its loop, with its colours and thickness on show', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const raised = () => f.page.evaluate(() => [...document.querySelectorAll('.nb-pt[data-raised]')].map(b => b.dataset.pt));
  const colours = () => f.page.evaluate(() => [...document.querySelectorAll('.nb-roll__colours button')].map(b => b.dataset.colour ?? b.dataset.hl));
  assert.deepEqual(await raised(), ['pencil']);
  assert.equal((await colours()).length, 9);
  assert.ok((await colours()).includes('white'));
  await rail.pick(f, 'pen');
  assert.deepEqual(await raised(), ['pen']);
  await rail.pick(f, 'highlighter');
  assert.deepEqual(await colours(), ['cyan', 'yellow', 'magenta'], 'only these for the highlighter, and no white');
  await rail.pick(f, 'eraser');
  assert.deepEqual(await raised(), ['eraser']);
  assert.deepEqual(await colours(), ['cyan', 'yellow', 'magenta'], 'the eraser has none: the last tool\'s stay');
  await f.page.click('.nb-roll__colours [data-hl="magenta"]');
  await f.wait(100);
  assert.deepEqual(await raised(), ['highlighter'], 'a colour is for drawing: its tool comes to hand');
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

run('in portrait the popover stays on the screen: the ink pad at the top opens downward', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.click('.nb-rack--ink');
  const pop = await f.box('.nb-pop--rail'), pad = await f.box('.nb-rack--ink');
  assert.ok(pop.y >= pad.y + pad.h - 1);
}, PORTRAIT);

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

run('the ruler: tapped out across the page, one finger moves it, and it is never saved', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  assert.equal(await rail.ruler(f), null);
  await rail.pick(f, 'ruler');
  const at = await rail.ruler(f);
  assert.ok(at);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb-pt[data-raised]').dataset.pt), 'pencil', 'the pencil stays in the hand');
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

run('the panda stamp: a tap picks it up, taps cycle the collected animals, and stamping links the page', async f => {
  const ids = await rail.collect(f, 3);
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.buzzes(f);
  const label = () => f.page.evaluate(() => document.querySelector('.nb-rack[data-rack="stamp"]').getAttribute('aria-label'));
  await rail.rack(f, 'stamp');
  const first = await label();
  await rail.rack(f, 'stamp');
  assert.notEqual(await label(), first);
  await rail.rack(f, 'stamp');
  await rail.rack(f, 'stamp');
  assert.equal(await label(), first, 'round again');
  await f.tap({ x: 450, y: 600 });
  const [item] = await f.items(a);
  assert.equal(item.t, 'm');
  assert.equal(item.card, ids[0]);
  assert.deepEqual((await f.page.evaluate(i => t.notes.loadPage(i), a)).tags, [ids[0]]);
  assert.deepEqual(await f.page.evaluate(() => window.buzz), [15]);
});

run('with no animals collected the panda stamp says how to get some', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.rack(f, 'stamp');
  assert.ok(await f.page.evaluate(() => document.querySelector('.nb-pick').open));
});

run('a long press on the panda stamp lists the animals', async f => {
  await rail.collect(f, 3);
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const b = await f.box('.nb-rack[data-rack="stamp"]');
  await f.send('touchStart', [{ x: b.x + b.w / 2, y: b.y + b.h / 2, id: 1 }]);
  await f.wait(650);
  await f.send('touchEnd', []);
  await f.wait(100);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.nb-pick .nb-pick__item').length), 3);
});

run('the ink pad colours what is stamped, and a tap on a stamp selects it rather than stamping over it', async f => {
  const ids = await rail.collect(f, 1);
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.click('.nb-rack--ink');
  await f.page.click('.nb-pop--rail [data-colour="white"]');
  await f.page.mouse.click(5, 5); // closes it: a tap elsewhere
  await rail.rack(f, 'stamp');
  await f.tap({ x: 450, y: 600 });
  await f.tap({ x: 450, y: 600 });
  const items = await f.items(a);
  assert.equal(items.length, 1);
  assert.equal(items[0].c.toLowerCase(), '#ffffff');
  assert.ok(await f.box('.nb-sel'));
  assert.ok(ids.length);
});

run('the footprint stamp rolls a trail, and the trail can be selected, moved, turned and deleted', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.buzzes(f);
  await rail.rack(f, 'roller');
  await f.drag({ x: 420, y: 500 }, { x: 670, y: 500 }, 12);
  const [trail] = await f.items(a);
  assert.equal(trail.t, 'f');
  assert.deepEqual(await f.page.evaluate(() => window.buzz), [15], 'one thunk for the trail, not one per print');
  await f.tap({ x: 520, y: 500 });
  assert.ok(await f.box('.nb-sel'));
  await f.drag({ x: 520, y: 500 }, { x: 520, y: 560 });
  const [moved] = await f.items(a);
  assert.ok(Math.abs(moved.p[1] - trail.p[1] - 60 / K) < 2);
  assert.equal(moved.p.length, trail.p.length);
  await f.two([{ x: 480, y: 560 }, { x: 560, y: 560 }], [{ x: 480, y: 520 }, { x: 560, y: 600 }]);
  const [turned] = await f.items(a);
  assert.ok(Math.abs(turned.p[1] - turned.p[turned.p.length - 1]) > 50, 'it now runs at an angle');
  assert.deepEqual(Object.keys(turned).sort(), ['c', 'k', 'p', 't']);
  await f.wait(450);
  const del = await f.box('.nb-sel__del');
  await f.tap({ x: del.x + del.w / 2, y: del.y + del.h / 2 });
  assert.equal((await f.items(a)).length, 0);
});

run('the ABC stamp places text in the ink, which can be turned like any stamp', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.buzzes(f);
  await rail.rack(f, 'text');
  await f.tap({ x: 450, y: 500 });
  assert.deepEqual(await f.page.evaluate(() => window.buzz), [15]);
  await f.page.keyboard.type('Otter');
  await f.page.keyboard.press('Enter');
  await f.wait(550);
  await tweezers(f);
  await f.tap({ x: 470, y: 515 });
  assert.ok(await f.box('.nb-sel'));
  assert.equal(await f.box('.nb-text'), undefined, 'tweezers open no keyboard');
  await f.two([{ x: 430, y: 515 }, { x: 510, y: 515 }], [{ x: 430, y: 480 }, { x: 510, y: 550 }]);
  const [text] = await f.items(a);
  assert.equal(text.v, 'Otter');
  assert.ok(text.r > 0.3, String(text.r));
});

run('with the keyboard up, a text box near the bottom rises above it and everything comes back after', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.evaluate(() => {
    const vv = new EventTarget();
    vv.offsetTop = 0; vv.height = innerHeight;
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  });
  const before = await f.box('.nb__sheet');
  await rail.rack(f, 'text');
  await f.tap({ x: 450, y: 740 });
  await f.page.evaluate(() => { visualViewport.height = 420; visualViewport.dispatchEvent(new Event('resize')); });
  const box = await f.box('.nb-text');
  assert.ok(box.y + box.h <= 420, `${box.y + box.h}`);
  assert.ok(box.y > 0);
  assert.equal((await f.box('.nb__sheet')).w, before.w, 'the page keeps its size');
  await f.page.keyboard.type('Low down');
  await f.page.keyboard.press('Enter');
  await f.wait(550);
  assert.deepEqual(await f.box('.nb__sheet'), before);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').style.height), '');
  assert.equal((await f.items(a))[0].v, 'Low down');
});

run('the panel beside a card uses the settings the roll and tray set: colours, thickness and ink', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'pencil');
  await f.page.click('.nb-roll__colours [data-colour="white"]');
  await f.page.evaluate(() => { const i = document.querySelector('.nb-slider'); i.value = 3; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await f.page.click('.nb-rack--ink');
  await f.page.click('.nb-pop--rail [data-colour="green"]');
  await f.wait(100);
  await f.page.evaluate(() => { window.book.destroy(); document.body.className = ''; document.getElementById('main').dataset.view = 'binder'; document.getElementById('main').style.height = '700px'; document.getElementById('main').style.padding = '0'; });
  await f.page.evaluate(i => { t.open(i, { beside: true, lead: document.createElement('span') }); }, a);
  await f.page.waitForFunction(() => document.querySelector('.nb__sheet canvas').width > 1);
  await f.wait(1600);
  assert.equal(await f.box('.nb-roll'), undefined, 'the panel keeps its own toolbar');
  const pressed = () => f.page.evaluate(() => [...document.querySelectorAll('.nb__tools [data-colour][aria-pressed="true"]')].map(b => b.dataset.colour)[0]);
  assert.equal(await pressed(), 'white');
  assert.ok(await f.page.evaluate(() => Boolean(document.querySelector('.nb__tools .nb-size--thick'))));
  await f.page.click('.nb__tools [data-tool="text"]');
  assert.equal(await pressed(), 'green');
  await f.page.click('.nb__tools [data-tool="pencil"]');
  await f.page.click('.nb__tools .nb-tool--colour');
  await f.page.click('.nb-pop [data-colour="red"]');
  await f.wait(100);
  assert.equal(await f.page.evaluate(() => t.state.profile.notesTools.pencil.colour), 'red', 'and back the other way');
}, { width: 1000, height: 800 });

for (const [name, viewport] of [['a tablet', LANDSCAPE], ['a tablet in portrait', PORTRAIT], ['a phone', PHONE_SIDE], ['a phone in portrait', PHONE_UP]]) {
  run(`${name}: the contents have no roll or tray, only back and the menu in a slim row over a list the full width`, async f => {
    const pages = await f.seed(Array.from({ length: 24 }, () => []));
    await f.show(pages[0]);
    await rail.pick(f, 'ruler');
    await f.page.click('.nb__ribbon');
    await f.wait(650);
    for (const sel of ['.nb-roll', '.nb-tray', '.nb__railfoot', '.nb-ruler']) assert.equal(await f.box(sel).then(b => b?.w ?? 0), 0, sel);
    const back = await f.box('.nb__back'), menu = await f.box('.nb__menu'), list = await f.box('.nb__contents');
    assert.ok(back.w >= 43 && menu.w >= 43);
    assert.ok(Math.abs(back.y - menu.y) < 1, 'one row');
    assert.ok(back.x < 20 && menu.x + menu.w > viewport.width - 20, 'at its ends');
    assert.equal(Math.round(list.w), viewport.width - 16, 'a sheet on the desk');
    assert.ok(list.y >= back.y + back.h && list.y < 70, String(list.y));
    assert.ok(list.y + list.h <= viewport.height + 1);
    await f.page.click('.nb-toc__page');
    await f.wait(700);
    assert.ok((await f.box('.nb-roll')).w > 0, 'the roll and tray come back with a page');
  }, viewport);
}

// ---------- the sponge ----------
const STAMP = { t: 'm', c: '#444444', card: 'none', x: 300, y: 1000, s: 180, r: 0 };
const TRAIL = { t: 'f', c: '#444444', k: 'paw', p: [100, 700, 300, 700] };
const at = onPage;

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

// ---------- the last details ----------
run('the ink pad and the stamps\' rubber show the ink in use', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const fills = () => f.page.evaluate(() => [...document.querySelectorAll('.nb-tray .nb-a-ink')].map(e => getComputedStyle(e).fill));
  const tint = id => f.page.evaluate(c => { const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue(`--pencil-${c}`); document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, id);
  assert.deepEqual([...new Set(await fills())], [await tint('graphite')]);
  await f.page.click('.nb-rack--ink');
  await f.page.click('.nb-pop--rail [data-colour="red"]');
  await f.wait(50);
  const now = await fills(), red = await tint('red');
  assert.equal(now.length, 4, 'the pad and three stamps');
  assert.deepEqual([...new Set(now)], [red]);
});

run('undo, redo and pen or finger are wooden tokens on the roll, bigger than a tap; the panel keeps its icons', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const foot = () => f.page.evaluate(() => [...document.querySelectorAll('.nb__railfoot .nb-token')].map(b => { const r = b.getBoundingClientRect(); return { art: Boolean(b.querySelector('svg')), w: r.width, h: r.height, op: getComputedStyle(b).opacity }; }));
  const tokens = await foot();
  assert.equal(tokens.length, 3);
  for (const k of tokens) { assert.ok(k.art); assert.ok(k.w >= 52 && k.h >= 52, JSON.stringify(k)); assert.equal(k.op, '1', 'never faint, even with nothing to undo'); }
  const input = () => f.page.evaluate(() => document.querySelector('.nb__railfoot .nb-input path:last-child').getAttribute('d'));
  const finger = await input();
  await f.page.click('.nb__railfoot .nb-input');
  await f.wait(50);
  assert.notEqual(await input(), finger, 'it shows which');
  await f.page.evaluate(() => { window.book.destroy(); document.body.className = ''; document.getElementById('main').dataset.view = 'binder'; document.getElementById('main').style.height = '700px'; });
  await f.page.evaluate(i => { t.open(i, { beside: true, lead: document.createElement('span') }); }, a);
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb__tools .nb-undo').textContent), '↶');
});

// The loops at the baseline tablet's size and in portrait: what a tap at the middle of each tool's
// loop finds, and how big that is.
for (const [name, viewport] of [['landscape', LANDSCAPE], ['portrait', PORTRAIT]]) {
  run(`${name}: each tool in the roll has its own 44 px to tap`, async f => {
    const [a] = await f.seed([[], []]);
    await f.show(a);
    const zones = await f.page.evaluate(() => [...document.querySelectorAll('.nb-pt')].map(b => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.pt, w: r.width, h: r.height, hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2).closest('.nb-pt')?.dataset.pt };
    }));
    assert.equal(zones.length, 5);
    for (const z of zones) { assert.ok(Math.min(z.w, z.h) >= 44, JSON.stringify(z)); assert.equal(z.hit, z.id); }
  }, viewport);
}

// ---------- beside a card ----------
const panel = async (f, id) => {
  await f.page.evaluate(() => { document.body.className = ''; document.getElementById('main').dataset.view = 'binder'; document.getElementById('main').style.height = '700px'; document.getElementById('main').style.width = '640px'; document.getElementById('main').style.padding = '0'; });
  await f.page.evaluate(i => { window.fulled = 0; t.open(i, { beside: true, lead: document.createElement('span'), onFull: () => { window.fulled++; } }); }, id);
  await f.page.waitForFunction(() => document.querySelector('.nb__sheet canvas').width > 1);
  await f.wait(1600); // past the nudge
};
const fulled = f => f.page.evaluate(() => window.fulled);

run('the panel\'s open book button is 44 px, labelled, in its top corner, and opens the full notebook', async f => {
  const [a] = await f.seed([[], []]);
  await panel(f, a);
  const b = await f.box('.nb__full'), bar = await f.box('.nb__bar');
  assert.ok(b.w >= 44 && b.h >= 44);
  assert.ok(b.x + b.w >= bar.x + bar.w - 12 && b.y < bar.y + 12, 'in the corner of the bar');
  await f.page.setViewportSize({ width: 400, height: 700 });
  await f.page.evaluate(() => { document.getElementById('main').style.width = '400px'; });
  await f.wait(200);
  const narrow = await f.box('.nb__full'), wrapped = await f.box('.nb__bar');
  assert.ok(wrapped.h > 60 && narrow.y < wrapped.y + 12 && narrow.x + narrow.w >= wrapped.x + wrapped.w - 12, 'and when the bar wraps');
  const clear = await f.page.evaluate(() => { const r = document.querySelector('.nb__full').getBoundingClientRect(); return [...document.querySelectorAll('.nb__pages > *')].every(e => { const b = e.getBoundingClientRect(); return b.right <= r.left || b.top >= r.bottom || !b.width; }); });
  assert.ok(clear, 'over nothing');
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb__full').getAttribute('aria-label')), 'Open the full notebook');
  await f.page.click('.nb__full');
  await f.page.waitForFunction(() => document.querySelector('.nb-grow'));
  assert.equal(await fulled(f), 0, 'it grows first');
  await f.wait(350);
  assert.equal(await fulled(f), 1);
  await f.wait(400);
  assert.equal(await f.box('.nb-grow'), undefined, 'and leaves nothing behind');
}, { width: 640, height: 700 });

run('a pinch past 1.3× on the panel opens the full notebook, saving first; a shorter one goes back', async f => {
  const [a] = await f.seed([[], []]);
  await panel(f, a);
  await f.two([{ x: 270, y: 400 }, { x: 370, y: 400 }], [{ x: 260, y: 400 }, { x: 380, y: 400 }]); // ×1.2
  assert.equal(await fulled(f), 0);
  assert.equal(zoomOf(await f.transform()), 1, 'back to the fitted page');
  await f.drag({ x: 200, y: 300 }, { x: 300, y: 300 }); // something to save
  await f.send('touchStart', [{ x: 270, y: 400, id: 1 }, { x: 370, y: 400, id: 2 }]);
  for (let i = 1; i <= 8; i++) { await f.send('touchMove', [{ x: 270 - i * 5, y: 400, id: 1 }, { x: 370 + i * 5, y: 400, id: 2 }]); await f.wait(16); }
  await f.wait(500);
  assert.equal(await fulled(f), 1, 'crossing it is enough, before the fingers lift');
  await f.send('touchEnd', []);
  await f.wait(100);
  assert.equal(await fulled(f), 1, 'once');
  assert.equal((await f.items(a)).length, 1);
}, { width: 640, height: 700 });

run('with reduced motion the full notebook opens at once, with nothing growing', async f => {
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  const [a] = await f.seed([[], []]);
  await panel(f, a);
  await f.page.click('.nb__full');
  await f.wait(60);
  assert.equal(await fulled(f), 1);
  assert.equal(await f.box('.nb-grow'), undefined);
}, { width: 640, height: 700 });

run('a pinch on a selected item in the panel resizes it and opens nothing; no onFull, no button', async f => {
  const [a] = await f.seed([[{ t: 'p', id: 'missing', x: 500, y: 500, w: 500, h: 500, r: 0 }], []]);
  await panel(f, a);
  await f.page.click('.nb__tools [data-tool="stamp"]');
  await f.page.keyboard.press('Escape');
  await f.page.evaluate(() => document.querySelector('.nb-pick').close());
  const s = await f.box('.nb__sheet'), c = { x: s.x + s.w / 2, y: s.y + (500 * s.h) / 1400 };
  await f.tap(c);
  await f.two([{ x: c.x - 40, y: c.y }, { x: c.x + 40, y: c.y }], [{ x: c.x - 80, y: c.y }, { x: c.x + 80, y: c.y }]);
  assert.equal(await fulled(f), 0);
  assert.ok((await f.items(a))[0].w > 800);
  await f.page.evaluate(i => { t.open(i, { beside: true, lead: document.createElement('span') }); }, a);
  await f.wait(300);
  assert.equal(await f.box('.nb__full'), undefined);
}, { width: 640, height: 700 });

// ---------- the page, the book ----------
const tagged = (f, tag, n) => f.page.evaluate(async ([id, k]) => {
  const ids = [];
  for (let i = 0; i < k; i++) {
    const p = t.notes.blankPage({ tags: [id] });
    p.createdAt = p.header.date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
    await t.notes.savePage(p);
    ids.push(p.id);
  }
  return ids;
}, [tag, n]);

run('a 5:7 page opens centred on the wider paper and is only rewritten if it changes', async f => {
  const [a] = await f.seed([[]]);
  const old = [stroke(100, 300), label(120, 500), { ...STAMP, x: 300 }, TRAIL, { t: 'p', id: 'gone', x: 500, y: 1100, w: 300, h: 200, r: 0 }];
  await f.page.evaluate(async ([i, items]) => {
    const pid = t.state.profile.id, root = await navigator.storage.getDirectory();
    const dir = await (await (await root.getDirectoryHandle('notes')).getDirectoryHandle(pid)).getDirectoryHandle('pages');
    const page = { ...(await t.notes.loadPage(i)), w: 1000, items };
    const w = await (await dir.getFileHandle(`${i}.json`)).createWritable();
    await w.write(JSON.stringify(page));
    await w.close();
  }, [a, old]);
  const raw = () => f.page.evaluate(async i => { const pid = t.state.profile.id, root = await navigator.storage.getDirectory(); const dir = await (await (await root.getDirectoryHandle('notes')).getDirectoryHandle(pid)).getDirectoryHandle('pages'); return JSON.parse(await (await (await dir.getFileHandle(`${i}.json`)).getFile()).text()); }, a);
  await f.show(a);
  const items = await f.items(a);
  assert.equal(items[0].p[0], 160, 'a line: 60 further in');
  assert.equal(items[0].p[1], 300, 'and no lower');
  assert.equal(items[0].p[3], 260, 'every point of it');
  assert.equal(items[1].x, 180);
  assert.equal(items[2].x, 360);
  assert.deepEqual(items[3].p, [160, 700, 360, 700]);
  assert.equal(items[4].x, 560);
  assert.equal((await raw()).w, 1000, 'on disk it is as it was');
  await f.drag({ x: 650, y: 300 }, { x: 750, y: 300 });
  const saved = await raw();
  assert.equal(saved.w, 1120, 'once it changes it is saved at the new width');
  assert.equal(saved.items[0].p[0], 160, 'moved once, not twice');
  assert.equal((await f.items(a))[0].p[0], 160);
});

run('removing a tag: the page stays open, the tabs carry on through the list it was in, and a note says where it went', async f => {
  const [id] = await rail.collect(f, 1);
  const pages = await tagged(f, id, 4);
  await f.show(pages[1], { start: { view: 'pages', scope: { kind: 'animal', id }, pageId: pages[1] } });
  assert.equal(await f.where(), pages[1]);
  await f.page.click('.nb-tag__x');
  await f.wait(100);
  assert.equal(await f.where(), pages[1], 'it stays open');
  assert.match(await f.page.evaluate(() => document.querySelector('.nb__toast').textContent), /Free pages/);
  assert.equal(await f.page.evaluate(() => getComputedStyle(document.querySelector('.nb__nav--next')).display) === 'none', false, 'the tabs still work');
  await f.page.click('.nb__nav--next');
  await f.wait(500);
  assert.equal(await f.where(), pages[2], 'on to its old neighbour');
  await f.page.click('.nb__nav--prev');
  await f.wait(500);
  assert.equal(await f.where(), pages[0], 'and past its old place');
  assert.equal(await f.page.evaluate(i => t.notes.loadPage(i).then(p => p.tags.length), pages[1]), 0, 'a free page now');
});

run('undoing the tag\'s removal puts the page back in its place', async f => {
  const [id] = await rail.collect(f, 1);
  const pages = await tagged(f, id, 3);
  await f.show(pages[1], { start: { view: 'pages', scope: { kind: 'animal', id }, pageId: pages[1] } });
  await f.page.click('.nb-tag__x');
  await f.wait(100);
  await f.page.click('.nb-undo');
  await f.wait(100);
  await f.page.click('.nb__nav--next');
  await f.wait(500);
  assert.equal(await f.where(), pages[2]);
  await f.page.click('.nb__nav--prev');
  await f.wait(500);
  assert.equal(await f.where(), pages[1]);
});

run('the book lies outside the page: the canvas is the size the desk\'s margins leave, with or without it', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const page = await f.box('.nb__sheet'), cover = await f.box('.nb-bk__cover'), spiral = await f.box('.nb-bk__spiral');
  const margins = await f.page.evaluate(() => ['top', 'bottom', 'side'].map(n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--nb-book-${n}`))));
  assert.equal(page.h, 800 - margins[0] - margins[1], 'the whole height but the margins');
  assert.ok(cover.y >= 0 && cover.y + cover.h <= 800, 'the book inside the screen');
  assert.ok(cover.x < page.x && cover.x + cover.w > page.x + page.w && cover.y < page.y && cover.y + cover.h > page.y + page.h, 'and all round the page');
  assert.ok(spiral.y + spiral.h <= page.y + 5, 'the coils above it');
  const blurred = await f.page.evaluate(() => [...document.querySelectorAll('.nb-bk, .nb-bk *, .nb-roll, .nb-tray')].filter(e => { const c = getComputedStyle(e); return c.filter !== 'none' || /px [1-9][0-9]*px [^0]/.test(c.boxShadow) && !/0px [0-9.]+px 0px/.test(c.boxShadow); }).length);
  assert.equal(blurred, 0, 'no filters or soft shadows');
  const desk = await f.page.evaluate(() => getComputedStyle(document.querySelector('.nb')).backgroundImage);
  assert.match(desk, /img\/desk\/wood\.webp/);
});

run('the stack shows how far through the list the page is: pages to come below, pages turned above', async f => {
  const pages = await f.seed(Array.from({ length: 12 }, () => []));
  await f.show(pages[0]);
  const depth = () => f.page.evaluate(() => { const c = document.querySelector('.nb-bk').style; return [c.getPropertyValue('--nb-before'), c.getPropertyValue('--nb-after')].map(Number); });
  const [b0, a0] = await depth();
  assert.equal(b0, 0, 'nothing turned on the first page');
  assert.equal(a0, 1, 'a full stack to come');
  await f.show(pages[6]);
  const [b1, a1] = await depth();
  assert.ok(b1 > 0.5 && a1 > 0.3 && a1 < a0, JSON.stringify([b1, a1]));
  const edge = await f.page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { before: r('.nb-bk__before').top, coils: r('.nb-bk__spiral').top, after: r('.nb-bk__after').bottom, page: r('.nb__sheet').bottom }; });
  assert.ok(edge.before < edge.coils - 2, `turned pages show above the coils: ${JSON.stringify(edge)}`);
  assert.ok(edge.after > edge.page + 2, `pages to come show below the page: ${JSON.stringify(edge)}`);
  await f.show(pages[11]);
  const [b2, a2] = await depth();
  assert.equal(b2, 1);
  assert.equal(a2, 0, 'the end of the book');
});

run('a turn flips one leaf, by transform alone, and leaves nothing behind; reduced motion has none', async f => {
  const [a] = await f.seed([[], [], []]);
  await f.show(a);
  await f.page.click('.nb__nav--next');
  await f.page.waitForSelector('.nb-leaf');
  const props = await f.page.evaluate(() => document.getAnimations().flatMap(x => x.effect.getKeyframes().flatMap(k => Object.keys(k))).filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)));
  assert.deepEqual([...new Set(props)].sort(), ['opacity', 'transform']);
  await f.wait(500);
  assert.equal(await f.box('.nb-leaf'), undefined);
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  await f.page.click('.nb__nav--next');
  await f.wait(60);
  assert.equal(await f.box('.nb-leaf'), undefined);
  assert.equal(await f.place(), 3);
});

run('the contents riffle up to the front, and a page picked riffles down, each under half a second', async f => {
  const pages = await f.seed(Array.from({ length: 8 }, () => []));
  await f.show(pages[5]);
  const riffle = () => f.page.evaluate(() => { const all = document.getAnimations().filter(x => x.effect.target.closest?.('.nb-leaf')); return { n: all.length, ms: Math.max(...all.map(x => x.effect.getComputedTiming().endTime)) }; });
  await f.page.click('.nb__ribbon');
  await f.page.waitForSelector('.nb-leaf');
  const up = await riffle();
  assert.ok(up.n >= 2 && up.ms < 500, JSON.stringify(up));
  assert.notEqual(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'contents', 'the book first');
  await f.wait(550);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'contents');
  await f.page.click('.nb-toc__page');
  await f.page.waitForSelector('.nb-leaf');
  const down = await riffle();
  assert.ok(down.n >= 2 && down.ms < 500, JSON.stringify(down));
  await f.wait(550);
  assert.equal(await f.box('.nb-leaf'), undefined);
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  await f.page.click('.nb__ribbon');
  await f.wait(60);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'contents', 'at once');
});

run('the roll unrolls once when the notebook opens, by transform alone; reduced motion skips it', async f => {
  const [a] = await f.seed([[], []]);
  await f.page.evaluate(i => t.open(i), a);
  await f.page.waitForFunction(() => document.getAnimations().some(x => x.effect.target.matches('.nb-roll')));
  const props = await f.page.evaluate(() => document.getAnimations().filter(x => x.effect.target.closest('.nb-roll')).flatMap(x => x.effect.getKeyframes().flatMap(k => Object.keys(k))).filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)));
  assert.deepEqual([...new Set(props)], ['transform']);
  await f.wait(500);
  await f.page.click('.nb__nav--next');
  await f.wait(60);
  assert.equal(await f.page.evaluate(() => document.getAnimations().filter(x => x.effect.target.matches?.('.nb-roll')).length), 0, 'not again on a turn');
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  await f.page.evaluate(i => t.open(i), a);
  await f.wait(150);
  assert.equal(await f.page.evaluate(() => document.getAnimations().length), 0);
});

// ---------- washi tape ----------
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

// ---------- the Polaroids ----------
const shot = async f => {
  const b64 = await f.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1800; c.height = 1200; const x = c.getContext('2d'); x.fillStyle = '#3080d0'; x.fillRect(0, 0, 1800, 1200); return c.toDataURL('image/jpeg').split(',')[1]; });
  await f.page.setInputFiles('.nb > input[accept="image/*"]', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await f.page.waitForSelector('.nb-polaroid');
};
const photosOn = f => f.page.evaluate(async () => { const pid = t.state.profile.id; const root = await navigator.storage.getDirectory(); try { const d = await (await (await root.getDirectoryHandle('notes')).getDirectoryHandle(pid)).getDirectoryHandle('photos'); let n = 0; for await (const _ of d.values()) n++; return n; } catch { return 0; } });

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
