// Topography's sea level, in the real app in Chromium: the Taiwan Strait is sea today and land in
// the Ice Age (the pixel as drawn, on the WebGL base and on the fallback without it), the label and
// its slider, playing (Today → Ice Age, at most 30 updates a second, waiting while the globe is
// held), leaving the layer, and reduced motion. How it looks and moves on the tablet can't be tested
// here: the owner checks it on the G Pad itself.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/globe-sea-level.test.mjs
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

// The middle of the Taiwan Strait, about 58 m deep in assets/layers/elevation-2k.webp.
const STRAIT = [120.0, 24.5];
const SLIDER = '.gclock--sea .gclock__slider';

// The Globe with Topography on. debug: 'fps', or 'fps,2d' for no WebGL base.
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
      // A slider moved as a finger would: input while it moves, change as it is let go.
      async set(value, { release = true } = {}) {
        await page.evaluate(([s, v, r]) => {
          const el = document.querySelector(s);
          el.value = String(v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          if (r) el.dispatchEvent(new Event('change', { bubbles: true }));
        }, [SLIDER, value, release]);
        await f.wait(250);
      },
      level: () => page.evaluate(() => wfGlobe.level()),
      label: () => page.evaluate(() => document.querySelector('.gclock--sea .gclock__name').textContent),
      playing: () => page.evaluate(() => document.querySelector('.gclockbar .gclock__play')?.getAttribute('aria-pressed') === 'true'),
      look: async (lon, lat, k) => { await page.evaluate(([lon, lat, k]) => { wfGlobe.pause(true); wfGlobe.flyTo(lon, lat, k, { duration: 0 }); }, [lon, lat, k]); await f.wait(400); },
      // The colour drawn at a place (page px, from a screenshot: the base canvas can't be read back).
      async colour(lon, lat) {
        const at = await page.evaluate(([lon, lat]) => {
          const [x, y, z] = wfGlobe.at(lon, lat), r = document.querySelector('.globe__canvas--over').getBoundingClientRect();
          return z > 0 ? { x: Math.round(r.left + x), y: Math.round(r.top + y) } : null;
        }, [lon, lat]);
        assert.ok(at, 'the place is on the near side');
        const png = await page.screenshot({ type: 'png', clip: { x: at.x - 1, y: at.y - 1, width: 3, height: 3 } });
        const { data } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
        return [data[12], data[13], data[14]]; // the middle of the 3 × 3
      },
      token: name => page.evaluate(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name),
    };
    await f.layer('relief');
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

run('the Taiwan Strait: sea today, land in the Ice Age (WebGL base)', async f => {
  assert.equal(await f.page.evaluate(() => wfGlobe.usesBase), true);
  assert.match(await f.label(), /Today/);
  assert.match(await f.label(), /今天/);
  await f.look(STRAIT[0], STRAIT[1], 6);
  // The strait is sea: Topography's one blue, shaded by the floor.
  const dry = hex(await f.token('--c-relief-low'));
  const today = await f.colour(...STRAIT);
  assert.ok(today[2] > today[0] + 40 && dist(today, dry) > 60, `today the strait is the sea: ${today}`);
  await f.set(120);
  assert.equal(await f.level(), -120);
  assert.match(await f.label(), /Ice Age/);
  assert.match(await f.label(), /冰河時期/);
  await f.wait(500); // the floor arrives after the layer shows
  const ice = await f.colour(...STRAIT);
  assert.ok(dist(ice, dry) < 12, `in the Ice Age the strait is land: ${ice}`);
  await f.set(0);
  assert.ok(dist(await f.colour(...STRAIT), today) < 4, 'and back to the same sea');
});

run('the Taiwan Strait without the WebGL base: sea today, land once the slider is let go', async f => {
  assert.equal(await f.page.evaluate(() => wfGlobe.usesBase), false);
  await f.look(STRAIT[0], STRAIT[1], 6);
  const dry = hex(await f.token('--c-relief-low'));
  const today = await f.colour(...STRAIT);
  assert.ok(dist(today, dry) > 40, `today the strait is the picture's sea: ${today}`);
  assert.equal(await f.page.evaluate(s => document.querySelector(s).step, SLIDER), '10', 'ten metres a step');
  await f.set(120, { release: false });
  assert.equal(await f.level(), 0, 'dragging only moves the slider');
  await f.set(120);
  assert.equal(await f.level(), -120);
  const ice = await f.colour(...STRAIT);
  assert.ok(dist(ice, dry) < 30, `let go, the strait is land: ${ice}`);
}, { debug: 'fps,2d' });

