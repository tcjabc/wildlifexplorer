// Ocean depth's currents in the real app in Chromium: they draw (warm and cold, read back from the
// 2D canvas they are drawn on), on the WebGL base and without it; ▶/⏸ moves their dashes at most 30
// times a second, waits while the globe is dragged and stops on leaving the layer; reduced motion
// has no bar and still currents; a tap on one shows its name. How it looks and moves on the tablet
// can't be tested here: the owner checks it on the G Pad itself.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/globe-currents-touch.test.mjs
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

// On the Kuroshio just off Taiwan's east coast, and on the Oyashio off Hokkaido (assets/layers/currents.json).
const KUROSHIO = [122.25, 23.6], OYASHIO = [145.5, 42.5];

// The Globe with Ocean depth on. debug: 'fps', or 'fps,2d' for no WebGL base.
async function open({ debug = 'fps', reducedMotion = 'no-preference' } = {}) {
  const browser = await pw.chromium.launch();
  return setUp(browser, async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, serviceWorkers: 'block', reducedMotion });
    const page = await ctx.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 10000 });
    await page.evaluate(async () => { const s = await import('/js/store.js'); await s.createProfile({ name: 'Test', lang: 'both' }); });
    await page.goto(`${base}?debug=${debug}`);
    await page.click('.picker__item:not(.picker__item--add)', { timeout: 10000 });
    await page.waitForSelector('main[data-view="binder"]', { timeout: 10000 });
    await page.evaluate(() => { location.hash = '#/globe'; });
    await page.waitForFunction(() => window.wfGlobe, null, { timeout: 10000 });
    await page.evaluate(() => window.wfGlobe.ready);
    const f = {
      browser, page, errors,
      wait: ms => page.waitForTimeout(ms),
      async layer(id) {
        await page.locator('.gtile--hero').click();
        await page.locator(`.gtile[data-layer=${id}]`).click();
        await f.wait(300);
      },
      currents: () => page.evaluate(() => wfGlobe.currents()),
      playing: () => page.evaluate(() => document.querySelector('.gclockbar .gclock__play')?.getAttribute('aria-pressed') === 'true'),
      look: async (lon, lat, k) => { await page.evaluate(([lon, lat, k]) => { wfGlobe.pause(true); wfGlobe.flyTo(lon, lat, k, { duration: 0 }); }, [lon, lat, k]); await f.wait(400); },
      // Where a place is on the page, and the colour the 2D canvas under the coastline has there.
      at: (lon, lat) => page.evaluate(([lon, lat]) => {
        const [x, y, z] = wfGlobe.at(lon, lat), r = document.querySelector('.globe__canvas--over').getBoundingClientRect();
        return z > 0 ? { x: r.left + x, y: r.top + y, sx: x, sy: y } : null;
      }, [lon, lat]),
      // The strongest warm or cold pixel within 4 px of a place (a dash or its gap may be under it).
      async tint(lon, lat) {
        const p = await f.at(lon, lat);
        return page.evaluate(({ sx, sy }) => {
          const c = document.querySelector('.globe__canvas:not(.globe__canvas--over):not(.globe__canvas--gl)');
          const k = c.width / c.clientWidth, d = c.getContext('2d').getImageData(Math.round((sx - 4) * k), Math.round((sy - 4) * k), Math.round(9 * k), Math.round(9 * k)).data;
          let warm = 0, cold = 0;
          for (let i = 0; i < d.length; i += 4) { warm = Math.max(warm, d[i] - d[i + 2]); cold = Math.max(cold, d[i + 2] - d[i]); }
          return { warm, cold };
        }, p);
      },
    };
    await f.layer('depth');
    await page.waitForFunction(() => window.wfGlobe.currents()?.drawn > 0, null, { timeout: 10000 });
    return f;
  });
}
const run = (name, fn, opts) => test(name, { skip }, async () => {
  const f = await open(opts);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});

