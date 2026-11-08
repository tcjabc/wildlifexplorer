// The Habitat stage under real touches, in the real app in Chromium at the baseline tablet's size,
// landscape and portrait: a tap on the animal rings it, buzzes and shows its silhouette; a tap
// anywhere else does nothing; a picture with no animal to find does nothing at all; a swipe across
// the picture still changes card. Whether a 3-year-old can find the lion can't be tested here.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/habitat-touch.test.mjs
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
    await page.addInitScript(() => {
      window.buzz = [];
      navigator.vibrate = ms => { window.buzz.push(ms); return true; };
      speechSynthesis.speak = () => {};
    });
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
      async habitat() {
        const b = await page.evaluate(() => { const r = document.querySelector('[data-heading="habitat"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await f.tapAt(b);
        await page.waitForFunction(() => document.querySelector('.stage-habitat .pic')?.complete && document.querySelector('.stage-habitat .pic').naturalWidth > 0, null, { timeout: 5000 });
      },
      // On the screen: the animal's middle, a point just outside its circle, and the picture's box.
      spots: () => page.evaluate(async () => {
        const { coverBox, findOnBox, habitatOf } = await import('/js/habitat.js');
        const store = await import('/js/store.js');
        const card = store.state.byId.get(decodeURIComponent(location.hash.split('/')[2]));
        const { find } = habitatOf(card);
        const img = document.querySelector('.stage-habitat .pic');
        const r = img.getBoundingClientRect(), k = r.width / img.offsetWidth;
        const c = find && findOnBox(find, coverBox(img.naturalWidth, img.naturalHeight, img.offsetWidth, img.offsetHeight, find.x, find.y));
        return {
          pic: { x: r.x, y: r.y, w: r.width, h: r.height },
          hit: c && { x: r.x + c.x * k, y: r.y + c.y * k },
          // Straight up or down from the middle, whichever has more room, a little past the edge.
          miss: c && { x: r.x + c.x * k, y: r.y + (c.y > img.offsetHeight / 2 ? c.y - c.r * 1.3 : c.y + c.r * 1.3) * k },
          silhouette: card.silhouette?.file ?? null,
        };
      }),
      state: () => page.evaluate(() => {
        const s = document.querySelector('.stage-habitat');
        return {
          found: Boolean(s?.classList.contains('is-found')), ring: Boolean(s?.querySelector('.habitat__ring')),
          shape: s?.querySelector('.habitat__shape')?.getAttribute('src') ?? null,
          buzz: window.buzz.slice(), face: document.querySelector('.viewer__stage').dataset.face,
          lit: document.querySelector('.hbtn.is-on')?.dataset.heading ?? null, hash: location.hash,
        };
      }),
    };
    return f;
  });
}
const run = (name, fn, viewport = LANDSCAPE) => test(name, { skip }, async () => {
  const f = await open(viewport);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});

for (const [shape, viewport] of [['landscape', LANDSCAPE], ['portrait', PORTRAIT]]) {
  run(`the lion: a tap beside it does nothing, a tap on it rings it with its silhouette (${shape})`, async f => {
    await f.card('lion');
    await f.habitat();
    const s = await f.spots();
    const start = await f.state();
    assert.equal(start.lit, 'habitat');
    assert.ok(s.miss.y > s.pic.y && s.miss.y < s.pic.y + s.pic.h, 'the miss is on the picture');

    await f.tapAt(s.miss);
    const missed = await f.state();
    assert.deepEqual([missed.found, missed.ring, missed.buzz], [false, false, start.buzz], 'nothing for a tap beside it');
    assert.equal(missed.face, start.face, 'the card did not turn');
    assert.equal(missed.lit, 'habitat');

    await f.tapAt(s.hit);
    const hit = await f.state();
    assert.ok(hit.found && hit.ring, 'ringed');
    assert.equal(hit.shape, s.silhouette, 'its own silhouette');
    assert.deepEqual(hit.buzz, [...start.buzz, 40], 'one short buzz');
    assert.equal(hit.face, start.face);
    assert.equal(hit.hash, '#/card/lion');
  }, viewport);
}

run('a picture with nothing to find does nothing when tapped', async f => {
  await f.card('formosan-black-bear');
  await f.habitat();
  const s = await f.spots();
  const before = await f.state();
  assert.equal(s.hit, null);
  await f.tapAt({ x: s.pic.x + s.pic.w / 2, y: s.pic.y + s.pic.h / 2 });
  const st = await f.state();
  assert.deepEqual([st.found, st.ring, st.buzz, st.lit], [false, false, before.buzz, 'habitat']);
});

run('a swipe across the habitat picture still changes card, and finds nothing', async f => {
  await f.card('lion');
  await f.habitat();
  const s = await f.spots();
  const y = s.hit.y;
  await f.drag({ x: s.pic.x + s.pic.w * 0.85, y }, { x: s.pic.x + s.pic.w * 0.15, y });
  const st = await f.page.evaluate(() => ({ hash: location.hash, buzz: window.buzz.slice() }));
  assert.notEqual(st.hash, '#/card/lion', 'on to the next card');
  assert.ok(!st.buzz.includes(40), 'no find on the way');
});
