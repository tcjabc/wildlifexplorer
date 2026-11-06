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
const LEFT = { x: 350, y: 500 }, RIGHT = { x: 930, y: 500 };
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
    },
    items: id => page.evaluate(i => t.items(i), id),
    where: () => page.evaluate(() => t.where().pageId),
    // The first page open, by what the ribbon says (touching a page only makes it the active one).
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
// Picks up the tweezers, from the right rail.
const tweezers = f => f.page.click('.nb-rack[data-rack="tweezers"]');
const zoomOf = m => (m === 'none' ? 1 : Number(m.match(/matrix\(([^,]+)/)[1]));
const run = (name, fn, viewport) => test(name, { skip }, async () => {
  const f = await open(viewport);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});

run('landscape: an open spread at full height, with no app header and no toolbar above it', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const sheets = await f.page.evaluate(() => [...document.querySelectorAll('.nb__sheet')].filter(s => !s.hidden).map(s => s.getBoundingClientRect().height));
  assert.deepEqual(sheets.map(Math.round), [800, 800]);
  assert.equal(await f.box('.nb__bar'), undefined);
  assert.ok((await f.box('.nb__rail--start')).w <= 68);
  assert.ok(await f.box('.nb__ribbon'));
  // Capped at 1.5 on a 2x screen.
  const canvas = await f.page.evaluate(() => { const c = document.querySelector('.nb__base'); return c.width / c.getBoundingClientRect().width; });
  assert.ok(Math.abs(canvas - 1.5) < 0.01, String(canvas));
});

run('portrait: one page, rails above and below it, and the page as big as the width allows', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const sheets = await f.page.evaluate(() => [...document.querySelectorAll('.nb__sheet')].filter(s => !s.hidden).length);
  assert.equal(sheets, 1);
  const page = await f.box('.nb__sheet'), top = await f.box('.nb__rail--start'), end = await f.box('.nb__rail--end');
  assert.equal(Math.round(page.w), 800);
  assert.ok(top.y + top.h <= page.y + 1 && page.y + page.h <= end.y + 1);
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

run('one finger draws on the page it touches, as a vector stroke', async f => {
  const [a, b] = await f.seed([[], []]);
  await f.show(a);
  await f.drag(LEFT, { x: LEFT.x + 150, y: LEFT.y });
  await f.drag(RIGHT, { x: RIGHT.x + 150, y: RIGHT.y + 40 });
  const [left, right] = [await f.items(a), await f.items(b)];
  assert.equal(left.length, 1);
  assert.equal(right.length, 1);
  assert.equal(right[0].t, 's');
  assert.equal(right[0].p.length % 3, 0, 'x, y, pressure');
  assert.ok(right[0].p[0] > 0 && right[0].p[0] < 1000, 'in the page\'s own units');
});

run('undo goes back through both pages in the order things were done', async f => {
  const [a, b] = await f.seed([[], []]);
  await f.show(a);
  await f.drag(LEFT, { x: LEFT.x + 150, y: LEFT.y });
  await f.drag(RIGHT, { x: RIGHT.x + 150, y: RIGHT.y });
  await f.page.click('.nb-undo');
  await f.wait(550);
  assert.equal((await f.items(b)).length, 0);
  assert.equal((await f.items(a)).length, 1);
  await f.page.click('.nb-undo');
  await f.wait(550);
  assert.equal((await f.items(a)).length, 0);
});

run('two fingers zoom without marking the page, and the sharp canvas stays screen sized', async f => {
  const [a] = await f.seed([[stroke(200, 400)], []]);
  await f.show(a);
  await f.two([{ x: 300, y: 400 }, { x: 500, y: 400 }], [{ x: 150, y: 400 }, { x: 650, y: 400 }]);
  assert.ok(zoomOf(await f.transform()) > 2, await f.transform());
  assert.equal((await f.items(a)).length, 1);
  const detail = await f.page.evaluate(() => { const c = document.querySelector('.nb__detail'); return { hidden: c.hidden, w: c.width, h: c.height }; });
  assert.equal(detail.hidden, false);
  assert.ok(detail.w <= 1152 * 1.5 + 1 && detail.h <= 800 * 1.5 + 1, JSON.stringify(detail));
  const base = await f.page.evaluate(() => document.querySelector('.nb__base').width);
  assert.ok(base < 900, 'the page bitmap stays at the fitted size');
});

run('drawing while zoomed in lands where the finger is', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.two([{ x: 300, y: 400 }, { x: 500, y: 400 }], [{ x: 200, y: 400 }, { x: 600, y: 400 }]); // 2x around x 400
  const before = await f.page.evaluate(() => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector('.nb__book')).transform);
    const desk = document.querySelector('.nb__desk').getBoundingClientRect(), sheet = document.querySelector('.nb__sheet');
    const unit = sheet.offsetWidth / 1000;
    return { x: (400 - desk.left - m.e) / m.a / unit, y: (300 - desk.top - m.f) / m.d / unit };
  });
  await f.drag({ x: 400, y: 300 }, { x: 460, y: 300 });
  const [mark] = await f.items(a);
  assert.ok(Math.abs(mark.p[0] - before.x) < 2 && Math.abs(mark.p[1] - before.y) < 2, JSON.stringify([mark.p.slice(0, 2), before]));
});

