// The Globe's layer clocks, in the real app in Chromium on Taiwan's time: Day & night's sun at the
// equinoxes and solstices, the terminator as drawn (on the 2D canvas, which can be read back), the
// day playing at its speed and waiting for the globe, Now, leaving the layer, reduced motion, the
// hour-at-a-time playing without WebGL, and watch mode. The clock bar: the globe's own, one row at
// its bottom, there with the panel collapsed or open, never over the globe's middle, never under a
// phone's open strip, and none for a layer without a clock. Temperature plays on it too.
// Smoothness on the tablet can't be tested here: the owner checks it on the G Pad itself.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/globe-day-touch.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setUp } from './fixtures/browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }
const have = () => { try { return pw && existsSync(pw.chromium.executablePath()); } catch { return false; } };
const skip = !have() && 'chromium not installed';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };

let server, base;
before(async () => {
  server = createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, path.normalize(p));
      if (!file.startsWith(ROOT) || (await stat(file)).isDirectory()) throw new Error('no');
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${server.address().port}/`;
});
after(() => server?.close());

const TAIPEI = 8; // hours ahead of UTC
const TABLET = { width: 1280, height: 800 }, PHONE = { width: 390, height: 844 };
const DAY_MS = 20000; // a whole day while it plays (js/views/globe.js)

// The Globe with a layer on. debug: 'fps', or 'fps,2d' for no WebGL. panel: as the explorer left it
// (a tablet; a phone always opens collapsed). watch: a grown-up's device.
async function open({ debug = 'fps', reducedMotion = 'no-preference', viewport = TABLET, panel = 'expanded', layer = 'night', watch = false } = {}) {
  const browser = await pw.chromium.launch();
  return setUp(browser, async () => {
    const phone = viewport.width < 600;
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, isMobile: phone, serviceWorkers: 'block', timezoneId: 'Asia/Taipei', reducedMotion });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000); // a step that can't happen fails, naming itself, within the test's 30 s
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 10000 });
    await page.evaluate(async () => { const s = await import('/js/store.js'); await s.createProfile({ name: 'Test', lang: 'both' }); });
    await page.reload();
    await page.click('.picker__item:not(.picker__item--add)', { timeout: 10000 });
    await page.waitForSelector('main[data-view="binder"]', { timeout: 10000 });
    await page.evaluate(async p => { const st = await import('/js/store.js'); await st.updateProfile(st.state.profile.id, { globePanel: p }); }, panel);
    await page.goto(`${base}?debug=${debug}`);
    await page.click('.picker__item:not(.picker__item--add)', { timeout: 10000 });
    await page.waitForSelector('main[data-view="binder"]', { timeout: 10000 });
    if (watch) await page.evaluate(async () => { (await import('/js/store.js')).state.role = 'watch'; });
    await page.evaluate(() => { location.hash = '#/globe'; });
    await page.waitForFunction(() => window.wfGlobe, null, { timeout: 10000 });
    await page.evaluate(() => window.wfGlobe.ready);
    const cdp = await ctx.newCDPSession(page);
    const f = {
      browser, page, errors,
      wait: ms => page.waitForTimeout(ms),
      async layer(id) {
        await page.locator('.gtile--hero').click();
        await page.locator(`.gtile[data-layer=${id}]`).click();
        await f.wait(300);
      },
      // The sun as latitude and longitude, from the globe itself.
      sun: () => page.evaluate(() => { const [x, y, z] = wfGlobe.sun(); return [Math.asin(z) * 180 / Math.PI, Math.atan2(y, x) * 180 / Math.PI]; }),
      realSun: () => page.evaluate(async () => { const [x, y, z] = (await import('/js/layers.js')).sunVector(); return [Math.asin(z) * 180 / Math.PI, Math.atan2(y, x) * 180 / Math.PI]; }),
      // A slider moved as a finger would: input while it moves, change as it is let go.
      async set(sel, value, { release = true } = {}) {
        await page.evaluate(([s, v, r]) => {
          const el = document.querySelector(s);
          el.value = String(v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          if (r) el.dispatchEvent(new Event('change', { bubbles: true }));
        }, [sel, value, release]);
        await f.wait(120);
      },
      // A month from the label's twelve.
      async month(m) {
        await page.click('.gclock--day .gclock__name--btn');
        await page.click(`.gwhen__month:nth-child(${m})`);
        await f.wait(120);
      },
      monthNow: () => page.evaluate(() => Number(document.querySelector('.gclock--day').dataset.month)),
      hourUtc: (hr, opts) => f.set('.gclock--day .gclock__slider', ((hr + TAIPEI) % 24) < 6 ? ((hr + TAIPEI) % 24) + 24 : (hr + TAIPEI) % 24, opts),
      slider: () => page.evaluate(() => Number(document.querySelector('.gclock--day .gclock__slider').value)),
      playing: () => page.evaluate(() => document.querySelector('.gclockbar .gclock__play')?.getAttribute('aria-pressed') === 'true'),
      play: () => page.click('.gclockbar .gclock__play'),
      // Count what is sent to the globe.
      count: () => page.evaluate(() => {
        window.pushes = 0;
        if (wfGlobe.counted) return;
        const u = wfGlobe.updateLayer;
        wfGlobe.updateLayer = p => { window.pushes++; return u(p); };
        wfGlobe.counted = true;
      }),
      pushes: () => page.evaluate(() => window.pushes),
      // How bright the map is at a place, on the 2D canvas under everything (no WebGL only).
      async light(lon, lat) {
        return page.evaluate(([lon, lat]) => {
          const [x, y, z] = wfGlobe.at(lon, lat);
          if (z <= 0) return null;
          const c = document.querySelector('.globe__canvas:not(.globe__canvas--over):not(.globe__canvas--gl)');
          const k = c.width / c.clientWidth;
          const [r, g, b] = c.getContext('2d').getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }, [lon, lat]);
      },
      look: async (lon, lat) => { await page.evaluate(([lon, lat]) => { wfGlobe.pause(true); wfGlobe.flyTo(lon, lat, 1, { duration: 0 }); }, [lon, lat]); await f.wait(300); },
      touch: (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] }),
      // Where things are (page px).
      rect: sel => page.evaluate(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { left: r.left, top: r.top, right: r.right, bottom: r.bottom, w: r.width, h: r.height }; }, sel),
      barShown: () => page.evaluate(() => { const b = document.querySelector('.gclockbar'); return Boolean(b && !b.hidden && b.offsetHeight > 0); }),
    };
    if (layer) {
      await f.layer(layer);
      await page.waitForSelector('.gclockbar .gclock__slider', { timeout: 10000 });
      if (layer === 'night') await page.waitForFunction(() => window.wfGlobe.sun(), null, { timeout: 10000 });
    }
    return f;
  });
}
const run = (name, fn, opts) => test(name, { skip }, async () => {
  const f = await open(opts);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} (want ${b} ± ${tol})`);
