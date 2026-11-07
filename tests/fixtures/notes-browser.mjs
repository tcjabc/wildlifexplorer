// Field Notes under real touches: the harness behind tests/notes-*-touch.test.mjs. The notebook itself
// (js/notebook.js, its CSS, the store and real page files) in Chromium, at the baseline tablet's size,
// with fingers sent through the DevTools protocol. Frame rates and palms on the real tablet can't be
// tested here.
//
// Importing this starts the page's server for the spec and stops it after it (node:test hooks).
// Skipped when the browser isn't installed: npx playwright install chromium
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setUp } from './browser.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }
const have = () => { try { return pw && existsSync(pw.chromium.executablePath()); } catch { return false; } };
export const skip = !have() && 'chromium not installed';

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
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

export let server, url;
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

export const LANDSCAPE = { width: 1280, height: 800 }, PORTRAIT = { width: 800, height: 1280 };
// The page at the baseline tablet's size in landscape: its top left and CSS px per page unit.
export const K = 585 / 1120;
export const onPage = (x, y) => ({ x: 348 + x * K, y: 40 + y * K });
export const LEFT = onPage(200, 800);
export const stroke = (x, y) => ({ t: 's', c: '#444', w: 5, p: [x, y, 0.5, x + 100, y, 0.5] });
export const label = (x, y) => ({ t: 'x', c: '#444', s: 40, x, y, v: 'Hello' });

export async function open(viewport = LANDSCAPE) {
  const browser = await pw.chromium.launch();
  return setUp(browser, async () => {
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
      // The page open, by what the tabs say.
      place: () => page.evaluate(() => Number(document.querySelector('.nb-tabs').getAttribute('aria-label').match(/[0-9]+/)[0])),
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
  });
}
// Picks up the tweezers, from the tray.
export const tweezers = f => f.page.click('.nb-rack[data-rack="tweezers"]');
export const zoomOf = m => (m === 'none' ? 1 : Number(m.match(/matrix\(([^,]+)/)[1]));
export const run = (name, fn, viewport) => test(name, { skip }, async () => {
  const f = await open(viewport);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});

export const inHand = f => f.page.evaluate(() => document.querySelector('.nb').dataset.tool);

export const rail = {
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

export const PHONE_SIDE = { width: 780, height: 360 }, PHONE_UP = { width: 360, height: 740 };

// A page tagged with an animal, open in that animal's pages.
export async function openTagged(f, id, tag) {
  await f.page.evaluate(([i, c]) => t.notes.loadPage(i).then(p => { p.tags = [c]; return t.notes.savePage(p); }), [id, tag]);
  await f.show(id, { start: { view: 'pages', scope: { kind: 'animal', id: tag }, pageId: id } });
}

export const STAMP = { t: 'm', c: '#444444', card: 'none', x: 300, y: 1000, s: 180, r: 0 };

export const TRAIL = { t: 'f', c: '#444444', k: 'paw', p: [100, 700, 300, 700] };

export const at = onPage;

export const panel = async (f, id) => {
  await f.page.evaluate(() => { document.body.className = ''; document.getElementById('main').dataset.view = 'binder'; document.getElementById('main').style.height = '700px'; document.getElementById('main').style.width = '640px'; document.getElementById('main').style.padding = '0'; });
  await f.page.evaluate(i => { window.fulled = 0; t.open(i, { beside: true, lead: document.createElement('span'), onFull: () => { window.fulled++; } }); }, id);
  await f.page.waitForFunction(() => document.querySelector('.nb__sheet canvas').width > 1);
  await f.wait(1600); // past the nudge
};

export const fulled = f => f.page.evaluate(() => window.fulled);

export const tagged = (f, tag, n) => f.page.evaluate(async ([id, k]) => {
  const ids = [];
  for (let i = 0; i < k; i++) {
    const p = t.notes.blankPage({ tags: [id] });
    p.createdAt = p.header.date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
    await t.notes.savePage(p);
    ids.push(p.id);
  }
  return ids;
}, [tag, n]);

export const shot = async f => {
  const b64 = await f.page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1800; c.height = 1200; const x = c.getContext('2d'); x.fillStyle = '#3080d0'; x.fillRect(0, 0, 1800, 1200); return c.toDataURL('image/jpeg').split(',')[1]; });
  await f.page.setInputFiles('.nb > input[accept="image/*"]', { name: 'p.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') });
  await f.page.waitForSelector('.nb-polaroid');
};

export const photosOn = f => f.page.evaluate(async () => { const pid = t.state.profile.id; const root = await navigator.storage.getDirectory(); try { const d = await (await (await root.getDirectoryHandle('notes')).getDirectoryHandle(pid)).getDirectoryHandle('photos'); let n = 0; for await (const _ of d.values()) n++; return n; } catch { return 0; } });

export const seen = (f, sel) => f.page.evaluate(q => { const e = document.querySelector(q); return Boolean(e) && e.getClientRects().length > 0 && getComputedStyle(e).visibility === 'visible'; }, sel);

export const closed = async (f, options = { start: null }) => {
  await f.page.evaluate(o => t.open(null, o), options);
  await f.page.waitForSelector('.nb-cover__tap');
  await f.wait(200);
};

export const tabs = f => f.page.evaluate(() => [...document.querySelectorAll('.nb-tab')].map(b => b.dataset.tab));

export const allNames = f => f.page.evaluate(() => t.state.cards.map(c => c.id));

// Every animal's tab, at the width the tabs have here. All of them, not only those that fit a list.
export const tabLabels = async (f, mode) => f.page.evaluate(async ([m, ids]) => {
  const i18n = await import('/js/i18n.js'), tabs = await import('/js/notes-tabs.js'), store = await import('/js/store.js');
  const box = document.querySelector('.nb-tabs'), was = [...box.children], out = [];
  i18n.setMode(m);
  for (const id of ids) {
    const card = store.state.byId.get(id), entry = { id, group: card.group, emoji: store.groupById(card.group)?.emoji, name: card.name };
    const tab = tabs.tabButton(entry, { text: card.name.en, current: false, onclick: () => {} });
    box.replaceChildren(tab);
    tabs.fitLabel(tab, entry);
    const n = tab.querySelector('.nb-tab__name'), s = getComputedStyle(n);
    out.push({ id, text: n.innerText.replace(/\n/g, ' / '), short: tab.hasAttribute('data-short'), clipped: tabs.spills(n, tab), across: s.writingMode === 'horizontal-tb' });
  }
  box.replaceChildren(...was);
  i18n.setMode('en');
  return out;
}, [mode, await allNames(f)]);

export const tape = (x, y) => ({ t: 'w', k: 'red', x, y, l: 300, s: 60, r: 0 });

export const paintsOn = (f, fn) => f.page.evaluate(async src => {
  const proto = CanvasRenderingContext2D.prototype, was = proto.drawImage, base = document.querySelector('.nb__base');
  let n = 0;
  proto.drawImage = function drawImage(...a) { if (this.canvas === base) n++; return was.apply(this, a); };
  window.paints = () => { proto.drawImage = was; return n; };
}).then(fn).then(() => f.page.evaluate(() => window.paints()));

export const fullPage = () => Array.from({ length: 150 }, (_, i) => tape(300 + (i % 5) * 100, 300 + Math.floor(i / 5) * 30));