run('a clear sideways two-finger swipe turns the page; a pinch never does', async f => {
  const [a] = await f.seed([[], [], [], []]);
  await f.show(a);
  // A pinch drifting sideways the whole way across.
  await f.two([{ x: 700, y: 300 }, { x: 800, y: 300 }], [{ x: 300, y: 300 }, { x: 500, y: 300 }]);
  assert.equal(await f.place(), 1, 'a pinch that drifts does not turn');
  await f.page.evaluate(() => t.open(t.ids()[0]));
  await f.wait(300);
  // Only just a pinch: 6% apart at the widest, then back.
  await f.two([{ x: 700, y: 300 }, { x: 900, y: 300 }], [{ x: 400, y: 300 }, { x: 612, y: 300 }]);
  assert.equal(await f.place(), 1, 'over 5% is a pinch');
  await f.page.evaluate(() => t.open(t.ids()[0]));
  await f.wait(300);
  // Too short.
  await f.two([{ x: 700, y: 300 }, { x: 900, y: 300 }], [{ x: 640, y: 300 }, { x: 840, y: 300 }]);
  assert.equal(await f.place(), 1, 'too short');
  // Too slanted.
  await f.two([{ x: 700, y: 200 }, { x: 900, y: 200 }], [{ x: 500, y: 400 }, { x: 700, y: 400 }]);
  assert.equal(await f.place(), 1, 'not sideways');
  // Clear.
  await f.two([{ x: 800, y: 300 }, { x: 1000, y: 300 }], [{ x: 500, y: 300 }, { x: 700, y: 300 }]);
  assert.equal(await f.place(), 3, 'turns a whole spread');
  await f.two([{ x: 300, y: 300 }, { x: 500, y: 300 }], [{ x: 600, y: 300 }, { x: 800, y: 300 }]);
  assert.equal(await f.place(), 1, 'and back');
});

run('fingers 60 px apart turn the page with 8 px of drift, but not with 14', async f => {
  const [a] = await f.seed([[], [], [], []]);
  await f.show(a);
  await f.two([{ x: 700, y: 300 }, { x: 760, y: 300 }], [{ x: 400, y: 300 }, { x: 468, y: 300 }]);
  assert.equal(await f.place(), 3, '8 px of drift turns the page');
  await f.two([{ x: 300, y: 300 }, { x: 360, y: 300 }], [{ x: 600, y: 300 }, { x: 674, y: 300 }]);
  assert.equal(await f.place(), 3, '14 px is a pinch');
});

