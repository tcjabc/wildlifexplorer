// A lit heading tapped again, under real touches, in the real app in Chromium at the baseline
// tablet's size. On one page (portrait) it turns the card over to its section on the back and stays
// lit; a tap on the stage goes back to the photo instead. Side by side (landscape) the heading
// tapped again goes back to the photo, as before. Turning the device keeps the section marked.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/heading-flip-touch.test.mjs
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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.webp': 'image/webp' };
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

async function open(viewport, reducedMotion = 'no-preference') {
  const browser = await pw.chromium.launch();
  return setUp(browser, async () => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block', reducedMotion });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { speechSynthesis.speak = () => {}; speechSynthesis.cancel = () => {}; });
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
    const box = sel => page.evaluate(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
    const f = {
      browser, page, errors, wait, box,
      async card(id) {
        await page.evaluate(i => { location.hash = `#/card/${encodeURIComponent(i)}`; }, id);
        await page.waitForSelector('.viewer .card3d');
        await page.waitForFunction(i => document.querySelector('.viewer__bar') && location.hash.endsWith(i), id);
        await f.rests();
      },
      rests: () => wait(40).then(() => page.waitForFunction(() => {
        const s = document.querySelector('.viewer__stage');
        return s && !s.classList.contains('is-3d');
      }, null, { timeout: 4000 })),
      faces: face => page.waitForFunction(x => {
        const s = document.querySelector('.viewer__stage');
        return s?.dataset.face === x && !s.classList.contains('is-3d');
      }, face, { timeout: 4000 }),
      face: () => page.evaluate(() => document.querySelector('.viewer__stage').dataset.face),
      // A touch at a point of an element (fractions of its box; the middle by default).
      async tap(sel, fx = 0.5, fy = 0.5) {
        const b = await box(sel);
        const at = { x: b.x + b.w * fx, y: b.y + b.h * fy };
        await send('touchStart', [{ ...at, id: 1 }]);
        await wait(30);
        await send('touchEnd', []);
        await wait(200);
      },
      async swipeDown(sel) {
        const c = await box(sel);
        const x = c.x + c.w / 2, from = c.y + c.h * 0.25, to = c.y + c.h * 0.75;
        await send('touchStart', [{ x, y: from, id: 1 }]);
        for (let i = 1; i <= 8; i++) { await send('touchMove', [{ x, y: from + ((to - from) * i) / 8, id: 1 }]); await wait(16); }
        await send('touchEnd', []);
      },
      heading: id => f.tap(`.hbtn[data-heading="${id}"]`),
      lit: () => page.evaluate(() => [...document.querySelectorAll('.hbtn.is-on')].map(b => b.dataset.heading)),
      stage: () => page.evaluate(() => document.querySelector('.stage').firstElementChild?.className),
      // The section marked on the back, and whether it is in view in the back's scroll.
      section: () => page.evaluate(() => {
        const s = document.querySelector('.ff__section.is-lit'), b = document.querySelector('.ff__body');
        if (!s) return null;
        const r = s.getBoundingClientRect(), v = b.getBoundingClientRect();
        return { id: s.dataset.heading, inView: r.top >= v.top - 2 && r.top < v.bottom - 20 };
      }),
      scrollTop: () => page.evaluate(() => document.querySelector('.ff__body').scrollTop),
      flipped: () => page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('we-flipped-'))?.[1] ?? null),
      handHidden: () => page.evaluate(() => document.querySelector('.viewer__hand').hidden),
    };
    return f;
  });
}
const run = (name, fn, viewport = PORTRAIT, motion) => test(name, { skip }, async () => {
  const f = await open(viewport, motion);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});

run('portrait: the lit heading tapped again turns over to its section, marked, and stays lit; back on the front it still is', async f => {
  await f.card('formosan-black-bear');
  await f.page.waitForFunction(() => !document.querySelector('.viewer__hand').hidden, null, { timeout: 4000 });
  await f.heading('status');
  assert.deepEqual(await f.lit(), ['status']);
  assert.match(await f.stage(), /stage-status/);
  assert.equal(await f.face(), 'front', 'the first tap only lights it');
  assert.equal(await f.flipped(), null);
  await f.page.evaluate(() => { document.querySelector('.ff__body').scrollTop = 0; });
  await f.heading('status');
  await f.faces('back');
  assert.deepEqual(await f.section(), { id: 'status', inView: true }, 'its section in view and marked');
  assert.ok(await f.scrollTop() > 0, 'scrolled down to it');
  assert.equal(await f.handHidden(), true);
  assert.equal(await f.flipped(), '1', 'it counts as turning the card over: no more hand');
  // A swipe down turns it back (from the back's top: it scrolls first).
  await f.page.evaluate(() => { document.querySelector('.ff__body').scrollTop = 0; });
  await f.swipeDown('.ff__body');
  await f.faces('front');
  assert.deepEqual(await f.lit(), ['status'], 'still lit');
  assert.match(await f.stage(), /stage-status/, 'its stage still showing');
  // Again, and back with 🔄.
  await f.heading('status');
  await f.faces('back');
  assert.deepEqual(await f.section(), { id: 'status', inView: true });
  await f.page.click('.viewer__bar .viewer__flip');
  await f.faces('front');
  assert.deepEqual(await f.lit(), ['status']);
});

