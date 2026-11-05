// Volcanoes on the globe, in the real app (Playwright, iPad profile): a tap within a volcano's
// 44 px target opens its card, a tap elsewhere closes it, and a drag that starts on a volcano
// turns the globe and opens nothing. Chromium gets real touchscreen drags (DevTools protocol);
// in WebKit, where Playwright can only tap a touchscreen, the drag is a mouse drag with the
// touch's implicit capture recreated (see tests/touch.test.mjs).
// Skipped when the browsers aren't installed: npx playwright install webkit chromium
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }
const have = type => { try { return pw && existsSync(pw[type].executablePath()); } catch { return false; } };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

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

async function openGlobe(type) {
  const browser = await pw[type].launch();
  const ctx = await browser.newContext({ ...pw.devices['iPad (gen 7) landscape'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(base);
  await page.waitForSelector('form button[type=submit]');
  await page.locator('form input').first().fill('Tester');
  await page.locator('form button[type=submit]').click();
  await page.waitForTimeout(800);
  // Preview on (so ?debug=fps works), the panel folded out of the way.
  await page.evaluate(async () => { const st = await import('/js/store.js'); await st.updateProfile(st.state.profile.id, { parent: { preview: true }, globePanel: 'collapsed' }); });
  await page.goto(`${base}?debug=fps#/globe`);
  await page.locator('.picker button, .picker [role=button], .picker a').filter({ hasText: 'Tester' }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => { location.hash = '#/globe'; });
  await page.waitForFunction(() => window.wfGlobe);
  await page.waitForTimeout(1000);
  await page.locator('.gtile--hero').click();
  await page.locator('.gtile[data-layer=plates]').click();
  await page.waitForFunction(() => wfGlobe.volcanoesShown().length > 0, null, { timeout: 15000 });
  await page.evaluate(() => { wfGlobe.pause(true); wfGlobe.flyTo(121.6, 25.0, 6, { duration: 0 }); });
  await page.waitForTimeout(1200);
  const stage = await page.locator('.globe__stage').boundingBox();
  const where = async name => { const v = (await page.evaluate(() => wfGlobe.volcanoesShown())).find(x => x.en.startsWith(name)); return v && { x: stage.x + v.x, y: stage.y + v.y }; };
  const card = () => page.evaluate(() => { const c = document.querySelector('.gvolc'); return c.hidden ? null : c.textContent; });
  return { browser, ctx, page, errors, where, card };
}

for (const type of ['chromium', 'webkit']) {
  test(`${type}: tap a volcano for its card, tap elsewhere to close; a drag from a volcano turns the globe`, { skip: !have(type) && `${type} not installed`, timeout: 60000 }, async () => {
    const { browser, ctx, page, errors, where, card } = await openGlobe(type);
    try {
      const tatun = await where('Tatun');
      assert.ok(tatun, 'the Tatun Volcanic Group is drawn near Taipei');
      // Within the touch target, on the side away from Kueishantao (16 px east-south-east).
      await page.touchscreen.tap(tatun.x - 8, tatun.y - 5);
      await page.waitForTimeout(400);
      const text = await card();
      assert.match(text ?? '', /Tatun Volcanic Group/);
      assert.match(text, /大屯火山群/);
      assert.match(text, /臺灣/, 'Taiwan as the app writes it');
      assert.match(text, /uncertain/, 'its last eruption is uncertain (data/volcano-overrides.json)');
      await page.touchscreen.tap(tatun.x + 220, tatun.y + 160);
      await page.waitForTimeout(500);
      assert.equal(await card(), null, 'a tap on the sea closes it');

      if (type === 'chromium') {
        const cdp = await ctx.newCDPSession(page);
        const touch = (t, pts) => cdp.send('Input.dispatchTouchEvent', { type: t, touchPoints: pts });
        await touch('touchStart', [tatun]);
        for (let i = 1; i <= 8; i++) { await touch('touchMove', [{ x: tatun.x + i * 15, y: tatun.y }]); await page.waitForTimeout(16); }
        await touch('touchEnd', []);
      } else {
        await page.evaluate(() => document.addEventListener('pointerdown', e => { try { e.target.setPointerCapture(e.pointerId); } catch { /* gone */ } }, true));
        await page.mouse.move(tatun.x, tatun.y);
        await page.mouse.down();
        for (let i = 1; i <= 8; i++) await page.mouse.move(tatun.x + i * 15, tatun.y);
        await page.mouse.up();
      }
      await page.waitForTimeout(500);
      const moved = await where('Tatun');
      assert.ok(!moved || moved.x - tatun.x > 60, `the globe turned (${moved ? Math.round(moved.x - tatun.x) : 'off screen'} px)`);
      assert.equal(await card(), null, 'a drag opens no card');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