run('zoomed in, a sideways two-finger swipe pans instead of turning', async f => {
  const [a] = await f.seed([[], [], []]);
  await f.show(a);
  await f.two([{ x: 300, y: 400 }, { x: 500, y: 400 }], [{ x: 200, y: 400 }, { x: 600, y: 400 }]);
  const m1 = await f.transform();
  await f.two([{ x: 800, y: 300 }, { x: 1000, y: 300 }], [{ x: 500, y: 300 }, { x: 700, y: 300 }]);
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
  await f.send('touchStart', [{ x: LEFT.x + 50, y: LEFT.y, id: 1 }, { x: 200, y: 200, id: 2 }]);
  await f.send('touchMove', [{ x: LEFT.x + 120, y: LEFT.y, id: 1 }, { x: 200, y: 200, id: 2 }]);
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
  const px = await f.page.evaluate(() => { const s = document.querySelector('.nb__sheet').getBoundingClientRect(); return { x: s.x + (360 * s.width) / 1000, y: s.y + (520 * s.height) / 1400 }; });
  await f.tap(px);
  assert.ok(await f.box('.nb-sel'), 'selected, and the click ending the tap did not land on ✕');
  assert.deepEqual(await f.items(a), [label(300, 500)], 'a tap leaves it where it was, and no dot');
  await f.drag(px, { x: px.x + 100, y: px.y + 60 });
  const [moved] = await f.items(a);
  assert.equal(moved.t, 'x');
  assert.ok(moved.x > 400, String(moved.x));
  await f.tap({ x: 200, y: 700 });
  assert.equal(await f.box('.nb-sel'), undefined, 'let go');
  assert.equal((await f.items(a)).length, 1, 'no dot');
  await f.tap({ x: 200, y: 700 });
  assert.equal((await f.items(a)).length, 1, 'tweezers never mark the page');
});

run('tweezers: one press selects and drags, in a single move', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await tweezers(f);
  const at = { x: 69 + 360 * 0.571, y: 520 * 0.571 };
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
  await f.tap({ x: 69 + 150 * 0.571, y: 300 * 0.571 });
  assert.equal(await f.box('.nb-sel'), undefined, 'a line can\'t be selected');
  await f.drag({ x: 69 + 150 * 0.571, y: 500 * 0.571 }, { x: 400, y: 400 });
  assert.deepEqual(await f.items(a), lines);
  await f.drag({ x: 500, y: 600 }, { x: 150, y: 610 });
  assert.equal(await f.place(), 1, 'a missed grab keeps the page');
  await f.two([{ x: 800, y: 300 }, { x: 1000, y: 300 }], [{ x: 500, y: 300 }, { x: 700, y: 300 }]);
  assert.equal(await f.place(), 3, 'two fingers still turn it');
});

run('tweezers work with a finger in pen-only mode', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await f.page.evaluate(() => { t.state.profile.notesInput = 'pen'; });
  await tweezers(f);
  const at = { x: 69 + 360 * 0.571, y: 520 * 0.571 };
  await f.drag(at, { x: at.x + 100, y: at.y });
  assert.ok((await f.items(a))[0].x > 400);
});

run('an animal stamp can be moved, resized and turned with the tweezers, and removed with ✕', async f => {
  const [id] = await rail.collect(f, 1);
  const stamp = { t: 'm', c: '#444444', card: id, x: 400, y: 700, s: 180, r: 0 };
  const [a] = await f.seed([[stamp], []]);
  await f.show(a);
  await tweezers(f);
  const c = { x: 69 + 400 * 0.571, y: 700 * 0.571 };
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
  const px = (x, y) => ({ x: 69 + x * 0.571, y: y * 0.571 });
  await tweezers(f);
  await f.tap(px(500 + (100 * ratio) - 12, 700)); // near its far end, well outside a 200 square
  const box = await f.box('.nb-sel');
  assert.ok(box, 'selected');
  assert.ok(Math.abs(box.w - 200 * ratio * 0.571) < 3, `${box.w}`);
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
    await f.tap({ x: 69 + 160 * 0.571, y: 320 * 0.571 });
    await f.tap({ x: 69 + 500 * 0.571, y: 900 * 0.571 });
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
  const at = { x: 69 + 160 * 0.571, y: 320 * 0.571 };
  await f.tap(at);
  assert.equal(await f.box('.nb-sel'), undefined);
  await rail.pick(f, 'pencil');
  await f.page.evaluate(() => { t.state.profile.notesInput = 'pen'; });
  await f.tap(at);
  assert.equal(await f.box('.nb-sel'), undefined);
  assert.equal((await f.items(a)).length, 1);
});

