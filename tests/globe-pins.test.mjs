// Hiding the animal pins, in the real app (Playwright): the paw button, what stays (map layers,
// the filter selection), what waits (filters, key rows, hints), the state across tab visits, and
// opening the globe from a card (pins on, that card's pin past the filters).
// Skipped when the browsers aren't installed: npx playwright install webkit chromium
// Run: npm run test:browser -- tests/globe-pins.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setUp } from './fixtures/browser.mjs';

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

const CARD = 'formosan-black-bear';
const pinsOn = page => page.locator('.gpin:not(.is-off)').count();
const go = async (page, hash) => { await page.evaluate(h => { location.hash = h; }, hash); await page.waitForTimeout(600); };

// A new explorer (no cards yet); with preview on later, every card has a pin.
async function start(type) {
  const browser = await pw[type].launch();
  return setUp(browser, async () => {
    const ctx = await browser.newContext({ ...pw.devices['iPad (gen 7) landscape'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(base);
    await page.waitForSelector('form button[type=submit]');
    await page.locator('form input').first().fill('Tester');
    await page.locator('form button[type=submit]').click();
    await page.waitForTimeout(800);
    await page.evaluate(async () => { const st = await import('/js/store.js'); await st.updateProfile(st.state.profile.id, { globePanel: 'collapsed' }); });
    return { browser, ctx, page, errors };
  });
}
async function previewGlobe(page) {
  await page.evaluate(async () => { const st = await import('/js/store.js'); await st.updateProfile(st.state.profile.id, { parent: { preview: true } }); });
  await page.goto(`${base}?debug=fps#/globe`);
  await page.locator('.picker button, .picker [role=button], .picker a').filter({ hasText: 'Tester' }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  await page.evaluate(() => { location.hash = '#/globe'; });
  await page.waitForFunction(() => window.wfGlobe);
  await page.waitForFunction(() => document.querySelectorAll('.gpin:not(.is-off)').length > 0, null, { timeout: 20000 });
  await page.evaluate(() => wfGlobe.pause(true));
}
async function chooseFilter(page, name) {
  await page.locator('.glayer--filter').click();
  await page.locator('.gopt').filter({ hasText: name }).click();
  await page.locator('.gdrawer__head .btn--icon').click();
}

for (const type of ['chromium', 'webkit']) {
  const skip = !have(type) && `${type} not installed`;

  test(`${type}: no cards yet, the hint goes while pins are hidden and comes back`, { skip }, async () => {
    const { browser, page, errors } = await start(type);
    try {
      await go(page, '#/globe');
      const hint = page.locator('.globe__hint');
      await page.waitForFunction(() => document.querySelector('.globe__hint')?.textContent.includes('Collect cards'));
      await page.locator('.glayer--paw').click();
      assert.equal(await hint.isVisible(), false, 'no hint while hidden');
      await go(page, '#/binder');
      await go(page, '#/globe');
      await page.waitForTimeout(500);
      assert.equal(await hint.isVisible(), false, 'nor after a tab visit');
      await page.locator('.glayer--paw').click();
      assert.match(await hint.textContent(), /Collect cards/);
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });

  test(`${type}: the paw hides the pins, layers stay, filters wait, and it lasts across tab visits`, { skip }, async () => {
    const { browser, page, errors } = await start(type);
    try {
      await previewGlobe(page);
      const paw = page.locator('.glayer--paw'), filter = page.locator('.glayer--filter');
      const box = await paw.boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `a 44 px target (${box.width} × ${box.height})`);
      assert.match(await paw.getAttribute('aria-label'), /^Hide animals/);
      assert.equal(await page.locator('.is-crossed').count(), 0);

      // A filter, then the drawer still open when the pins go.
      await chooseFilter(page, 'Antarctica');
      await page.waitForTimeout(300);
      const chosen = await page.locator('.gchip').count();
      assert.equal(chosen, 1);
      await filter.click();
      await paw.click();
      assert.equal(await filter.getAttribute('aria-expanded'), 'false', 'the drawer closes');

      await page.waitForTimeout(300);
      assert.equal(await pinsOn(page), 0, 'no pins, no stacks');
      assert.match(await paw.getAttribute('aria-label'), /^Show animals/);
      assert.equal(await page.locator('.glayer--paw.is-crossed').count(), 1);
      assert.equal(await page.locator('.glayer--paw .art__paw-cross').evaluate(el => getComputedStyle(el).display === 'none'), false, 'crossed out');
      assert.equal(await filter.isDisabled(), true);
      assert.equal(await page.locator('.gchip').isDisabled(), true);
      assert.equal(await page.locator('.gchip').count(), chosen, 'the selection is kept');
      const dimmed = await filter.evaluate(el => Number(getComputedStyle(el).opacity));
      assert.ok(dimmed < 1, `dimmed (${dimmed})`);

      // The key: only Plain map has animal rows, and they fade.
      const rows = page.locator('.gkey__item--animals');
      assert.equal(await rows.count(), 3);
      for (let i = 0; i < 3; i++) assert.ok(await rows.nth(i).evaluate(el => Number(getComputedStyle(el).opacity)) < 1);

      // Across a tab visit.
      await go(page, '#/binder');
      await go(page, '#/globe');
      await page.waitForFunction(() => window.wfGlobe);
      await page.waitForTimeout(1500);
      assert.equal(await pinsOn(page), 0, 'still hidden');
      assert.equal(await filter.isDisabled(), true);
      assert.equal(await page.locator('.gchip').count(), chosen);

      // A layer's markers don't depend on the pins.
      await page.locator('.gtile--hero').click();
      await page.locator('.gtile[data-layer=plates]').click();
      await page.waitForFunction(() => wfGlobe.volcanoesShown().length > 0, null, { timeout: 15000 });
      const volcanoes = await page.evaluate(() => { wfGlobe.pause(true); return wfGlobe.volcanoesShown().length; });
      await paw.click();
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => wfGlobe.volcanoesShown().length), volcanoes, 'the same volcanoes with pins on');
      assert.equal(await page.locator('.gkey__item--animals').count(), 0, 'no animal rows in a layer\'s key');
      assert.equal(await filter.isDisabled(), false);
      assert.equal(await page.locator('.gchip').isDisabled(), false, 'the filter is back, as it was');
      assert.equal(await page.locator('.gchip').count(), chosen);
      await paw.click();
      await page.waitForTimeout(300);
      assert.equal(await page.evaluate(() => wfGlobe.volcanoesShown().length), volcanoes, 'and with pins hidden');
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });

  test(`${type}: from a card the pins are on, and its pin shows past the filters until they change`, { skip }, async () => {
    const { browser, page, errors } = await start(type);
    try {
      await previewGlobe(page);
      const paw = page.locator('.glayer--paw');
      await chooseFilter(page, 'Africa');
      await paw.click();
      await page.waitForTimeout(300);
      assert.equal(await pinsOn(page), 0);

      await go(page, `#/globe/${CARD}`);
      await page.waitForFunction(() => document.querySelector('.gpin.is-selected'), null, { timeout: 20000 });
      await page.waitForTimeout(1500);
      const own = page.locator('.gpin.is-selected');
      assert.match(await paw.getAttribute('aria-label'), /^Hide animals/, 'pins are on');
      assert.equal(await page.locator('.glayer--filter').isDisabled(), false);
      assert.equal(await own.evaluate(el => el.classList.contains('is-off')), false, 'its pin shows, though Africa is chosen');
      assert.equal(await page.locator('.globe__hint').isVisible(), false);
      const name = await own.getAttribute('aria-label');
      const ownPin = page.locator(`.gpin[aria-label="${name}"]`);
      const ownGoes = () => page.waitForFunction(n => document.querySelector(`.gpin[aria-label="${n}"]`).classList.contains('is-off'), name, { timeout: 5000 });

      // Hiding and showing doesn't lose it.
      await paw.click();
      await page.waitForTimeout(200);
      assert.equal(await pinsOn(page), 0);
      await paw.click();
      await page.waitForTimeout(200);
      assert.equal(await ownPin.evaluate(el => el.classList.contains('is-off')), false, 'back with the pins');

      // Another pin picked: the filter counts for it again.
      await page.evaluate(() => { wfGlobe.pause(true); wfGlobe.flyTo(20, 0, 3, { duration: 0 }); });
      await page.waitForTimeout(800);
      await page.locator(`.gpin:not(.is-off):not(.is-stack):not([aria-label="${name}"])`).first().evaluate(el => el.click());
      await ownGoes(); // gone once another pin is picked
      await page.locator('.gsheet__close').click();
      await page.waitForTimeout(400);

      // Opened again, then the filters changed: the same.
      await go(page, '#/binder');
      await go(page, `#/globe/${CARD}`);
      await page.waitForFunction(() => document.querySelector('.gpin.is-selected'), null, { timeout: 20000 });
      await page.waitForTimeout(1500);
      assert.equal(await ownPin.evaluate(el => el.classList.contains('is-off')), false);
      await page.locator('.gchip').click();
      await page.waitForTimeout(200);
      await chooseFilter(page, 'Africa');
      await ownGoes(); // gone once the filters change
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  });
}
