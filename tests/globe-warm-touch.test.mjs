// Coral reefs' warm water in the real app in Chromium: the month carries over from Temperature and
// Forests and back, the seasons as drawn on the Great Barrier Reef (very warm in February, warm
// in August, read from the screen), the cold sea and the land left plain, the reefs on top, reduced
// motion, and a month at a time without the WebGL base. How it plays on the tablet the owner checks on
// the G Pad.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/globe-warm-touch.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { setUp } from './fixtures/browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sharp = createRequire(import.meta.url)('sharp');
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

const SLIDER = '.gclock--year .gclock__slider';

async function open({ debug = 'fps', reducedMotion = 'no-preference', layer = 'reefs' } = {}) {
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
      // A slider moved as a finger would: input while it moves, change as it is let go.
      async set(value) {
        await page.evaluate(([s, v]) => {
          const el = document.querySelector(s);
          el.value = String(v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, [SLIDER, value]);
        await f.wait(600);
      },
      slider: () => page.evaluate(s => Number(document.querySelector(s).value), SLIDER),
      label: () => page.evaluate(() => document.querySelector('.gclock--year .gclock__name').textContent),
      playing: () => page.evaluate(() => document.querySelector('.gclockbar .gclock__play')?.getAttribute('aria-pressed') === 'true'),
      look: async (lon, lat, k) => { await page.evaluate(([lon, lat, k]) => { wfGlobe.pause(true); wfGlobe.flyTo(lon, lat, k, { duration: 0 }); }, [lon, lat, k]); await f.wait(400); },
      async colour(lon, lat) {
        const at = await page.evaluate(([lon, lat]) => {
          const [x, y, z] = wfGlobe.at(lon, lat), r = document.querySelector('.globe__canvas--over').getBoundingClientRect();
          return z > 0 ? { x: Math.round(r.left + x), y: Math.round(r.top + y) } : null;
        }, [lon, lat]);
        assert.ok(at, 'the place is on the near side');
        const png = await page.screenshot({ type: 'png', clip: { x: at.x - 2, y: at.y - 2, width: 5, height: 5 } });
        const data = await sharp(png).removeAlpha().raw().toBuffer();
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 3) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
        const n = data.length / 3;
        return [r / n, g / n, b / n];
      },
    };
    await f.layer(layer);
    await page.waitForSelector(SLIDER, { timeout: 10000 });
    return f;
  });
}
const run = (name, fn, opts) => test(name, { skip }, async () => {
  const f = await open(opts);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});
const hex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const token = (f, name) => f.page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

// Open sea off the Great Barrier Reef (no reef there), the cold sea south of Tasmania, inland Australia.
const CORAL_SEA = [152, -17], SOUTH = [147, -48], INLAND = [135, -25];

run('the month carries over from Temperature and Forests, and back', async f => {
  await f.set(2);
  assert.match(await f.label(), /February/);
  await f.layer('reefs');
  await f.page.waitForSelector(SLIDER);
  assert.equal(Math.round(await f.slider()), 2, 'Coral reefs opens on February');
  assert.match(await f.label(), /二月/);
  await f.set(8);
  await f.layer('forests');
  await f.page.waitForSelector(SLIDER);
  assert.equal(Math.round(await f.slider()), 8, 'Forests on August');
  await f.layer('temp');
  await f.page.waitForSelector(SLIDER);
  assert.equal(Math.round(await f.slider()), 8, 'and Temperature too');
}, { layer: 'temp' });

async function seasons(f) {
  await f.look(146, -25, 1.6);
  const hot = hex(await token(f, '--c-warm-water-hot')), warm = hex(await token(f, '--c-warm-water')), sea = hex(await token(f, '--c-map-sea'));
  await f.set(2);
  await f.wait(800); // the months arrive after the layer shows
  const feb = await f.colour(...CORAL_SEA);
  assert.ok(dist(feb, hot) < 20, `the Coral Sea in February: very warm, ${feb.map(Math.round)}`);
  const cold = await f.colour(...SOUTH);
  assert.ok(dist(cold, sea) < 20, `south of Tasmania: the plain sea, ${cold.map(Math.round)}`);
  const land = await f.colour(...INLAND);
  assert.ok(dist(land, hot) > 60 && dist(land, warm) > 60, `inland Australia: the plain map, ${land.map(Math.round)}`);
  await f.set(8);
  await f.wait(600);
  const aug = await f.colour(...CORAL_SEA);
  assert.ok(dist(aug, warm) < 20, `the Coral Sea in August: warm, ${aug.map(Math.round)}`);
  assert.ok(dist(await f.colour(...INLAND), land) < 6, 'the land the same in August');
}
run('the seasons as drawn: the Coral Sea very warm in February, warm in August; the cold sea and the land plain (WebGL base)', seasons);
run('without the WebGL base: the same, a picture a month', async f => {
  assert.equal(await f.page.evaluate(() => wfGlobe.usesBase), false);
  assert.equal(await f.page.evaluate(s => document.querySelector(s).step, SLIDER), '1');
  await seasons(f);
}, { debug: 'fps,2d' });

async function reefsOnTop(f) {
  // The reef areas are drawn with their coral edge; count those pixels at the Great Barrier Reef.
  await f.look(147, -17, 5);
  const edge = hex(await token(f, '--c-reef-edge'));
  const count = async () => {
    const png = await f.page.screenshot({ type: 'png' });
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < info.width * info.height * 3; i += 3) if (Math.hypot(data[i] - edge[0], data[i + 1] - edge[1], data[i + 2] - edge[2]) < 30) n++;
    return n;
  };
  await f.set(2);
  const feb = await count();
  await f.set(8);
  const aug = await count();
  assert.ok(feb > 200 && aug > 200, `reef edges showing in February (${feb} px) and August (${aug} px)`);
}
run('the reefs stay on top of the warm water (WebGL base)', reefsOnTop);
run('the reefs stay on top of the warm water picture without the WebGL base', reefsOnTop, { debug: 'fps,2d' });

run('reduced motion: the slider only', async f => {
  assert.equal(await f.page.locator('.gclockbar .gclock__play').count(), 0);
  await f.set(8);
  assert.match(await f.label(), /August/);
}, { reducedMotion: 'reduce' });
