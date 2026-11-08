// The Food stage under real touches, in the real app in Chromium at the baseline tablet's size,
// landscape and portrait: the tray of one to three photos inside the stage, a tapped photo filling the
// stage and a second tap putting it back, the lit heading tapped again going back to the gallery, and
// a swipe across the tray still changing card. How the photos look on the tablet can't be tested here.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/food-touch.test.mjs
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.png': 'image/png' };
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

const LANDSCAPE = { width: 1280, height: 800 }, PORTRAIT = { width: 800, height: 1280 };

async function open(viewport) {
  const browser = await pw.chromium.launch();
  return setUp(browser, async () => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { speechSynthesis.speak = () => {}; });
    await page.goto(url);
    await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 10000 });
    await page.evaluate(async () => { const s = await import('/js/store.js'); await s.createProfile({ name: 'Test', lang: 'en' }); });
    await page.reload();
    await page.click('.picker__item:not(.picker__item--add)', { timeout: 10000 });
    await page.waitForSelector('main[data-view="binder"]', { timeout: 10000 });
    await page.evaluate(async () => {
      const store = await import('/js/store.js');
      for (const c of store.state.cards) store.state.collected[c.id] = { cardId: c.id };
    });
    const cdp = await ctx.newCDPSession(page);
    const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const wait = ms => page.waitForTimeout(ms);
    const f = {
      browser, page, errors,
      async card(id) {
        await page.evaluate(i => { location.hash = `#/card/${encodeURIComponent(i)}`; }, id);
        await page.waitForSelector('.viewer .card3d');
        await page.waitForFunction(i => document.querySelector('.viewer__bar') && location.hash.endsWith(i), id);
        await wait(40);
        await page.waitForFunction(() => !document.querySelector('.viewer__stage')?.classList.contains('is-3d'), null, { timeout: 4000 });
      },
      async tapAt(at) {
        await send('touchStart', [{ ...at, id: 1 }]);
        await wait(30);
        await send('touchEnd', []);
        await wait(250);
      },
      async drag(from, to, steps = 8) {
        await send('touchStart', [{ ...from, id: 1 }]);
        for (let i = 1; i <= steps; i++) {
          await send('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }]);
          await wait(16);
        }
        await send('touchEnd', []);
        await wait(900);
      },
      middle: b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 }),
      box: sel => page.evaluate(q => { const r = document.querySelector(q)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel),
      heading: async id => f.tapAt(f.middle(await f.box(`[data-heading="${id}"]`))),
      async food() {
        await f.heading('food');
        await page.waitForFunction(() => {
          const imgs = [...document.querySelectorAll('.food-tray__item img')];
          return imgs.length > 0 && imgs.every(i => i.complete && i.naturalWidth > 0);
        }, null, { timeout: 5000 });
      },
      tiles: () => page.evaluate(() => [...document.querySelectorAll('.food-tray__item')].map(b => {
        const r = b.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })),
      state: () => page.evaluate(() => {
        const big = document.querySelector('.food-big');
        return {
          open: Boolean(big && !big.hidden), big: big?.querySelector('img')?.getAttribute('src') ?? null,
          pressed: [...document.querySelectorAll('.food-tray__item')].map(t => t.getAttribute('aria-pressed') === 'true'),
          stage: document.querySelector('.stage').firstElementChild?.className ?? null,
          face: document.querySelector('.viewer__stage').dataset.face,
          lit: document.querySelector('.hbtn.is-on')?.dataset.heading ?? null, hash: location.hash,
        };
      }),
      files: () => page.evaluate(async () => {
        const { foodOf } = await import('/js/food.js');
        const store = await import('/js/store.js');
        return foodOf(store.state.byId.get(decodeURIComponent(location.hash.split('/')[2]))).map(p => p.file);
      }),
    };
    return f;
  });
}
const run = (name, fn, viewport = LANDSCAPE) => test(name, { skip }, async () => {
  const f = await open(viewport);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});

const inside = (t, s) => t.x >= s.x - 1 && t.y >= s.y - 1 && t.x + t.w <= s.x + s.w + 1 && t.y + t.h <= s.y + s.h + 1;
const apart = (a, b) => a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1 || a.y + a.h <= b.y + 1 || b.y + b.h <= a.y + 1;

for (const [shape, viewport] of [['landscape', LANDSCAPE], ['portrait', PORTRAIT]]) {
  run(`the macaque's three photos: on the stage, a tap fills it, a tap puts it back (${shape})`, async f => {
    await f.card('formosan-rock-macaque');
    await f.food();
    const stage = await f.box('.stage'), tiles = await f.tiles(), files = await f.files();
    assert.equal(tiles.length, 3);
    assert.ok(tiles.every(t => inside(t, stage)), 'all on the stage');
    assert.ok(apart(tiles[0], tiles[1]) && apart(tiles[0], tiles[2]) && apart(tiles[1], tiles[2]), 'none on another');
    assert.ok(tiles[0].w * tiles[0].h > tiles[1].w * tiles[1].h, 'the first is the big one');
    const start = await f.state();
    assert.equal(start.stage, 'stage-food');

    await f.tapAt(f.middle(tiles[1]));
    const opened = await f.state();
    assert.ok(opened.open, 'it fills the stage');
    assert.equal(opened.big, files[1], 'the full picture of the photo tapped');
    assert.deepEqual(opened.pressed, [false, true, false]);
    const big = await f.box('.food-big');
    assert.ok(Math.abs(big.w - stage.w) < 2 && Math.abs(big.h - stage.h) < 2, 'as big as the stage');

    await f.tapAt(f.middle(big));
    const back = await f.state();
    assert.ok(!back.open, 'back on the tray');
    assert.deepEqual(back.pressed, [false, false, false]);
    assert.deepEqual([back.lit, back.face, back.hash], ['food', start.face, '#/card/formosan-rock-macaque']);
  }, viewport);
}

run('one photo fills the tray; the lit heading tapped again goes back to the gallery', async f => {
  await f.card('plains-zebra');
  await f.food();
  const tiles = await f.tiles(), tray = await f.box('.food-tray');
  assert.equal(tiles.length, 1);
  assert.ok(Math.abs(tiles[0].w - tray.w) < 2 && Math.abs(tiles[0].h - tray.h) < 2);
  await f.heading('food');
  const st = await f.state();
  assert.equal(st.lit, null);
  assert.match(st.stage, /stage-pic/);
});

run('a swipe across the tray still changes card, and opens nothing', async f => {
  await f.card('formosan-rock-macaque');
  await f.food();
  const t = await f.tiles(), s = await f.box('.stage');
  const y = t[0].y + t[0].h / 2;
  await f.drag({ x: s.x + s.w * 0.85, y }, { x: s.x + s.w * 0.15, y });
  assert.notEqual(await f.page.evaluate(() => location.hash), '#/card/formosan-rock-macaque', 'on to the next card');
  assert.equal(await f.page.evaluate(() => Boolean(document.querySelector('.food-big:not([hidden])'))), false);
});