run('a photo just added stays selected with the pencil in hand, so it can be placed', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await f.page.setInputFiles('input[accept="image/*"]', { name: 'p.png', mimeType: 'image/png', buffer: png });
  await f.page.waitForSelector('.nb-sel');
  const b = await f.box('.nb__sheet'), c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  await f.wait(500);
  await f.drag(c, { x: c.x + 60, y: c.y + 40 });
  const [photo] = await f.items(a);
  assert.equal(photo.t, 'p');
  assert.ok(photo.x > 560, String(photo.x));
});

run('✕ ignores a tap straight after selecting, and works after that', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await tweezers(f);
  const px = await f.page.evaluate(() => { const s = document.querySelector('.nb__sheet').getBoundingClientRect(); return { x: s.x + (360 * s.width) / 1000, y: s.y + (520 * s.height) / 1400 }; });
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

run('a blank right page is saved only once it is marked, and stays after the left page', async f => {
  const [a] = await f.seed([[]]);
  await f.show(a);
  assert.deepEqual(await f.page.evaluate(() => t.ids()), [a], 'looking saves nothing');
  await f.drag(RIGHT, { x: RIGHT.x + 120, y: RIGHT.y });
  const ids = await f.page.evaluate(() => t.ids());
  assert.equal(ids.length, 2);
  assert.equal(ids[0], a);
  assert.equal((await f.items(ids[1])).length, 1);
});

run('a first mark on the right of two blanks keeps the left page in its place', async f => {
  await f.page.evaluate(async () => {
    const page = await t.notes.createPage({ tags: [t.state.cards[0].id] }); // one page to open the list with
    await t.notes.deletePage(page.id);
    window.book = (await import('/js/notebook.js')).notebook({ cardId: t.state.cards[0].id });
    document.getElementById('main').replaceChildren(window.book.el);
  });
  await f.page.waitForFunction(() => document.querySelector('.nb')?.dataset.view === 'pages');
  await f.wait(200);
  await f.drag(RIGHT, { x: RIGHT.x + 120, y: RIGHT.y });
  const ids = await f.page.evaluate(() => t.ids());
  assert.equal(ids.length, 2);
  assert.equal((await f.items(ids[0])).length, 0);
  assert.equal((await f.items(ids[1])).length, 1);
});

run('turning tabs and the ribbon work, and the ribbon opens the contents', async f => {
  const [a, , c] = await f.seed([[], [], [], []]);
  await f.show(a);
  assert.equal(await f.page.evaluate(() => getComputedStyle(document.querySelector('.nb__nav--prev')).display), 'none', 'nothing before the first page');
  await f.page.click('.nb__nav--next');
  await f.wait(300);
  assert.equal(await f.where(), c);
  await f.page.click('.nb__ribbon');
  await f.wait(200);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'contents');
});

run('new page and the menu stay in reach, and the menu says which page it means', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.click('.nb__rail--end .nb__new');
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => t.ids().length), 3);
  await f.page.click('.nb__rail--end .btn:not(.nb__new)');
  await f.wait(100);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.nb-menu__sides button').length), 2);
});

run('an old page keeps all its data through a visit: only what was added changes', async f => {
  const old = [stroke(100, 300), label(120, 500), { t: 'f', c: '#444', k: 'paw', p: [100, 900, 300, 900] }, { t: 'p', id: 'gone', x: 500, y: 1100, w: 300, h: 200, r: 0.05 }];
  const [a] = await f.seed([old, []]);
  await f.show(a);
  await f.drag({ x: 350, y: 300 }, { x: 450, y: 300 });
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
  assert.equal(await f.page.evaluate(() => [...document.querySelectorAll('.nb__sheet')].filter(s => !s.hidden).length), 1);
  const y0 = (await f.box('.nb__sheet')).y;
  await f.two([{ x: 300, y: 350 }, { x: 500, y: 350 }], [{ x: 300, y: 200 }, { x: 500, y: 200 }]);
  assert.ok((await f.box('.nb__sheet')).y < y0 - 100);
  assert.equal((await f.items(a)).length, 0);
});

