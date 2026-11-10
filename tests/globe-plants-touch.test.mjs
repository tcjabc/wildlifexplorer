// Plant seasons in the real app in Chromium: the month carries over from Temperature and back, the
// seasons as drawn (Europe brown in January, green in July, read from the screen), the year playing
// at most 30 updates a second and past December with the slider at the start as soon as the label
// says January, waiting while the globe is held, stopping on leaving the layer, reduced motion, and
// a month at a time without the WebGL base. How it plays on the tablet the owner checks on the G Pad.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/globe-plants-touch.test.mjs
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

async function open({ debug = 'fps', reducedMotion = 'no-preference', layer = 'plants' } = {}) {
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
// Deeper green on the scale (brown, pale green, deep green): greener than red, and darker.
const greenness = c => c[1] - c[0];
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const deeper = (a, b) => greenness(a) > greenness(b) + 10 && lum(a) < lum(b) - 20;

run('the month carries over from Temperature, and back', async f => {
  await f.set(4);
  assert.equal(Math.round(await f.slider()), 4);
  assert.match(await f.label(), /April/);
  await f.layer('plants');
  await f.page.waitForSelector(SLIDER);
  assert.equal(Math.round(await f.slider()), 4, 'Plant seasons opens on April');
  assert.match(await f.label(), /April/);
  assert.match(await f.label(), /四月/);
  await f.set(9);
  await f.layer('temp');
  await f.page.waitForSelector(SLIDER);
  assert.equal(Math.round(await f.slider()), 9, 'and Temperature on September');
  assert.match(await f.label(), /September/);
}, { layer: 'temp' });

run('the seasons as drawn: Europe brown in January, green in July (WebGL base)', async f => {
  assert.equal(await f.page.evaluate(() => wfGlobe.usesBase), true);
  await f.look(10, 48, 2);
  await f.set(1);
  await f.wait(800); // the months arrive after the layer shows
  const jan = await f.colour(10, 51);
  await f.set(7);
  const jul = await f.colour(10, 51);
  assert.ok(deeper(jul, jan), `Germany deeper green in July: January ${jan.map(Math.round)}, July ${jul.map(Math.round)}`);
  const sahara = await f.colour(12, 26);
  assert.ok(greenness(sahara) < 10, `the Sahara, bare: ${sahara.map(Math.round)}`);
});

run('playing: at most 30 updates a second, past December with the slider at the start as January shows; held; stops on leaving', async f => {
  await f.set(12);
  await f.page.evaluate(() => {
    window.pushes = 0;
    const m = wfGlobe.month;
    wfGlobe.month = (p, ms) => { window.pushes++; return m(p, ms); };
  });
  await f.page.click('.gclockbar .gclock__play');
  assert.equal(await f.playing(), true);
  const seen = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 2000) {
    seen.push([await f.label(), await f.slider()]);
    await f.wait(50);
  }
  const rate = (await f.page.evaluate(() => window.pushes)) / 2;
  assert.ok(rate <= 31, `${rate.toFixed(1)} updates a second`);
  const jan = seen.filter(([l]) => /January/.test(l));
  assert.ok(jan.length > 0, 'it reached January');
  for (const [, v] of jan) assert.ok(v < 2, `January's slider at the start: ${v}`);
  // Held: nothing moves.
  const r = await f.page.evaluate(() => { const b = document.querySelector('.globe__canvas--over').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await f.page.mouse.move(r.x, r.y);
  await f.page.mouse.down();
  const held = await f.slider();
  await f.wait(700);
  assert.equal(await f.slider(), held, 'nothing moves while the globe is held');
  await f.page.mouse.up();
  await f.layer('forests');
  await f.layer('plants');
  await f.page.waitForSelector(SLIDER);
  assert.equal(await f.playing(), false, 'leaving the layer stopped it');
});

run('reduced motion: the slider only', async f => {
  assert.equal(await f.page.locator('.gclockbar .gclock__play').count(), 0);
  await f.set(7);
  assert.match(await f.label(), /July/);
}, { reducedMotion: 'reduce' });

run('without the WebGL base: a month at a time, the picture for each', async f => {
  assert.equal(await f.page.evaluate(() => wfGlobe.usesBase), false);
  assert.equal(await f.page.evaluate(s => document.querySelector(s).step, SLIDER), '1');
  await f.set(3);
  await f.page.click('.gclockbar .gclock__play');
  await f.wait(2300);
  await f.page.click('.gclockbar .gclock__play');
  const v = await f.slider();
  assert.ok(v === 5 || v === 4, `two months on, in whole months: ${v}`);
  await f.look(10, 48, 2);
  await f.set(7);
  await f.wait(800);
  const jul = await f.colour(10, 51);
  await f.set(1);
  await f.wait(800);
  const jan = await f.colour(10, 51);
  assert.ok(deeper(jul, jan), `the pictures too: January ${jan.map(Math.round)}, July ${jul.map(Math.round)}`);
}, { debug: 'fps,2d' });