const lonNear = (a, b, tol, what) => near(((((a - b) % 360) + 540) % 360) - 180, 0, tol, what);

// ---------- Day & night ----------

run('it opens on now: this month, the time on this device, the sun where it really is', async f => {
  assert.equal(await f.monthNow(), await f.page.evaluate(() => new Date().getMonth() + 1));
  const real = await f.realSun(), [lat, lon] = await f.sun();
  near(lat, real[0], 0.2, 'latitude');
  lonNear(lon, real[1], 0.5, 'longitude');
  const local = await f.page.evaluate(() => new Date().getHours() + new Date().getMinutes() / 60);
  const v = await f.slider();
  near(v < 24 ? v : v - 24, local, 0.3, 'the slider at the time here');
  assert.equal(await f.playing(), false);
});

run('equinoxes and solstices: the sun on the equator or the tropics, noon at 0° at 12:00 UTC', async f => {
  for (const [m, lat, tol] of [[3, 0, 0.6], [6, 23.44, 0.1], [9, 0, 0.8], [12, -23.44, 0.1]]) {
    await f.month(m);
    assert.equal(await f.monthNow(), m);
    await f.hourUtc(12);
    const [la, lo] = await f.sun();
    near(la, lat, tol, `month ${m}: latitude`);
    lonNear(lo, 0, 2.5, `month ${m} at 12:00 UTC: longitude`);
  }
  await f.hourUtc(0);
  lonNear((await f.sun())[1], 180, 2.5, 'at 00:00 UTC noon is on the far side');
  // The label: 00:00 UTC is 08:00 in Taiwan, 24-hour, and the month under it.
  const name = await f.page.evaluate(() => document.querySelector('.gclock--day .gclock__name').textContent);
  assert.match(name, /08:00/);
  assert.match(name, /Dec/);
  assert.match(name, /12月/);
});

run('the terminator as drawn (no WebGL): day and night either side of it at the equinox; midnight sun in June, polar night in December', async f => {
  assert.equal(await f.page.evaluate(() => wfGlobe.usesBase), false);
  await f.month(3);
  await f.hourUtc(12);
  await f.look(90, -30);
  // Both on the Indian Ocean: 20° of sun one side, 20° below the horizon the other.
  const day = await f.light(70, -30), night = await f.light(110, -30);
  assert.ok(day - night > 60, `day ${day} vs night ${night}`);
  // Near 80° N (the Fram Strait) at midnight UTC: lit in June, dark in December.
  await f.hourUtc(0);
  await f.look(0, 60);
  await f.month(6);
  await f.wait(300);
  const june = await f.light(0, 80);
  await f.month(12);
  await f.wait(300);
  const december = await f.light(0, 80);
  assert.ok(june - december > 60, `June ${june} vs December ${december}`);
}, { debug: 'fps,2d' });

