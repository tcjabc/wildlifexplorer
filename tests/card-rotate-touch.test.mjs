// Turning the device with a card on screen, in the real app in Chromium: the viewport goes from
// portrait to landscape and back (tablet 800 × 1280 ↔ 1280 × 800, phone 390 × 844 ↔ 844 × 390) with
// the card on its front, turned over, on every stage view, and in the middle of zooming in, turning
// over and closing. After every turn what shows (both faces side by side, or the one turned up) is
// fully on the screen and centred in its space (±2 px), front and back are exactly the same size,
// and nothing on the stage reaches outside it. Views keep what they showed. Within a layout the card
// never changes size after the zoom in.
// Real rotation (browser bars, Android's order of events) can't be tested here: see the README's
// rotation checklist.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/card-rotate-touch.test.mjs
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

const TABLET = [{ width: 800, height: 1280 }, { width: 1280, height: 800 }];
const PHONE = [{ width: 390, height: 844 }, { width: 844, height: 390 }];

async function open(viewport) {
  const browser = await pw.chromium.launch();
  return setUp(browser, async () => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => { speechSynthesis.speak = () => {}; speechSynthesis.cancel = () => {}; });
    await page.goto(url);
    await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 10000 });
    await page.evaluate(async () => { const s = await import('/js/store.js'); await s.createProfile({ name: 'Test', lang: 'both', heightCm: 95, weightKg: 14 }); });
    await page.reload();
    await page.click('.picker__item:not(.picker__item--add)', { timeout: 10000 });
    await page.waitForSelector('main[data-view="binder"]', { timeout: 10000 });
    await page.evaluate(async () => {
      const store = await import('/js/store.js');
      for (const c of store.state.cards) store.state.collected[c.id] = { cardId: c.id };
      // No hand: it is a hint, not part of the layout.
      localStorage.setItem(`we-up-hint-${store.state.profile.id}`, '3');
    });
    const f = {
      browser, page, errors,
      wait: ms => page.waitForTimeout(ms),
      async card(id) {
        await page.evaluate(i => { location.hash = `#/card/${encodeURIComponent(i)}`; }, id);
        await page.waitForSelector('.viewer .card3d');
        await f.settled();
      },
      // Nothing moving: the card at rest, flat.
      // (Two frames first, so a motion just started has shown.)
      settled: () => page.waitForTimeout(40).then(() => page.waitForFunction(() => {
        const s = document.querySelector('.viewer__stage');
        return s && !s.classList.contains('is-3d');
      }, null, { timeout: 4000 })).catch(async err => {
        const why = await page.evaluate(() => ({ viewer: Boolean(document.querySelector('.viewer')), hash: location.hash, is3d: document.querySelector('.viewer__stage')?.classList.contains('is-3d') }));
        throw new Error(`not settled: ${JSON.stringify(why)} (${err.message})`);
      }),
      button: glyph => page.evaluate(g => [...document.querySelectorAll('.viewer__bar button')].find(b => b.textContent.includes(g)).click(), glyph),
      heading: id => page.evaluate(i => document.querySelector(`.hbtn[data-heading="${i}"]`).click(), id),
      layout: () => page.evaluate(() => document.querySelector('.viewer__stage').dataset.layout),
      face: () => page.evaluate(() => document.querySelector('.viewer__stage').dataset.face),
      async turn(viewport) {
        await page.setViewportSize(viewport);
        await f.wait(120); // a frame or two for the re-layout
        await f.settled();
      },
      // Where everything is, after a turn.
      check: label => page.evaluate(label => {
        const rect = el => el.getBoundingClientRect();
        const union = rs => rs.reduce((a, r) => ({ left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) }));
        const stage = document.querySelector('.viewer__stage');
        const front = rect(document.querySelector('.card3d--front')), back = rect(document.querySelector('.card3d--back'));
        const face = stage.dataset.face;
        // What shows: both faces side by side, or the one turned up.
        const frame = face === 'both' ? union([front, back]) : face === 'back' ? back : front;
        const s = rect(stage);
        // The card's space: the stage, left of the notebook's spine when that stands beside it.
        const spine = document.querySelector('.nbdock__spine');
        const sp = spine && spine.offsetWidth ? rect(spine) : null;
        const right = sp && sp.left > s.left + s.width / 2 ? Math.min(s.right, sp.left) : s.right;
        const out = [];
        if (frame.left < -0.5 || frame.top < -0.5 || frame.right > innerWidth + 0.5 || frame.bottom > innerHeight + 0.5) out.push(`off the screen: ${JSON.stringify(frame)} in ${innerWidth}x${innerHeight}`);
        const dx = (frame.left - s.left) - (right - frame.right), dy = (frame.top - s.top) - (s.bottom - frame.bottom);
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) out.push(`not centred: ${dx.toFixed(1)}, ${dy.toFixed(1)} (gaps differ by this; ±2 px each side)`);
        // One frame: front and back exactly the same size; side by side the back beside the front, else on it.
        if (Math.abs(front.width - back.width) > 2 || Math.abs(front.height - back.height) > 2) out.push(`faces differ: ${front.width}x${front.height} vs ${back.width}x${back.height}`);
        const besideOk = face === 'both' ? Math.abs(back.left - front.right) <= 2 && Math.abs(back.top - front.top) <= 2 : Math.abs(back.left - front.left) <= 2 && Math.abs(back.top - front.top) <= 2;
        if (!besideOk) out.push(`back not ${face === 'both' ? 'beside' : 'on'} the front`);
        // Nothing on the stage reaches outside it (what scrolls inside its own box is fine).
        const st = document.querySelector('.stage');
        if (face !== 'back' && st?.offsetWidth) {
          const b = rect(st);
          for (const el of st.querySelectorAll('*')) {
            if (el.closest('[data-scroll]') && el.closest('[data-scroll]') !== el) continue;
            if (el.ownerSVGElement) continue; // inside a drawing, clipped by it: the <svg> itself counts
            const r = rect(el);
            if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue;
            if (r.left < b.left - 2 || r.top < b.top - 2 || r.right > b.right + 2 || r.bottom > b.bottom + 2) {
              out.push(`${el.getAttribute('class') || el.tagName} outside the stage: ${JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round))} vs ${JSON.stringify([b.left, b.top, b.right, b.bottom].map(Math.round))}`);
              break;
            }
          }
        }
        return out.map(x => `${label}: ${x}`);
      }, label),
    };
    return f;
  });
}