// The sea floor shaded like the land (seafloor-2k.webp, lit from the north-west): at 26–34° N the
// Mid-Atlantic Ridge's western flank faces the light and its eastern one faces away. Nothing on the
// sea floor moves as the sea goes down.
const LATS = [26, 28, 30, 32, 34];
const WEST = LATS.map(lat => [-49, lat]), EAST = LATS.map(lat => [-37, lat]);
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mean = list => list.reduce((s, c) => s + lum(c), 0) / list.length;
async function floorColours(f) {
  const out = [];
  for (const p of [...WEST, ...EAST]) out.push(await f.colour(...p));
  return out;
}
async function seaFloor(f) {
  await f.look(-43, 30, 2);
  const before = await floorColours(f);
  for (const c of before) assert.ok(c[2] > c[0] + 40, `the sea is blue: ${c}`);
  const west = mean(before.slice(0, LATS.length)), east = mean(before.slice(LATS.length));
  assert.ok(west - east > 10, `the ridge lit on its west flank: ${west.toFixed(0)}, dark on its east: ${east.toFixed(0)}`);
  await f.set(120);
  await f.wait(500);
  const after = await floorColours(f);
  after.forEach((c, i) => assert.ok(dist(c, before[i]) < 4, `the sea floor the same in the Ice Age: ${before[i]} → ${c}`));
}
run('the sea floor: the Mid-Atlantic Ridge in light and shade, the same in the Ice Age (WebGL base)', seaFloor);
run('the sea floor without the WebGL base: the same', seaFloor, { debug: 'fps,2d' });

test('both renderers draw the same sea floor', { skip }, async () => {
  const take = async debug => {
    const f = await open({ debug });
    try {
      await f.look(-43, 30, 2);
      const c = await floorColours(f);
      assert.deepEqual(f.errors, []);
      return c;
    } finally { await f.browser.close(); }
  };
  const base = await take('fps'), fallback = await take('fps,2d');
  assert.ok(Math.abs(mean(base) - mean(fallback)) < 8, `as light overall: ${mean(base).toFixed(0)}, ${mean(fallback).toFixed(0)}`);
  base.forEach((c, i) => assert.ok(dist(c, fallback[i]) < 45, `the same place, near enough: ${c} and ${fallback[i]}`));
});

run('playing: down to the Ice Age, at most 30 updates a second, waiting while the globe is held; stops on leaving', async f => {
  await f.page.evaluate(() => {
    window.pushes = 0;
    const s = wfGlobe.seaLevel;
    wfGlobe.seaLevel = m => { window.pushes++; return s(m); };
  });
  await f.page.click('.gclockbar .gclock__play');
  assert.equal(await f.playing(), true);
  await f.wait(3000);
  const at3 = await f.level();
  // A quarter of the 12 s loop: halfway down, by the cosine.
  assert.ok(at3 < -40 && at3 > -80, `about −60 m after 3 s: ${at3}`);
  const rate = await f.page.evaluate(() => window.pushes) / 3;
  assert.ok(rate <= 31 && rate >= 15, `${rate.toFixed(1)} updates a second`);
  assert.match(await f.label(), /−\d+ m/);
  // A finger on the globe: the sea waits.
  const r = await f.page.evaluate(() => { const b = document.querySelector('.globe__canvas--over').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  await f.page.mouse.move(r.x, r.y);
  await f.page.mouse.down();
  const held = await f.level();
  await f.wait(800);
  assert.equal(await f.level(), held, 'nothing moves while it is held');
  await f.page.mouse.up();
  await f.wait(1500);
  assert.notEqual(await f.level(), held, 'and goes on once let go');
  await f.layer('depth');
  assert.equal(await f.level(), 0, 'another layer: today\'s sea');
  await f.layer('relief');
  assert.equal(await f.playing(), false);
  assert.match(await f.label(), /Today/);
  assert.equal(await f.page.evaluate(s => document.querySelector(s).value, SLIDER), '0');
});

run('reduced motion: the slider only', async f => {
  assert.equal(await f.page.locator('.gclockbar .gclock__play').count(), 0);
  await f.set(60);
  assert.equal(await f.level(), -60);
  assert.match(await f.label(), /−60 m/);
}, { reducedMotion: 'reduce' });