// ---------- the rails ----------
const rail = {
  // The ruler's place: where its element is, as the notebook set it.
  ruler: f => f.page.evaluate(() => { const r = document.querySelector('.nb-ruler'); return r.hidden ? null : { left: parseFloat(r.style.left), top: parseFloat(r.style.top), turn: parseFloat(r.style.transform.slice(7)) }; }),
  pick: (f, id) => f.page.click(`.nb-pt[data-pt="${id}"]`),
  rack: (f, id) => f.page.click(`.nb-rack[data-rack="${id}"]`),
  // Collected animals with a silhouette.
  collect: (f, n) => f.page.evaluate(k => { const ids = t.state.cards.filter(c => c.silhouette?.file).slice(0, k).map(c => c.id); for (const id of ids) t.state.collected[id] = { cardId: id }; return ids; }, n),
  buzzes: f => f.page.evaluate(() => { window.buzz = []; navigator.vibrate = ms => { window.buzz.push(ms); return true; }; }),
  // A pixel of the left page, at page units.
  pixel: (f, x, y) => f.page.evaluate(([px, py]) => {
    const c = document.querySelector('.nb__base'), k = c.width / 1000;
    return [...c.getContext('2d').getImageData(Math.round(px * k), Math.round(py * k), 1, 1).data];
  }, [x, y]),
};
const PHONE_SIDE = { width: 780, height: 360 }, PHONE_UP = { width: 360, height: 740 };

for (const [name, viewport, across] of [['a tablet', LANDSCAPE, true], ['a phone', PHONE_SIDE, true], ['a tablet in portrait', PORTRAIT, false], ['a phone in portrait', PHONE_UP, false]]) {
  run(`${name}: ${across ? 'side rails' : 'bands'}, with back, new page and the menu at their ends and nothing cut off`, async f => {
    const [a] = await f.seed([[], []]);
    await f.show(a);
    const start = await f.box('.nb__rail--start'), end = await f.box('.nb__rail--end'), page = await f.box('.nb__sheet');
    if (across) assert.ok(start.x + start.w <= page.x + 1 && start.h >= viewport.height - 1);
    else assert.ok(start.y + start.h <= page.y + 1 && page.y + page.h <= end.y + 1);
    const inside = (b, r) => b.x >= r.x - 1 && b.y >= r.y - 1 && b.x + b.w <= r.x + r.w + 1 && b.y + b.h <= r.y + r.h + 1;
    for (const sel of ['.nb__back', '.nb__pouch', '.nb__railfoot', '.nb-undo']) assert.ok(inside(await f.box(sel), start), sel);
    for (const sel of ['.nb__new', '.nb__rack', '.nb-rack--ink', '.nb-rack[data-rack="sponge"]', '.nb-rack[data-rack="tweezers"]', '.nb__rack-room']) assert.ok(inside(await f.box(sel), end), sel);
    const rack = await f.box('.nb__rack');
    assert.ok(await f.page.evaluate(() => { const r = document.querySelector('.nb__rack'); return r.scrollHeight <= r.clientHeight + 1 && r.scrollWidth <= r.clientWidth + 1; }), `nothing spills out of ${JSON.stringify(rack)}`);
    assert.ok((await f.box('.nb__back')).x < (await f.box('.nb__pouch')).x + (across ? 68 : 1), 'back comes first');
    assert.ok((await f.box('.nb__new'))[across ? 'y' : 'x'] < (await f.box('.nb__rack'))[across ? 'y' : 'x'], 'new page before the stamps');
    const taps = await f.page.evaluate(() => [...document.querySelectorAll('.nb-pt, .nb-rack')].map(b => { const r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }));
    assert.ok(taps.every(s => s >= 43), String(taps));
  }, viewport);
}

