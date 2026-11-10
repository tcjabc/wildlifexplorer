// Rain in the real app in Chromium: the month carries over from Temperature and Forests and back, the
// seasons as drawn (the Indian monsoon in July and not in January, read from the screen), the dry
// Sahara and the dry sea off Peru left plain, on the WebGL base and without it, and reduced motion. How it
// plays on the tablet the owner checks on the G Pad.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/globe-rain-touch.test.mjs
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

async function open({ debug = 'fps', reducedMotion = 'no-preference', layer = 'rain' } = {}) {
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
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
// Rain shows as blue over the plain map: bluer and darker than the same place when dry.
const rainier = (wet, dry) => wet[2] - wet[0] > dry[2] - dry[0] + 30 && lum(wet) < lum(dry) - 20;

// Central India (the monsoon), the Sahara, the dry sea off Peru.
const INDIA = [78, 21], SAHARA = [12, 25], PERU = [-95, -20];

run('the month carries over from Temperature and Forests, and back', async f => {
  await f.set(7);
  assert.match(await f.label(), /July/);
  await f.layer('rain');
  await f.page.waitForSelector(SLIDER);
  assert.equal(Math.round(await f.slider()), 7, 'Rain opens on July');
  assert.match(await f.label(), /七月/);
  await f.set(1);
  await f.layer('forests');
  await f.page.waitForSelector(SLIDER);
  assert.equal(Math.round(await f.slider()), 1, 'Forests on January');
  await f.layer('temp');
  await f.page.waitForSelector(SLIDER);
  assert.equal(Math.round(await f.slider()), 1, 'and Temperature too');
}, { layer: 'temp' });

async function seasons(f) {
  await f.look(60, 15, 1.4);
  await f.set(1);
  await f.wait(800); // the months arrive after the layer shows
  const jan = await f.colour(...INDIA), sahara = await f.colour(...SAHARA);
  await f.set(7);
  await f.wait(600);
  const jul = await f.colour(...INDIA);
  assert.ok(rainier(jul, jan), `India: January ${jan.map(Math.round)}, July ${jul.map(Math.round)} (the monsoon)`);
  assert.ok(dist(await f.colour(...SAHARA), sahara) < 8, 'the Sahara dry in both, the plain map');
  await f.look(-90, -15, 1.4);
  const sea = hex(await token(f, '--c-map-sea'));
  const peru = await f.colour(...PERU);
  assert.ok(dist(peru, sea) < 25, `the sea off Peru in July: dry, the plain sea, ${peru.map(Math.round)}`);
}
run('the seasons as drawn: India wet in July, dry in January; the dry Sahara and sea plain (WebGL base)', seasons);
run('without the WebGL base: the same, a picture a month', async f => {
  assert.equal(await f.page.evaluate(() => wfGlobe.usesBase), false);
  assert.equal(await f.page.evaluate(s => document.querySelector(s).step, SLIDER), '1');
  await seasons(f);
}, { debug: 'fps,2d' });

run('reduced motion: the slider only', async f => {
  assert.equal(await f.page.locator('.gclockbar .gclock__play').count(), 0);
  await f.set(6);
  assert.match(await f.label(), /June/);
}, { reducedMotion: 'reduce' });