run('the currents draw on Ocean depth: the Kuroshio warm past Taiwan, the Oyashio cold; ▶/⏸ alone, and the key', async f => {
  await f.look(130, 30, 3);
  const k = await f.tint(...KUROSHIO), o = await f.tint(...OYASHIO);
  assert.ok(k.warm > 120, `the Kuroshio is red-orange: ${JSON.stringify(k)}`);
  assert.ok(o.cold > 120, `the Oyashio is blue: ${JSON.stringify(o)}`);
  const bar = await f.page.evaluate(() => ({ play: document.querySelectorAll('.gclockbar .gclock__play').length, slider: document.querySelectorAll('.gclockbar .gclock__slider').length, name: document.querySelectorAll('.gclockbar .gclock__name').length }));
  assert.deepEqual(bar, { play: 1, slider: 0, name: 0 }, '▶/⏸ only');
  assert.equal(await f.playing(), false, 'still until ▶');
  const key = await f.page.evaluate(() => [...document.querySelectorAll('.gkey__item')].slice(-2).map(li => [li.querySelector('.gkey__line svg') ? 'line' : '', li.textContent]));
  assert.match(key[0][1], /Warm current.*暖流/);
  assert.match(key[1][1], /Cold current.*涼流/);
  assert.deepEqual(key.map(r => r[0]), ['line', 'line']);
});

run('playing: the dashes move, at most 30 updates a second, wait while the globe is dragged, stop on leaving', async f => {
  await f.page.evaluate(() => {
    window.pushes = 0;
    const u = wfGlobe.updateLayer;
    wfGlobe.updateLayer = p => { if ('phase' in p) window.pushes++; return u(p); };
  });
  await f.page.click('.gclockbar .gclock__play');
  assert.equal(await f.playing(), true);
  await f.wait(2000);
  const moved = (await f.currents()).phase;
  assert.ok(moved > 20 && moved < 50, `about 18 px a second: ${moved}`);
  const rate = (await f.page.evaluate(() => window.pushes)) / 2;
  assert.ok(rate <= 31 && rate >= 15, `${rate.toFixed(1)} updates a second`);
  // Dragged: the dashes wait.
  const r = await f.page.evaluate(() => { const b = document.querySelector('.globe__canvas--over').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await f.page.mouse.move(r.x, r.y);
  await f.page.mouse.down();
  await f.page.mouse.move(r.x + 60, r.y + 10, { steps: 6 });
  const held = (await f.currents()).phase;
  await f.page.mouse.move(r.x + 120, r.y + 20, { steps: 6 });
  await f.wait(700);
  assert.equal((await f.currents()).phase, held, 'nothing moves while it is dragged');
  assert.ok((await f.currents()).drawn > 0, 'still drawn while dragged');
  await f.page.mouse.up();
  // Let go, the globe may glide on a moment (the dashes wait for that too).
  await f.page.waitForFunction(() => !wfGlobe.moving, null, { timeout: 5000 });
  await f.wait(600);
  assert.ok((await f.currents()).phase > held, 'and goes on once let go');
  await f.layer('forests');
  assert.equal(await f.currents(), null, 'another layer: no currents');
  const after = await f.page.evaluate(() => window.pushes);
  await f.wait(500);
  assert.equal(await f.page.evaluate(() => window.pushes), after, 'nothing sent once it is gone');
  await f.layer('depth');
  assert.equal(await f.playing(), false);
  assert.equal((await f.currents()).phase, 0);
});

run('a tap on a current shows its name; a tap on the open sea takes it away', async f => {
  await f.look(124, 24, 6);
  const k = await f.at(...KUROSHIO);
  await f.page.mouse.click(k.x, k.y);
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => document.querySelector('.gcurrent').hidden), false);
  assert.match(await f.page.evaluate(() => document.querySelector('.gcurrent').textContent), /Kuroshio.*黑潮/);
  const sea = await f.at(127, 21);
  await f.page.mouse.click(sea.x, sea.y);
  await f.wait(400);
  assert.equal(await f.page.evaluate(() => document.querySelector('.gcurrent').hidden), true);
});

run('reduced motion: no bar, the currents still, their arrowheads showing the way', async f => {
  assert.equal(await f.page.evaluate(() => document.querySelector('.gclockbar').hidden), true);
  const c = await f.currents();
  assert.ok(c.drawn > 0);
  assert.equal(c.phase, 0);
}, { reducedMotion: 'reduce' });

run('without the WebGL base: the currents still draw, and play a step at a time', async f => {
  assert.equal(await f.page.evaluate(() => wfGlobe.usesBase), false);
  await f.look(130, 30, 3);
  assert.ok((await f.tint(...KUROSHIO)).warm > 120, 'the Kuroshio, red-orange');
  await f.page.click('.gclockbar .gclock__play');
  await f.wait(1100);
  const p = (await f.currents()).phase;
  // 250 ms steps of 4.5 px: a whole number of them.
  assert.ok(p >= 13.5 && p <= 22.5, `${p}`);
  assert.ok(Math.abs(p / 4.5 - Math.round(p / 4.5)) < 1e-6, `in steps: ${p}`);
}, { debug: 'fps,2d' });