run('portrait: a tap on the stage goes back to the photo; not on its buttons', async f => {
  await f.card('formosan-black-bear');
  await f.heading('status');
  assert.match(await f.stage(), /stage-status/);
  await f.tap('.front__stage');
  assert.deepEqual(await f.lit(), []);
  assert.match(await f.stage(), /stage-pic/, 'the photo');
  assert.equal(await f.section(), null, 'nothing marked on the back');
  assert.equal(await f.face(), 'front', 'and it stays on the front');
  // With nothing lit, a tap on the photo changes nothing.
  await f.tap('.front__stage', 0.5, 0.3);
  assert.match(await f.stage(), /stage-pic/);
  // Food's buttons are its own.
  await f.heading('food');
  assert.match(await f.stage(), /stage-food/);
  if (await f.page.evaluate(() => document.querySelectorAll('.food-pick__btn').length > 1)) {
    await f.tap('.food-pick__btn:nth-child(2)');
    assert.deepEqual(await f.lit(), ['food'], 'a food button picks a food');
  }
});

run('portrait: a habitat with an animal to find keeps its taps: one that misses stays on it', async f => {
  await f.card('formosan-rock-macaque');
  await f.heading('habitat');
  await f.page.waitForSelector('.stage-habitat[data-taps]', { timeout: 4000 });
  await f.tap('.front__stage', 0.02, 0.98);
  assert.deepEqual(await f.lit(), ['habitat']);
  assert.match(await f.stage(), /stage-habitat/);
});

run('landscape: the lit heading tapped again goes back to the photo, as before; a stage tap changes nothing', async f => {
  await f.card('formosan-black-bear');
  assert.equal(await f.face(), 'both');
  await f.heading('status');
  await f.wait(700); // it glides there
  assert.deepEqual(await f.section(), { id: 'status', inView: true });
  await f.tap('.front__stage');
  assert.deepEqual(await f.lit(), ['status'], 'a stage tap leaves it lit side by side');
  await f.heading('status');
  assert.deepEqual(await f.lit(), []);
  assert.match(await f.stage(), /stage-pic/);
  assert.equal(await f.section(), null);
  assert.equal(await f.face(), 'both');
}, LANDSCAPE);

run('portrait, topic cards: a heading with text turns over to it; one with none turns over to the top', async f => {
  await f.card('kenting-coral-reefs');
  await f.heading('when');
  await f.page.evaluate(() => { document.querySelector('.ff__body').scrollTop = 0; });
  await f.heading('when');
  await f.faces('back');
  assert.deepEqual(await f.section(), { id: 'when', inView: true });
  await f.page.click('.viewer__bar .viewer__flip');
  await f.faces('front');
  // How: a placeholder, nothing to read.
  await f.heading('how');
  assert.equal(await f.page.evaluate(() => document.querySelector('.stage .stage-emoji')?.textContent), '⚙️');
  await f.heading('how');
  await f.faces('back');
  assert.equal(await f.section(), null, 'no section to mark');
  assert.equal(await f.scrollTop(), 0, 'the top of the back');
  assert.deepEqual(await f.lit(), ['how']);
});

run('portrait: a heading with nothing to read turns over to the top of the back, from wherever it was', async f => {
  await f.card('taiwan-barbet'); // Food has no text
  await f.heading('food');
  await f.page.evaluate(() => { document.querySelector('.ff__body').scrollTop = 300; });
  assert.ok(await f.scrollTop() > 0, 'the back was scrolled down');
  await f.heading('food');
  await f.faces('back');
  assert.equal(await f.section(), null, 'no section to mark');
  assert.equal(await f.scrollTop(), 0, 'the top of the back');
  assert.deepEqual(await f.lit(), ['food']);
});

run('portrait, reduced motion: the lit heading tapped again turns over at once, to its section', async f => {
  await f.card('formosan-black-bear');
  await f.wait(300);
  await f.heading('status');
  await f.heading('status');
  await f.faces('back');
  assert.deepEqual(await f.section(), { id: 'status', inView: true });
  assert.equal(await f.flipped(), '1');
}, PORTRAIT, 'reduce');

run('turning the device: portrait with a heading lit becomes the spread with its section marked and in view', async f => {
  await f.card('formosan-black-bear');
  await f.heading('status');
  await f.page.evaluate(() => { document.querySelector('.ff__body').scrollTop = 0; });
  await f.page.setViewportSize(LANDSCAPE);
  await f.wait(150);
  await f.faces('both');
  assert.deepEqual(await f.lit(), ['status']);
  assert.deepEqual(await f.section(), { id: 'status', inView: true });
  // And back: still lit, still on the front; the heading again turns over to it.
  await f.page.setViewportSize(PORTRAIT);
  await f.wait(150);
  await f.faces('front');
  await f.heading('status');
  await f.faces('back');
  assert.deepEqual(await f.section(), { id: 'status', inView: true });
});
