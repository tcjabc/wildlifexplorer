// The base renderer in Chromium: it draws under the 2D canvases, and gives way when the context is
// lost. Its numbers are in tests/globe-base.test.mjs.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/globe-base-browser.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }
const have = () => { try { return pw && existsSync(pw.chromium.executablePath()); } catch { return false; } };
const skip = !have() && 'chromium not installed';

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp' };
const PAGE = `<!doctype html><link rel=stylesheet href="/css/tokens.css"><link rel=stylesheet href="/css/app.css">
<body><div class="globe__stage" id="stage" style="position:fixed;inset:0"></div>
<script type=module>
import { createGlobe } from '/js/globe.js';
import { LAYERS } from '/js/layers.js';
window.changes = [];
window.globe = createGlobe(document.getElementById('stage'), { onBase: ok => window.changes.push(ok) });
const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
window.temp = () => LAYERS.find(l => l.id === 'temp').gpu({ col, month: 1 });
window.ready = true;
</script>`;

let server, url;
before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
    try {
      const body = await readFile(ROOT + path.slice(1));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const run = (name, query, fn) => test(name, { skip }, async () => {
  const browser = await pw.chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url + query);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => window.globe.ready);
    await page.waitForTimeout(500);
    await fn(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

const canvases = page => page.evaluate(() => [...document.querySelectorAll('#stage canvas')].map(c => ({ cls: c.className, hidden: c.hidden, w: c.width })));

run('a WebGL canvas under the 2D ones, the same size, at the capped pixel ratio', '', async page => {
  await page.waitForTimeout(300);
  const list = await canvases(page);
  assert.equal(list.length, 3);
  assert.match(list[0].cls, /--gl/);
  assert.equal(list[0].hidden, false);
  assert.deepEqual(list.map(c => c.w), [1200, 1200, 1200]);
  assert.equal(await page.evaluate(() => window.globe.usesBase), true);
});

run('a layer on the GPU, and one with shapes on the sea over the plain map, both keep the canvas', '', async page => {
  await page.evaluate(async () => window.globe.setLayer(await window.temp()));
  await page.waitForTimeout(200);
  assert.equal((await canvases(page))[0].hidden, false);
  await page.evaluate(() => window.globe.setLayer({ sea: [] }));
  await page.waitForTimeout(200);
  assert.equal((await canvases(page))[0].hidden, false);
});

run('context lost: the canvas goes, the view hears so; restored: back it comes', '', async page => {
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const c = document.querySelector('.globe__canvas--gl');
    window.lose = c.getContext('webgl').getExtension('WEBGL_lose_context');
    window.lose.loseContext();
  });
  await page.waitForFunction(() => window.changes.length === 1);
  assert.equal((await canvases(page))[0].hidden, true);
  assert.equal(await page.evaluate(() => window.globe.usesBase), false);
  await page.evaluate(() => window.lose.restoreContext());
  await page.waitForFunction(() => window.changes.length === 2);
  assert.deepEqual(await page.evaluate(() => window.changes), [false, true]);
  await page.waitForTimeout(300);
  assert.equal((await canvases(page))[0].hidden, false);
  assert.equal(await page.evaluate(() => window.globe.usesBase), true);
});