run('▶ plays a day in 20 s: the clock keeps to the frames\' own time (±15%), the sun sent at most 30 times a second', async f => {
  await f.count();
  await f.play();
  assert.equal(await f.playing(), true);
  // From one frame's timestamp to another's, at least 3 s apart.
  const got = await f.page.evaluate(async () => {
    const s = document.querySelector('.gclock--day .gclock__slider');
    const frame = () => new Promise(r => requestAnimationFrame(r));
    await frame();
    const t0 = await frame(), v0 = Number(s.value);
    let t1 = t0;
    while (t1 - t0 < 3000) t1 = await frame();
    return { ms: t1 - t0, hours: ((Number(s.value) - v0) + 24) % 24 };
  });
  const want = (24 * got.ms) / DAY_MS;
  assert.ok(Math.abs(got.hours / want - 1) <= 0.15, `${got.hours.toFixed(3)} h in ${Math.round(got.ms)} ms (want ${want.toFixed(3)} ± 15%)`);
  const n = await f.pushes();
  assert.ok(n > 0 && n <= Math.ceil((got.ms + 400) / 1000 * 30) + 2, `${n} updates in about ${Math.round(got.ms)} ms`);
  await f.play();
  assert.equal(await f.playing(), false);
  const v2 = await f.slider();
  await f.wait(500);
  assert.equal(await f.slider(), v2, 'paused');
});

run('a finger on the globe holds the day; let go and it goes on; the slider pauses it', async f => {
  await f.play();
  await f.wait(500);
  const box = await f.rect('.globe__stage');
  const x = box.left + box.w * 0.7, y = box.top + box.h * 0.4;
  await f.touch('touchStart', x, y);
  await f.wait(150);
  const held = await f.slider();
  await f.wait(1000);
  near(await f.slider(), held, 0.05, 'held while the finger is down');
  assert.equal(await f.playing(), true, 'still playing, only waiting');
  await f.touch('touchEnd');
  await f.wait(1000);
  assert.ok(((await f.slider()) - held + 24) % 24 > 0.5, 'going on after');
  await f.hourUtc(3);
  assert.equal(await f.playing(), false, 'moving the slider pauses it');
});

run('Now: back to the real time; leaving the layer stops the day, and it comes back on now', async f => {
  await f.month(6);
  await f.hourUtc(12);
  await f.play();
  await f.page.click('.gclock--day .gclock__name--btn');
  await f.page.click('.gwhen__now');
  assert.equal(await f.playing(), false);
  assert.equal(await f.page.locator('.gwhen').count(), 0, 'the months close');
  const real = await f.realSun(), [la, lo] = await f.sun();
  near(la, real[0], 0.2, 'latitude now');
  lonNear(lo, real[1], 0.5, 'longitude now');
  // Playing, then another layer: stopped. Back on Day & night: now again.
  await f.month(6);
  await f.play();
  await f.layer('relief');
  await f.count();
  await f.wait(500);
  assert.equal(await f.pushes(), 0, 'nothing sent once it is gone');
  await f.layer('night');
  await f.page.waitForSelector('.gclock--day .gclock__slider');
  assert.equal(await f.playing(), false);
  assert.equal(await f.monthNow(), await f.page.evaluate(() => new Date().getMonth() + 1));
});

run('reduced motion: no ▶, and the slider still moves the sun', async f => {
  assert.equal(await f.page.locator('.gclock__play').count(), 0);
  assert.equal(await f.barShown(), true);
  await f.month(6);
  await f.hourUtc(12);
  near((await f.sun())[0], 23.44, 0.1, 'June');
}, { reducedMotion: 'reduce' });

run('without WebGL: it plays an hour at a time, and a slider being dragged redraws only when let go', async f => {
  await f.count();
  await f.play();
  const seen = [];
  for (let i = 0; i < 25; i++) { seen.push(await f.slider()); await f.wait(100); }
  await f.play();
  const steps = seen.filter((v, i) => i && v !== seen[i - 1]).length;
  assert.ok(steps >= 2 && steps <= 4, `${steps} steps in 2.5 s: ${seen}`);
  assert.ok(seen.slice(1).every(v => Math.abs(v - Math.round(v)) < 1e-6 || v === seen[0]), `whole hours: ${seen}`);
  assert.ok(await f.pushes() <= 4, `${await f.pushes()} redraws`);
  // Dragging the slider: nothing sent until it is let go.
  await f.count();
  await f.hourUtc(5, { release: false });
  await f.hourUtc(6, { release: false });
  assert.equal(await f.pushes(), 0);
  await f.hourUtc(7);
  assert.equal(await f.pushes(), 1);
}, { debug: 'fps,2d' });

