// The Food stage under real touches, in the real app in Chromium at the baseline tablet's size,
// landscape and portrait: one food at a time, an emoji per food under it (at least 48 px), a tap on one
// showing its photo or, with none, its emoji big; 📷 the credit of the photo showing; the photo taking
// no swipe of its own; the lit heading tapped again going back to the gallery.
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
          const img = document.querySelector('.stage-food .pic');
          return img && img.complete && img.naturalWidth > 0;
        }, null, { timeout: 5000 });
      },
      picks: () => page.evaluate(() => [...document.querySelectorAll('.food-pick__btn')].map(b => {
        const r = b.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, on: b.getAttribute('aria-checked') === 'true', icon: b.textContent };
      })),
      state: () => page.evaluate(() => {
        const s = document.querySelector('.stage');
        return {
          view: s.firstElementChild?.className ?? null,
          src: s.querySelector('.stage-food .pic')?.getAttribute('src') ?? null,
          emoji: s.querySelector('.food-emoji')?.textContent ?? null,
          credit: Boolean(s.querySelector('.stage-food .cover__credit')),
          face: document.querySelector('.viewer__stage').dataset.face,
          lit: document.querySelector('.hbtn.is-on')?.dataset.heading ?? null, hash: location.hash,
        };
      }),
      items: () => page.evaluate(async () => {
        const { foodOf } = await import('/js/food.js');
        const store = await import('/js/store.js');
        return foodOf(store.state.byId.get(decodeURIComponent(location.hash.split('/')[2]))).map(i => ({ icon: i.icon, file: i.pic?.file ?? null, author: i.pic?.author ?? null }));
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

for (const [shape, viewport] of [['landscape', LANDSCAPE], ['portrait', PORTRAIT]]) {
  run(`the macaque's four foods: one emoji each, at least 48 px, a tap shows its photo or its emoji (${shape})`, async f => {
    await f.card('formosan-rock-macaque');
    await f.food();
    const stage = await f.box('.stage'), picks = await f.picks(), items = await f.items();
    assert.deepEqual(picks.map(p => p.icon), ['🍎', '🌿', '🌰', '🐛']);
    assert.ok(picks.every(p => p.w >= 48 && p.h >= 48), `big enough for small fingers: ${picks.map(p => Math.round(p.w))}`);
    assert.ok(picks.every(p => inside(p, stage)), 'on the stage');
    assert.deepEqual(picks.map(p => p.on), [true, false, false, false], 'it opens on the first');
    let st = await f.state();
    assert.deepEqual([st.view.includes('stage-food'), st.src, st.credit], [true, items[0].file, true]);

    await f.tapAt(f.middle(picks[2]));
    st = await f.state();
    assert.deepEqual([st.src, st.emoji, st.credit], [null, '🌰', false], 'no photo: the emoji big on the paper, no credit');
    assert.deepEqual((await f.picks()).map(p => p.on), [false, false, true, false]);

    await f.tapAt(f.middle(picks[3]));
    st = await f.state();
    assert.equal(st.src, items[3].file, 'the bee');
    // 📷: the credit of the photo showing, only.
    await f.tapAt(f.middle(await f.box('.stage-food .cover__credit')));
    const lines = await f.page.evaluate(() => [...document.querySelectorAll('dialog[open] .card-credits li')].map(li => li.textContent));
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes(items[3].author), lines[0]);
    await f.page.evaluate(() => document.querySelector('dialog[open] .btn--primary').click());

    // A tap on the photo does nothing; it stays on the bee.
    await f.tapAt(f.middle(stage));
    st = await f.state();
    assert.deepEqual([st.src, st.lit, st.hash], [items[3].file, 'food', '#/card/formosan-rock-macaque']);
  }, viewport);
}

run('one food: one emoji; the lit heading tapped again goes back to the gallery', async f => {
  await f.card('plains-zebra');
  await f.food();
  assert.deepEqual((await f.picks()).map(p => p.icon), ['🌾']);
  await f.heading('food');
  const st = await f.state();
  assert.equal(st.lit, null);
  assert.match(st.view, /stage-pic/);
  assert.doesNotMatch(st.view, /stage-food/);
});

run('a swipe across the food photo still changes card, and picks nothing', async f => {
  await f.card('formosan-rock-macaque');
  await f.food();
  const s = await f.box('.stage');
  const y = s.y + s.h * 0.4;
  await f.drag({ x: s.x + s.w * 0.85, y }, { x: s.x + s.w * 0.15, y });
  assert.notEqual(await f.page.evaluate(() => location.hash), '#/card/formosan-rock-macaque', 'on to the next card');
});