run('the pouch: the tool in use stands raised, and tapped again opens its colours and thickness', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const raised = () => f.page.evaluate(() => [...document.querySelectorAll('.nb-pt[data-raised]')].map(b => b.dataset.pt));
  assert.deepEqual(await raised(), ['pencil']);
  await rail.pick(f, 'pen');
  assert.deepEqual(await raised(), ['pen']);
  assert.equal((await f.box('.nb-pop--rail')).w, 0, 'the first tap only picks it up');
  await rail.pick(f, 'pen');
  const count = sel => f.page.evaluate(s => document.querySelectorAll(`.nb-pop--rail ${s}`).length, sel);
  assert.equal(await count('[data-colour]'), 9);
  assert.equal(await count('[data-colour="white"]'), 1);
  assert.equal(await count('[data-thick]'), 2);
  const pop = await f.box('.nb-pop--rail');
  assert.ok(pop.x >= 68, 'beside the rail');
  await rail.pick(f, 'highlighter');
  await rail.pick(f, 'highlighter');
  assert.equal(await count('[data-colour]'), 0);
  assert.deepEqual(await f.page.evaluate(() => [...document.querySelectorAll('.nb-pop--rail [data-hl]')].map(b => b.dataset.hl)), ['cyan', 'yellow', 'magenta']);
  await rail.pick(f, 'eraser');
  await rail.pick(f, 'eraser');
  assert.equal((await f.box('.nb-pop--rail')).w, 0, 'the eraser has nothing to choose');
});

run('in a band the popover stays on the screen: the ink pad at the bottom opens upward', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.click('.nb-rack--ink');
  const pop = await f.box('.nb-pop--rail'), pad = await f.box('.nb-rack--ink');
  assert.ok(pop.y + pop.h <= pad.y + 1);
}, PORTRAIT);

run('each tool draws its own kind of line; c stays a plain colour and a pencil line stays as it always was', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.drag({ x: 300, y: 300 }, { x: 400, y: 300 });
  await rail.pick(f, 'pen');
  await f.drag({ x: 300, y: 350 }, { x: 400, y: 350 });
  await rail.pick(f, 'highlighter');
  await f.drag({ x: 300, y: 400 }, { x: 400, y: 400 });
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
  await f.tap({ x: 69 + 150 * 0.571, y: 300 * 0.571 });
  await f.drag({ x: 69 + 150 * 0.571, y: 480 * 0.571 }, { x: 69 + 150 * 0.571, y: 760 * 0.571 });
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
  await f.drag({ x: 354, y: 400 }, { x: 354, y: 500 });
  assert.ok(Math.abs((await rail.ruler(f)).top - at.top - 100) < 2);
  assert.equal((await f.items(a)).length, 0, 'moving it draws nothing');
  await rail.pick(f, 'ruler');
  assert.equal(await rail.ruler(f), null, 'back in the pouch');
  const page = await f.page.evaluate(i => t.notes.loadPage(i), a);
  assert.deepEqual(Object.keys(page).sort(), ['createdAt', 'editedAt', 'header', 'h', 'id', 'items', 'paper', 'tags', 'version', 'w'].sort());
});

run('the ruler can be dragged from the pouch onto the page, and goes back if let go off it', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const b = await f.box('.nb-pt[data-pt="ruler"]'), from = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  await f.drag(from, { x: 500, y: 400 });
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
  await f.two([{ x: 200, y: 400 }, { x: 500, y: 400 }], [{ x: 200, y: 340 }, { x: 500, y: 460 }]);
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
  await f.two([{ x: 320, y: 620 }, { x: 420, y: 620 }], [{ x: 220, y: 620 }, { x: 520, y: 620 }]);
  assert.notEqual(await f.transform(), view);
  assert.deepEqual(await rail.ruler(f), at);
});

run('one finger on the ruler and one off it: a pan or zoom, and the ruler stays put', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'ruler');
  const at = await rail.ruler(f), view = await f.transform();
  await f.two([{ x: 300, y: 400 }, { x: 300, y: 650 }], [{ x: 300, y: 300 }, { x: 300, y: 750 }]);
  assert.notEqual(await f.transform(), view);
  assert.deepEqual(await rail.ruler(f), at);
});

