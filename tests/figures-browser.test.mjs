// Every picture the size comparison can draw loads in a browser as an image with a shape: the
// partners (people drawn, the rest traced from photos), each card's comparison picture and the
// lookalike entries' silhouettes. tests/figures.test.mjs checks their sizes and credits.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setUp } from './fixtures/browser.mjs';
import { PARTNERS, compareImage } from '../js/compare-data.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }
const have = () => { try { return pw && existsSync(pw.chromium.executablePath()); } catch { return false; } };
const skip = !have() && 'chromium not installed';

const TYPES = { '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };
let server, url;
before(async () => {
  server = createServer(async (req, res) => {
    const file = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1) || 'blank.html';
    try {
      const body = file === 'blank.html' ? '<!doctype html><title>figures</title>' : await readFile(ROOT + file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const cards = JSON.parse(await readFile(new URL('../data/animals.json', import.meta.url), 'utf8'));
const lookalikes = JSON.parse(await readFile(new URL('../data/lookalikes.json', import.meta.url), 'utf8'));
const FILES = [...new Set([
  'assets/child.svg',
  ...Object.values(PARTNERS).map(p => p.img),
  ...cards.map(compareImage).filter(Boolean),
  ...Object.values(lookalikes.entries ?? {}).map(e => e.silhouette?.file).filter(Boolean),
])];

test('every comparison silhouette loads, with the shape the comparison expects', { skip }, async () => {
  const browser = await pw.chromium.launch();
  try {
    const page = await setUp(browser, async () => {
      const p = await browser.newPage();
      await p.goto(url);
      return p;
    });
    const got = await page.evaluate(files => Promise.all(files.map(f => new Promise(done => {
      const img = new Image();
      img.onload = () => done({ f, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => done({ f, w: 0, h: 0 });
      img.src = f;
    }))), FILES);
    for (const { f, w, h } of got) assert.ok(w > 0 && h > 0, `${f} does not load`);
    // The partners' pictures are as wide for their height as the scenes assume (PARTNERS ratio).
    for (const p of Object.values(PARTNERS)) {
      const { w, h } = got.find(g => g.f === p.img);
      assert.ok(Math.abs(h / w - p.ratio) < 0.01, `${p.id}: ${w}×${h} vs ratio ${p.ratio}`);
    }
  } finally {
    await browser.close();
  }
});
