// From the panel beside a card to the full notebook and back, in the real app (index.html, the
// router, the card screen and the notebook) in Chromium: the same page, and the card as it was
// left. js/card-return.js has the rule for where the panel opens (tests/card-globe.test.mjs).
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/notes-full.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setUp } from './fixtures/browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }
const have = () => { try { return pw && existsSync(pw.chromium.executablePath()); } catch { return false; } };
const skip = !have() && 'chromium not installed';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
let server, url;
before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      const file = path === '/' ? 'index.html' : path.slice(1);
      const body = await readFile(ROOT + file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

// The app with one explorer signed in, on the binder, and three pages for one animal, one for
// another and a free page. Returns the page ids, oldest first.
async function open() {
  const browser = await pw.chromium.launch();
  return setUp(browser, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 10000 });
    await page.evaluate(async () => { const s = await import('/js/store.js'); await s.createProfile({ name: 'Test', lang: 'en' }); });
    await page.reload();
    await page.click('.picker__item:not(.picker__item--add)', { timeout: 10000 });
    await page.waitForSelector('main[data-view="binder"]', { timeout: 10000 });
    const seeded = await page.evaluate(async () => {
      const store = await import('/js/store.js'), notes = await import('/js/notes-store.js');
      const [a, b] = store.state.cards.map(c => c.id);
      for (const id of [a, b]) store.state.collected[id] = { cardId: id };
      const add = async (tags, day) => {
        const p = notes.blankPage({ tags });
        p.createdAt = p.header.date = new Date(Date.UTC(2026, 0, day)).toISOString();
        await notes.savePage(p);
        return p.id;
      };
      return { a, b, ids: [await add([a], 1), await add([a], 2), await add([a], 3), await add([b], 4), await add([], 5)] };
    });
    const f = {
      browser, page, errors, ...seeded,
      wait: ms => page.waitForTimeout(ms),
      count: () => page.evaluate(() => document.querySelector('.nbdock .nb__count')?.textContent),
      full: () => page.waitForSelector('.nb--immersive[data-view]'),
      async panelOn(n) {
        await page.evaluate(id => { location.hash = `#/card/${encodeURIComponent(id)}/notes`; }, f.a);
        await page.waitForSelector('.nbdock .nb__full');
        await page.waitForFunction(() => /\d/.test(document.querySelector('.nbdock .nb__count')?.textContent ?? ''));
        for (let i = 0; i < 3 && (await f.count()) !== `${n} / 3`; i++) {
          await page.click('.nbdock .nb__nav--prev');
          await f.wait(150);
        }
        assert.equal(await f.count(), `${n} / 3`);
      },
      async openFull() {
        await page.click('.nbdock .nb__full');
        await f.full();
        await f.wait(1000); // past the growing, the roll opening, and the page drawn
      },
      async back() {
        await page.click('.nb__back');
        await page.waitForSelector('.viewer .nbdock[data-state="expanded"] .nb__count');
        await f.wait(300);
      },
      // The page open in the full notebook.
      place: () => page.evaluate(() => document.querySelector('.nb-tabs').getAttribute('aria-label').match(/[0-9]+/)[0]),
    };
    return f;
  });
}
const run = (name, fn) => test(name, { skip }, async () => {
  const f = await open();
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});

const hash = f => f.page.evaluate(() => decodeURIComponent(location.hash));

run('the open book opens the same page; back is the same card with the panel on that page', async f => {
  await f.panelOn(1);
  await f.openFull();
  assert.equal(await hash(f), `#/notes/${f.a}`);
  assert.equal(await f.place(), '1');
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.nb-grow').length), 0, 'nothing left over the notebook');
  await f.back();
  assert.match(await hash(f), new RegExp(`^#/card/${f.a}`));
  assert.equal(await f.count(), '1 / 3');
});

run('turning on to another of this card\'s pages: the panel comes back on the page it ended on', async f => {
  await f.panelOn(1);
  await f.openFull();
  await f.page.click('.nb__nav--next');
  await f.wait(800);
  assert.equal(await f.place(), '2');
  await f.back();
  assert.equal(await f.count(), '2 / 3');
});

for (const [name, row] of [['another animal\'s page', i => i.b], ['a free page', () => null]]) {
  run(`ending on ${name}: the panel comes back on the page it started from`, async f => {
    await f.panelOn(2);
    await f.openFull();
    assert.equal(await f.place(), '2', 'the same page');
    await f.page.click('.nb-tab[data-tab="contents"]');
    await f.page.waitForSelector('.nb__contents:not([hidden])');
    await f.wait(800);
    const id = row(f);
    await f.page.click(id ? `.nb-toc__link[data-card="${f.b}"]` : '.nb-toc__link[data-free]');
    await f.wait(900);
    assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'pages');
    await f.back();
    assert.equal(await f.count(), '2 / 3');
    const tags = await f.page.evaluate(() => [...document.querySelectorAll('.nbdock .nb-tag__name')].length);
    assert.equal(tags, 1, 'this card\'s page, with its one tag');
  });
}

run('ending in the contents: the panel comes back on the page it started from', async f => {
  await f.panelOn(2);
  await f.openFull();
  await f.page.click('.nb-tab[data-tab="contents"]');
  await f.page.waitForSelector('.nb__contents:not([hidden])');
  await f.back();
  assert.equal(await f.count(), '2 / 3');
});

run('a drawing made just before opening or going back is on the page at the other end', async f => {
  await f.panelOn(1);
  const line = async () => {
    const b = await f.page.evaluate(() => { const r = document.querySelector('.nb__sheet').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await f.page.mouse.move(b.x, b.y);
    await f.page.mouse.down();
    await f.page.mouse.move(b.x + 60, b.y + 10, { steps: 4 });
    await f.page.mouse.up();
  };
  const marks = () => f.page.evaluate(async () => {
    const notes = await import('/js/notes-store.js');
    return Promise.all(notes.pagesFor(document.location.hash.split('/')[2]).map(async r => (await notes.loadPage(r.pageId)).items.length));
  });
  await line();
  await f.openFull(); // no wait: it saves first
  assert.deepEqual(await marks(), [1, 0, 0]);
  await line();
  await f.back();
  assert.deepEqual((await f.page.evaluate(async () => {
    const notes = await import('/js/notes-store.js'), store = await import('/js/store.js');
    return Promise.all(store.state.notes.map(async r => (await notes.loadPage(r.pageId)).items.length));
  })).reduce((a, b) => a + b), 2);
});

run('a second trip works the same', async f => {
  await f.panelOn(1);
  await f.openFull();
  await f.back();
  await f.openFull();
  await f.page.click('.nb__nav--next');
  await f.wait(800);
  await f.back();
  assert.equal(await f.count(), '2 / 3');
});

run('opened from the menu or a card link the book starts closed; from the panel it never does', async f => {
  await f.panelOn(1);
  await f.openFull();
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb-cover')), null, 'from the panel: straight to the page');
  await f.back();
  await f.page.evaluate(id => { location.hash = `#/notes/${encodeURIComponent(id)}`; }, f.a);
  await f.page.waitForSelector('.nb--immersive .nb-cover__tap');
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb--immersive').dataset.book), 'closed', 'a card link');
  await f.page.evaluate(() => { location.hash = '#/notes'; });
  await f.page.waitForFunction(() => document.querySelector('.nb--immersive[data-view="contents"] .nb-cover__tap'));
  await f.page.click('.nb-cover__tap');
  await f.wait(1000);
  assert.ok(await f.page.evaluate(() => document.querySelector('.nb-toc__title').getClientRects().length > 0), 'the contents under the cover');
});
