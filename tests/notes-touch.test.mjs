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

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
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
  assert.ok((await f.box('.nb__rail--start')).w <= 64);
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

run('a tap selects text, a drag inside its box moves it, and a tap elsewhere lets go without a dot', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  const px = await f.page.evaluate(() => { const s = document.querySelector('.nb__sheet').getBoundingClientRect(); return { x: s.x + (360 * s.width) / 1000, y: s.y + (520 * s.height) / 1400 }; });
  await f.tap(px);
  assert.ok(await f.box('.nb-sel'), 'selected, and the click ending the tap did not land on ✕');
  assert.equal((await f.items(a)).length, 1, 'the tap left no dot');
  await f.drag(px, { x: px.x + 100, y: px.y + 60 });
  const [moved] = await f.items(a);
  assert.equal(moved.t, 'x');
  assert.ok(moved.x > 400, String(moved.x));
  await f.tap({ x: 200, y: 700 });
  assert.equal(await f.box('.nb-sel'), undefined, 'let go');
  assert.equal((await f.items(a)).length, 1, 'no dot');
  await f.tap({ x: 200, y: 700 });
  assert.equal((await f.items(a)).length, 2, 'with nothing selected a tap is a dot');
});

run('✕ ignores a tap straight after selecting, and works after that', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
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
