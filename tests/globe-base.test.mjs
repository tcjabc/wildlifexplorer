// The ?globe=webgl spike (js/globe-base.js): its numbers, and in Chromium that it draws under the 2D
// canvases, stays out of the way without the flag, and gives way when the context is lost.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rampBytes, rampValue, textureBytes, BASE_DPR } from '../js/globe-base.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const STOPS = [{ v: -30, colour: '#000000' }, { v: 10, colour: '#ff0000' }, { v: 50, colour: '#ffffff' }];

test('the colour scale as pixels: its ends, and a point between two stops', () => {
  const px = rampBytes(STOPS, 5);
  assert.deepEqual([...px.slice(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...px.slice(8, 12)], [255, 0, 0, 255]);
  assert.deepEqual([...px.slice(16, 20)], [255, 255, 255, 255]);
  assert.deepEqual([...px.slice(4, 8)], [128, 0, 0, 255]);
});

test('a byte of a number texture: 0 is no data, 1 and 255 the ends of the scale', () => {
  assert.equal(rampValue(0, STOPS), null);
  assert.equal(rampValue(1, STOPS), -30);
  assert.equal(rampValue(255, STOPS), 50);
  assert.equal(rampValue(128, STOPS), 10);
});

test('GPU memory, and the pixel ratio cap', () => {
  assert.equal(textureBytes(2048, 1024), 8 * 1024 * 1024);
  assert.equal(BASE_DPR, 1.5);
});

test('the renderer works offline and its textures are the globe\'s files', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.match(sw, /'js\/globe-base\.js'/);
  assert.match(sw, /GLOBE_FILE = .*assets\\\/\(layers\\\//);
  for (const f of ['shade-2k', 'temp-mean-2k', 'relief-2k']) assert.ok(existsSync(`${ROOT}assets/layers/${f}.webp`), f);
});

let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }
const have = () => { try { return pw && existsSync(pw.chromium.executablePath()); } catch { return false; } };
const skip = !have() && 'chromium not installed';

const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp' };
const PAGE = `<!doctype html><link rel=stylesheet href="/css/tokens.css"><link rel=stylesheet href="/css/app.css">
<body><div class="globe__stage" id="stage" style="position:fixed;inset:0"></div>
<script type=module>
import { createGlobe } from '/js/globe.js';
import { LAYERS, tempStops } from '/js/layers.js';
const q = new URLSearchParams(location.search);
window.changes = [];
window.globe = createGlobe(document.getElementById('stage'), { glBase: q.has('gl'), onBase: ok => window.changes.push(ok) });
const col = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
window.temp = () => LAYERS.find(l => l.id === 'temp').base({ col });
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
  const page = await (await browser.newContext({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 })).newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto(url + query);
    await page.waitForFunction(() => window.ready);
    await page.evaluate(() => window.globe.ready);
    await page.waitForTimeout(500);
    await fn(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

const canvases = page => page.evaluate(() => [...document.querySelectorAll('#stage canvas')].map(c => ({ cls: c.className, hidden: c.hidden, w: c.width })));

run('without the flag: only the two 2D canvases, at the pixel ratio they had', '', async page => {
  const list = await canvases(page);
  assert.equal(list.length, 2);
  assert.equal(list[0].w, 1600);
});

run('with the flag: a WebGL canvas under the 2D ones, the same size, at the capped pixel ratio', '?gl', async page => {
  await page.waitForTimeout(300);
  const list = await canvases(page);
  assert.equal(list.length, 3);
  assert.match(list[0].cls, /--gl/);
  assert.equal(list[0].hidden, false);
  assert.deepEqual(list.map(c => c.w), [1200, 1200, 1200]);
  assert.equal(await page.evaluate(() => window.globe.usesBase()), true);
});

run('a layer with shapes on the sea stays on the 2D canvas; a number layer shows on the GPU', '?gl', async page => {
  await page.evaluate(() => window.globe.setLayer({ sea: [] }));
  assert.equal((await canvases(page))[0].hidden, true);
  await page.evaluate(() => window.globe.setLayer({ base: window.temp() }));
  assert.equal((await canvases(page))[0].hidden, false);
});

run('context lost: the canvas goes, the view hears so; restored: back it comes', '?gl', async page => {
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const c = document.querySelector('.globe__canvas--gl');
    window.lose = c.getContext('webgl').getExtension('WEBGL_lose_context');
    window.lose.loseContext();
  });
  await page.waitForFunction(() => window.changes.length === 1);
  assert.equal((await canvases(page))[0].hidden, true);
  assert.equal(await page.evaluate(() => window.globe.usesBase()), false);
  await page.evaluate(() => window.lose.restoreContext());
  await page.waitForFunction(() => window.changes.length === 2);
  assert.deepEqual(await page.evaluate(() => window.changes), [false, true]);
  assert.equal((await canvases(page))[0].hidden, false);
  assert.equal(await page.evaluate(() => window.globe.usesBase()), true);
});