const run = (name, fn, viewport) => test(name, { skip }, async () => {
  const f = await open(viewport);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});

// Turn there and back, checking after each.
async function roundTrip(f, [a, b], label) {
  const bad = [];
  await f.turn(b); bad.push(...await f.check(`${label}, ${b.width}x${b.height}`));
  await f.turn(a); bad.push(...await f.check(`${label}, ${a.width}x${a.height}`));
  return bad;
}

for (const [device, sizes] of [['tablet', TABLET], ['phone', PHONE]]) {
  for (const start of [0, 1]) {
    const pair = start ? [sizes[1], sizes[0]] : sizes;
    const where = `${device}, from ${pair[0].width}x${pair[0].height}`;

    run(`front, and turned over: centred, one size, on the screen after turning (${where})`, async f => {
      await f.card('formosan-rock-macaque');
      const bad = [...await f.check('front'), ...await roundTrip(f, pair, 'front')];
      // Turned over (on one page; side by side both faces show anyway).
      if (await f.layout() === 'side') await f.turn(pair[1]);
      await f.button('🔄');
      await f.settled();
      assert.equal(await f.face(), 'back');
      bad.push(...await roundTrip(f, [sizes[0], sizes[1]], 'turned over'));
      assert.deepEqual(bad, []);
    }, pair[0]);

    run(`every stage view: the card fits and the stage holds its view (${where})`, async f => {
      await f.card('formosan-rock-macaque');
      const bad = [...await roundTrip(f, pair, 'gallery')];
      for (const id of ['food', 'babies', 'behaviour', 'size', 'where', 'status']) {
        await f.heading(id);
        await f.wait(250);
        bad.push(...await roundTrip(f, pair, `on ${id}`));
      }
      assert.deepEqual(bad, []);
    }, pair[0]);
  }
}