run('watch mode (a grown-up\'s device): the day still plays, on this device only', async f => {
  assert.equal(await f.page.evaluate(async () => (await import('/js/store.js')).watching()), true);
  const v0 = await f.slider();
  await f.play();
  await f.wait(1200);
  assert.ok(((await f.slider()) - v0 + 24) % 24 > 0.5);
}, { watch: true });

// ---------- the clock bar ----------

run('the clock bar: one row at the bottom, at most 56 px, a 64 px ▶/⏸, never over the globe\'s middle, there with the panel collapsed', async f => {
  const bar = await f.rect('.gclockbar'), stage = await f.rect('.globe__stage');
  assert.ok(bar.h <= 56.5, `${bar.h} px tall`);
  assert.ok(stage.bottom - bar.bottom < 40, 'at the bottom of the globe\'s space');
  // ▶/⏸ takes a touch 32 px either side of its middle, past the bar's own edge.
  const play = await f.rect('.gclock__play');
  const hits = await f.page.evaluate(([x, y]) => [-31, 31].map(dy => Boolean(document.elementFromPoint(x, y + dy)?.closest('.gclock__play'))), [play.left + play.w / 2, play.top + play.h / 2]);
  assert.deepEqual(hits, [true, true], '64 px tall');
  // The globe's middle: the place it is turned to.
  await f.look(0, 0);
  const [, cy] = await f.page.evaluate(() => wfGlobe.at(0, 0));
  assert.ok(stage.top + cy < bar.top - 40, `the globe's middle (${stage.top + cy}) well above the bar (${bar.top})`);
  // The panel keeps the key and "What am I looking at?", no clock.
  assert.equal(await f.page.locator('.gpanel .gclock').count(), 0);
  // Collapsed: the bar stays.
  await f.page.click('.gpanel__toggle');
  await f.wait(200);
  assert.equal(await f.page.evaluate(() => document.querySelector('.gpanel').dataset.state), 'collapsed');
  assert.equal(await f.barShown(), true);
  // A layer with no clock (Topography has the sea level, Forests the year now): no bar, and the globe has its room back.
  await f.layer('plates');
  assert.equal(await f.barShown(), false);
  await f.layer('temp');
  assert.equal(await f.barShown(), true);
  assert.match(await f.page.evaluate(() => document.querySelector('.gclock--year .gclock__name').textContent), /[A-Z][a-z]+/);
}, { panel: 'expanded' });

run('phone portrait: the panel opens collapsed; open, it never covers the bar; Temperature plays on it', async f => {
  assert.equal(await f.page.evaluate(() => document.querySelector('.gpanel').dataset.state), 'collapsed');
  const bar = await f.rect('.gclockbar');
  assert.ok(bar.h <= 56.5 && bar.w <= 390, `${bar.w} × ${bar.h}`);
  const strip = await f.rect('.gpanel');
  assert.ok(strip.bottom <= bar.top + 0.5, `collapsed strip (${strip.bottom}) above the bar (${bar.top})`);
  await f.page.click('.gpanel__toggle');
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => document.querySelector('.gpanel').dataset.state), 'expanded');
  const open = await f.rect('.gpanel');
  assert.ok(open.bottom <= bar.top + 0.5, `open strip (${open.bottom}) above the bar (${bar.top})`);
  assert.equal(await f.barShown(), true);
  // Temperature's year plays on the bar.
  const m0 = await f.page.evaluate(() => Number(document.querySelector('.gclock--year .gclock__slider').value));
  await f.play();
  await f.wait(1200);
  const m1 = await f.page.evaluate(() => Number(document.querySelector('.gclock--year .gclock__slider').value));
  assert.ok(((m1 - m0) + 12) % 12 > 0.5, `${m0} → ${m1}`);
}, { viewport: PHONE, layer: 'temp' });

run('Temperature: a finger on the globe holds the year, the slider stops it, another layer stops it', async f => {
  const month = () => f.page.evaluate(() => Number(document.querySelector('.gclock--year .gclock__slider').value));
  await f.set('.gclock--year .gclock__slider', 3); // well away from December → January, where the slider stops at 12
  await f.play();
  await f.wait(500);
  const box = await f.rect('.globe__stage');
  await f.touch('touchStart', box.left + box.w * 0.7, box.top + box.h * 0.4);
  await f.wait(150);
  const held = await month();
  await f.wait(800);
  near(await month(), held, 0.02, 'held');
  await f.touch('touchEnd');
  await f.wait(800);
  assert.ok(((await month()) - held + 12) % 12 > 0.3, 'going on after');
  await f.set('.gclock--year .gclock__slider', 8);
  assert.equal(await f.playing(), false);
  await f.play();
  await f.layer('night');
  assert.equal(await f.playing(), false);
}, { layer: 'temp' });