run('a second finger on the ruler turns it even long after the first, while one off it by then is a brush of the hand', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'ruler');
  const view = await f.transform();
  await f.send('touchStart', [{ x: 200, y: 400, id: 1 }]);
  await f.wait(350);
  await f.send('touchStart', [{ x: 200, y: 400, id: 1 }, { x: 500, y: 400, id: 2 }]);
  await f.wait(30);
  await f.send('touchMove', [{ x: 200, y: 400, id: 1 }, { x: 500, y: 500, id: 2 }]);
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
  await wobble(160, 436);
  await rail.pick(f, 'highlighter');
  await wobble(160, 364);
  await wobble(160, 520);
  const [low, high, free] = await f.items(a);
  const ys = it => it.p.filter((_, i) => i % 3 === 1);
  assert.ok(ys(low).every(y => Math.abs(y - 748) < 0.01), 'the lower edge');
  assert.ok(ys(high).every(y => Math.abs(y - 652) < 0.01), 'the upper edge');
  assert.ok(Math.max(...ys(free)) - Math.min(...ys(free)) > 10, 'away from it, the line goes where the finger goes');
});

run('a line along a turned ruler follows it, on the right page of a spread too', async f => {
  const [a, b] = await f.seed([[], []]);
  await f.show(a);
  await f.tap({ x: 930, y: 700 }); // the right page is the one being worked on
  await rail.pick(f, 'ruler');
  await f.two([{ x: 780, y: 400 }, { x: 1080, y: 400 }], [{ x: 780, y: 300 }, { x: 1080, y: 500 }]);
  const { turn } = await rail.ruler(f);
  // Just off its lower edge, then roughly along it.
  const x0 = 930 - Math.sin(turn) * 35, y0 = 400 + Math.cos(turn) * 35;
  await f.send('touchStart', [{ x: x0, y: y0, id: 1 }]);
  for (let i = 1; i <= 8; i++) { await f.send('touchMove', [{ x: x0 + i * 15, y: y0 + i * 12, id: 1 }]); await f.wait(16); }
  await f.send('touchEnd', []);
  await f.wait(550);
  const dots = (await f.items(b)).filter(i => i.p.length > 3).at(-1).p;
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
  await pen('mousePressed', 200, 410);
  for (let i = 1; i <= 6; i++) { await pen('mouseMoved', 200 + i * 30, 415); await f.wait(16); }
  await pen('mouseReleased', 380, 415);
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
  await f.tap({ x: 350, y: 600 });
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
  await f.tap({ x: 350, y: 600 });
  await f.tap({ x: 350, y: 600 });
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
  await f.drag({ x: 200, y: 500 }, { x: 450, y: 500 }, 12);
  const [trail] = await f.items(a);
  assert.equal(trail.t, 'f');
  assert.deepEqual(await f.page.evaluate(() => window.buzz), [15], 'one thunk for the trail, not one per print');
  await f.tap({ x: 300, y: 500 });
  assert.ok(await f.box('.nb-sel'));
  await f.drag({ x: 300, y: 500 }, { x: 300, y: 560 });
  const [moved] = await f.items(a);
  assert.ok(Math.abs(moved.p[1] - trail.p[1] - 60 / 0.571) < 2);
  assert.equal(moved.p.length, trail.p.length);
  await f.two([{ x: 260, y: 560 }, { x: 340, y: 560 }], [{ x: 260, y: 520 }, { x: 340, y: 600 }]);
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
  await f.tap({ x: 250, y: 500 });
  assert.deepEqual(await f.page.evaluate(() => window.buzz), [15]);
  await f.page.keyboard.type('Otter');
  await f.page.keyboard.press('Enter');
  await f.wait(550);
  await tweezers(f);
  await f.tap({ x: 270, y: 515 });
  assert.ok(await f.box('.nb-sel'));
  assert.equal(await f.box('.nb-text'), undefined, 'tweezers open no keyboard');
  await f.two([{ x: 230, y: 515 }, { x: 310, y: 515 }], [{ x: 230, y: 480 }, { x: 310, y: 550 }]);
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
  await f.tap({ x: 300, y: 740 });
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

run('the panel beside a card uses the settings the rails set: colours, thickness and ink', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'pencil');
  await f.page.click('.nb-pop--rail [data-colour="white"]');
  await f.page.click('.nb-pop--rail [data-thick="thick"]');
  await f.page.mouse.click(5, 5);
  await f.page.click('.nb-rack--ink');
  await f.page.click('.nb-pop--rail [data-colour="green"]');
  await f.wait(100);
  await f.page.evaluate(() => { window.book.destroy(); document.body.className = ''; document.getElementById('main').dataset.view = 'binder'; document.getElementById('main').style.height = '700px'; document.getElementById('main').style.padding = '0'; });
  await f.page.evaluate(i => { t.open(i, { beside: true, lead: document.createElement('span') }); }, a);
  await f.page.waitForFunction(() => document.querySelector('.nb__sheet canvas').width > 1);
  await f.wait(1600);
  assert.equal(await f.box('.nb__pouch'), undefined, 'the panel keeps its own toolbar');
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
  run(`${name}: the contents have no rails, only back and the menu in a slim row over a list the full width`, async f => {
    const pages = await f.seed(Array.from({ length: 24 }, () => []));
    await f.show(pages[0]);
    await rail.pick(f, 'ruler');
    await f.page.click('.nb__ribbon');
    await f.wait(200);
    for (const sel of ['.nb__pouch', '.nb__rack', '.nb__railfoot', '.nb-ruler']) assert.equal(await f.box(sel).then(b => b?.w ?? 0), 0, sel);
    const back = await f.box('.nb__back'), menu = await f.box('.nb__rail--end .btn:not(.nb__new)'), list = await f.box('.nb__contents');
    assert.ok(back.w >= 43 && menu.w >= 43);
    assert.ok(Math.abs(back.y - menu.y) < 1, 'one row');
    assert.ok(back.x < 20 && menu.x + menu.w > viewport.width - 20, 'at its ends');
    assert.equal(Math.round(list.w), viewport.width);
    assert.ok(list.y >= back.y + back.h && list.y < 70, String(list.y));
    assert.ok(list.y + list.h <= viewport.height + 1);
    await f.page.click('.nb-toc__page');
    await f.wait(300);
    assert.ok((await f.box('.nb__pouch')).w > 0, 'the rails come back with a page');
  }, viewport);
}

// ---------- the sponge ----------
const STAMP = { t: 'm', c: '#444444', card: 'none', x: 300, y: 1000, s: 180, r: 0 };
const TRAIL = { t: 'f', c: '#444444', k: 'paw', p: [100, 700, 300, 700] };
const at = (x, y) => ({ x: 69 + x * 0.571, y: y * 0.571 });

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
  await f.page.click('.nb__railfoot .nb-tool:nth-child(3)');
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

run('a resting finger can\'t wipe in pen-only mode, and the pouch eraser still takes only lines', async f => {
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

// ---------- the rails' last details ----------
run('the ink pad and the stamps\' rubber show the ink in use', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const fills = () => f.page.evaluate(() => [...document.querySelectorAll('.nb__rack .nb-a-ink')].map(e => getComputedStyle(e).fill));
  const tint = id => f.page.evaluate(c => { const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue(`--pencil-${c}`); document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, id);
  assert.deepEqual([...new Set(await fills())], [await tint('graphite')]);
  await f.page.click('.nb-rack--ink');
  await f.page.click('.nb-pop--rail [data-colour="red"]');
  await f.wait(50);
  const now = await fills(), red = await tint('red');
  assert.equal(now.length, 4, 'the pad and three stamps');
  assert.deepEqual([...new Set(now)], [red]);
});

run('undo, redo and pen or finger are wooden tokens on the rails; the panel keeps its icons', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const foot = () => f.page.evaluate(() => [...document.querySelectorAll('.nb__railfoot .nb-token')].map(b => { const r = b.getBoundingClientRect(); return { art: Boolean(b.querySelector('svg')), w: r.width, h: r.height, op: getComputedStyle(b).opacity }; }));
  const tokens = await foot();
  assert.equal(tokens.length, 3);
  for (const k of tokens) { assert.ok(k.art); assert.ok(k.w >= 44 && k.h >= 44, JSON.stringify(k)); assert.equal(k.op, '1', 'never faint, even with nothing to undo'); }
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

// The pouch's tips at the baseline tablet's size and in portrait bands: what a tap at the middle of
// each tool's row finds, and how big that row is.
for (const [name, viewport] of [['landscape', LANDSCAPE], ['portrait', PORTRAIT]]) {
  run(`${name}: each tool in the pouch has its own 44 px of tip to tap`, async f => {
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