// One frame per layout: after the zoom in, the card never changes size; front and back are the same.
for (const [device, sizes] of [['tablet', TABLET], ['phone', PHONE]]) {
  run(`one frame: the zoom lands on the final size, and nothing resizes after (${device}, both ways round)`, async f => {
    const bad = [];
    const box = sel => f.page.evaluate(x => { const r = document.querySelector(x).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
    const near = (a, b, what) => { for (const k of ['x', 'y', 'w', 'h']) if (Math.abs(a[k] - b[k]) > 2) { bad.push(`${what} ${k} ${a[k].toFixed(1)} vs ${b[k].toFixed(1)}`); return; } };
    for (const size of [sizes[0], sizes[1]]) {
      await f.page.setViewportSize(size);
      const at = `${size.width}x${size.height}`;
      await f.card('formosan-black-bear');
      const front = await box('.card3d--front');
      // Every heading, and (on one page) turned over and back: the same box.
      for (const id of ['size', 'where', 'habitat']) {
        await f.heading(id);
        await f.wait(250);
        near(await box('.card3d--front'), front, `${at}: front on ${id}`);
      }
      if (await f.layout() === 'stacked') {
        await f.button('🔄'); await f.settled();
        near(await box('.card3d--back'), front, `${at}: back`);
        await f.button('🔄'); await f.settled();
      } else near(await box('.card3d--back'), { ...front, x: front.x + front.w }, `${at}: back beside`);
      near(await box('.card3d--front'), front, `${at}: front again`);
      await f.page.evaluate(() => { location.hash = '#/binder'; });
      await f.page.waitForFunction(() => !document.querySelector('.viewer'), null, { timeout: 3000 });
    }
    assert.deepEqual(bad, []);
  }, sizes[0]);
}

run('mid-animation: zooming in, turning over and closing jump to where they were going', async f => {
  const [a, b] = TABLET;
  // Zooming in from the binder.
  await f.page.evaluate(() => { location.hash = '#/card/formosan-rock-macaque'; });
  await f.page.waitForSelector('.viewer .card3d');
  await f.wait(60);
  await f.turn(b);
  const bad = [...await f.check('turned while zooming in')];
  // Turning over (one page).
  await f.turn(a);
  await f.button('🔄');
  await f.wait(60);
  await f.turn(b);
  bad.push(...await f.check('turned while turning over'));
  await f.turn(a);
  assert.equal(await f.face(), 'back', 'it got there');
  // Closing: it closes.
  await f.button('←');
  await f.wait(60);
  await f.page.setViewportSize(b);
  await f.page.waitForFunction(() => !document.querySelector('.viewer'), null, { timeout: 2000 });
  assert.deepEqual(bad, []);
}, TABLET[0]);

run('the stage keeps what it showed: the mode, the partner, the count so far, the magnifier', async f => {
  const [a, b] = TABLET;
  await f.card('formosan-rock-macaque');
  await f.heading('size');
  await f.wait(300);
  await f.page.click('.stage .cmp-toggle [data-value="weight"]');
  await f.wait(200);
  await f.page.click('.stage .cmp-toggle [data-value="length"]');
  await f.wait(200);
  const cat = await f.page.$('.stage-cmp__who [data-value="cat"]');
  if (cat) { await cat.click(); await f.wait(200); }
  for (let i = 0; i < 2; i++) { await f.page.click('.stage .count'); await f.wait(80); }
  const state = () => f.page.evaluate(() => ({
    mode: document.querySelector('.stage .cmp-toggle [aria-checked="true"][data-value="length"]') != null,
    who: document.querySelector('.stage-cmp__who [aria-checked="true"]')?.dataset.value,
    lit: document.querySelectorAll('.stage .count__fig.is-lit').length,
  }));
  const before = await state();
  assert.equal(before.lit, 2);
  await f.turn(b);
  await f.turn(a);
  assert.deepEqual(await state(), before);
  // The magnifier: a feature picked stays picked, its lens on the picture.
  await f.heading('behaviour');
  await f.wait(300);
  await f.page.click('.profile__mark');
  await f.wait(300);
  await f.turn(b);
  const lens = await f.page.evaluate(() => {
    const pic = document.querySelector('.profile__pic').getBoundingClientRect();
    const l = document.querySelector('.loupe.is-on > *')?.getBoundingClientRect();
    return { lit: document.querySelectorAll('.profile__mark.is-lit').length, inside: Boolean(l) && l.left >= pic.left - 2 && l.right <= pic.right + 2 };
  });
  assert.deepEqual(lens, { lit: 1, inside: true });
}, TABLET[0]);

run('the desk shrinks with no resize event (a browser bar coming in): the card follows', async f => {
  await f.card('formosan-rock-macaque');
  // The window stays the same size; only the room under the card changes.
  await f.page.evaluate(() => document.querySelector('.viewer__hintrow').style.setProperty('min-height', '240px'));
  await f.wait(120);
  await f.settled();
  const bad = [...await f.check('desk shorter')];
  await f.heading('size');
  await f.wait(250);
  await f.page.evaluate(() => document.querySelector('.viewer__hintrow').style.removeProperty('min-height'));
  await f.wait(120);
  await f.settled();
  bad.push(...await f.check('on Size, desk back to full height'));
  assert.deepEqual(bad, []);
}, TABLET[0]);
