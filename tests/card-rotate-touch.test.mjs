// Turning the device with a card on screen, in the real app in Chromium: the viewport goes from
// portrait to landscape and back (tablet 800 × 1280 ↔ 1280 × 800, phone 390 × 844 ↔ 844 × 390) with
// the card closed, turned over, open on every stage view, and in the middle of zooming in,
// opening, turning over and closing. After every turn the card is fully on the screen and centred
// in its space (±2 px), and nothing on the stage reaches outside it. Views keep what they showed.
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
      // No peek and no hand: they are hints, not part of the layout.
      localStorage.setItem(`we-peeked-${store.state.profile.id}`, JSON.stringify(store.state.cards.map(c => c.id)));
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
        const c = document.querySelector('.card3d');
        return s && !s.classList.contains('is-3d') && c.classList.contains('is-rest');
      }, null, { timeout: 4000 })).catch(async err => {
        const why = await page.evaluate(() => ({ viewer: Boolean(document.querySelector('.viewer')), hash: location.hash, is3d: document.querySelector('.viewer__stage')?.classList.contains('is-3d'), rest: document.querySelector('.card3d')?.classList.contains('is-rest') }));
        throw new Error(`not settled: ${JSON.stringify(why)} (${err.message})`);
      }),
      button: glyph => page.evaluate(g => [...document.querySelectorAll('.viewer__bar button')].find(b => b.textContent.includes(g)).click(), glyph),
      heading: id => page.evaluate(i => document.querySelector(`.hbtn[data-heading="${i}"]`).click(), id),
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
        const root = document.querySelector('.card3d');
        const back = stage.dataset.face === 'back';
        const pose = root.dataset.pose;
        const frame = back ? rect(document.querySelector('.card3d--back'))
          // Open: the menu page, and beside it the stage page (the cover's back); stacked, the cover is hidden.
          : pose === 'open' ? union([rect(document.querySelector('.base')), ...(root.dataset.layout === 'side' ? [rect(document.querySelector('.leaf'))] : [])])
            : rect(root);
        const s = rect(stage);
        // The card's space: the stage, left of the notebook's spine when that stands beside it.
        const spine = document.querySelector('.nbdock__spine');
        const sp = spine && spine.offsetWidth ? rect(spine) : null;
        const right = sp && sp.left > s.left + s.width / 2 ? Math.min(s.right, sp.left) : s.right;
        const out = [];
        if (frame.left < -0.5 || frame.top < -0.5 || frame.right > innerWidth + 0.5 || frame.bottom > innerHeight + 0.5) out.push(`off the screen: ${JSON.stringify(frame)} in ${innerWidth}x${innerHeight}`);
        const dx = (frame.left - s.left) - (right - frame.right), dy = (frame.top - s.top) - (s.bottom - frame.bottom);
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) out.push(`not centred: ${dx.toFixed(1)}, ${dy.toFixed(1)} (gaps differ by this; ±2 px each side)`);
        // Nothing on the stage reaches outside it (what scrolls inside its own box is fine).
        const st = document.querySelector('.stage');
        if (pose === 'open' && !back && st?.offsetWidth) {
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

    run(`closed and turned over: centred and on the screen after turning (${where})`, async f => {
      await f.card('formosan-rock-macaque');
      const bad = [...await f.check('closed'), ...await roundTrip(f, pair, 'closed')];
      await f.button('🔄');
      await f.settled();
      bad.push(...await roundTrip(f, pair, 'back'));
      assert.deepEqual(bad, []);
    }, pair[0]);

    run(`open on every stage view: the card fits and the stage holds its view (${where})`, async f => {
      await f.card('formosan-rock-macaque');
      await f.button('📖');
      await f.settled();
      const bad = [...await roundTrip(f, pair, 'open, gallery')];
      for (const id of ['food', 'babies', 'behaviour', 'size', 'where', 'status']) {
        await f.heading(id);
        await f.wait(250);
        bad.push(...await roundTrip(f, pair, `open on ${id}`));
      }
      assert.deepEqual(bad, []);
    }, pair[0]);
  }
}

run('mid-animation: zooming in, opening, turning over and closing jump to where they were going', async f => {
  const [a, b] = TABLET;
  // Zooming in from the binder.
  await f.page.evaluate(() => { location.hash = '#/card/formosan-rock-macaque'; });
  await f.page.waitForSelector('.viewer .card3d');
  await f.wait(60);
  await f.turn(b);
  const bad = [...await f.check('turned while zooming in')];
  // Opening.
  await f.button('📖');
  await f.wait(60);
  await f.turn(a);
  assert.equal(await f.page.evaluate(() => document.querySelector('.card3d').dataset.pose), 'open');
  bad.push(...await f.check('turned while opening'));
  // Turning over.
  await f.button('🔄');
  await f.wait(60);
  await f.turn(b);
  assert.equal(await f.page.evaluate(() => document.querySelector('.viewer__stage').dataset.face), 'back');
  bad.push(...await f.check('turned while turning over'));
  // Closing: it closes.
  await f.button('←');
  await f.wait(60);
  await f.page.setViewportSize(a);
  await f.page.waitForFunction(() => !document.querySelector('.viewer'), null, { timeout: 2000 });
  assert.deepEqual(bad, []);
}, TABLET[0]);

run('the stage keeps what it showed: the mode, the partner, the count so far, the magnifier', async f => {
  const [a, b] = TABLET;
  await f.card('formosan-rock-macaque');
  await f.button('📖');
  await f.settled();
  await f.heading('size');
  await f.wait(300);
  await f.page.click('.stage .cmp-toggle [data-value="weight"]');
  await f.wait(200);
  const cat = await f.page.$('.stage-cmp__who [data-value="cat"]');
  if (cat) { await cat.click(); await f.wait(200); }
  for (let i = 0; i < 2; i++) { await f.page.click('.stage .count'); await f.wait(80); }
  const before = await f.page.evaluate(() => ({
    mode: document.querySelector('.stage .cmp-toggle [aria-checked="true"][data-value="weight"]') != null,
    who: document.querySelector('.stage-cmp__who [aria-checked="true"]')?.dataset.value,
    lit: document.querySelectorAll('.stage .count__fig.is-lit').length,
  }));
  assert.equal(before.lit, 2);
  await f.turn(b);
  await f.turn(a);
  const afterTurn = await f.page.evaluate(() => ({
    mode: document.querySelector('.stage .cmp-toggle [aria-checked="true"][data-value="weight"]') != null,
    who: document.querySelector('.stage-cmp__who [aria-checked="true"]')?.dataset.value,
    lit: document.querySelectorAll('.stage .count__fig.is-lit').length,
  }));
  assert.deepEqual(afterTurn, before);
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
  const bad = [...await f.check('closed, desk shorter')];
  await f.button('📖');
  await f.settled();
  await f.page.evaluate(() => document.querySelector('.viewer__hintrow').style.removeProperty('min-height'));
  await f.wait(120);
  await f.settled();
  bad.push(...await f.check('open, desk back to full height'));
  assert.deepEqual(bad, []);
}, TABLET[0]);
