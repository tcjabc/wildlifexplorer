#!/usr/bin/env node
// Frames per second and frame times. Never run automatically: only when asked for (CLAUDE.md, TESTING).
//   npm run bench -- globe                          the globe on this machine's GPU: fps while it
//                                                   turns, drags and zooms, per layer
//   npm run bench -- notes                          what a very full Field Notes page costs to draw
// Results say what this machine does, not what the kids' tablet does. --throttle=6 (the CPU) and
// --soft (a software GPU) are stand-ins for a slow device: only when asked for.
//
// fps and pixel reads must not share a run: getImageData moves the 2D canvases to software for the
// rest of the page's life, which once showed 8 fps where there were 60.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..') + '/';
const { chromium } = createRequire(ROOT)('playwright');

const [target, ...rest] = process.argv.slice(2);
const flag = name => rest.find(a => a === `--${name}` || a.startsWith(`--${name}=`))?.split('=')[1] ?? rest.includes(`--${name}`);
const throttle = Number(flag('throttle')) || 1, soft = Boolean(flag('soft'));
const VIEW = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5, serviceWorkers: 'block' }; // the tablet's size

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.webmanifest': 'application/manifest+json',
};

const NOTES_PAGE = `<!doctype html><meta name=viewport content="width=device-width, initial-scale=1">
${['tokens', 'app', 'card', 'notes'].map(n => `<link rel=stylesheet href="/css/${n}.css">`).join('')}
<body class="is-immersive"><main class="main" id="main" data-view="notes"></main>
<script type=module>
import * as store from '/js/store.js';
import * as notes from '/js/notes-store.js';
import { loadStrings, setMode } from '/js/i18n.js';
import { notebook } from '/js/notebook.js';
await loadStrings(); setMode('en'); await store.init();
const p = await store.createProfile({ name: 'Bench' });
await store.selectProfile(p.id);
store.state.profile.parent.preview = true;
await notes.loadIndex();
const first = notes.blankPage(); await notes.savePage(first);
window.book = notebook({ start: { view: 'pages', scope: { kind: 'free' }, pageId: first.id } });
document.getElementById('main').replaceChildren(window.book.el);
window.ready = true;
</script>`;

function serve() {
  const server = createServer(async (req, res) => {
    const file = new URL(req.url, 'http://x').pathname;
    if (file === '/notes-bench') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(NOTES_PAGE); return; }
    try {
      const body = await readFile(ROOT + (file === '/' ? 'index.html' : file.slice(1)));
      res.writeHead(200, { 'content-type': TYPES[extname(file) || '.html'] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  return new Promise(r => { server.listen(0, '127.0.0.1', () => r(server)); });
}

async function notesBench(page, base, cdp) {
  await page.goto(`${base}/notes-bench?debug=notes`);
  await page.waitForFunction(() => window.ready);
  await page.waitForTimeout(800);
  for (const [stamps, trails] of [[400, 20], [130, 20]]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.evaluate(([a, b]) => window.wfNotes.heavy(a, b), [stamps, trails]);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.wfNotes.bench(1)); // warm
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
    console.log(JSON.stringify(await page.evaluate(() => window.wfNotes.bench(3))));
  }
}

async function globeBench(page, base, cdp) {
  const url = `${base}/?debug=fps`;
  await page.goto(url);
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const st = await import('/js/store.js');
    const p = await st.createProfile({ name: 'Bench' });
    await st.updateProfile(p.id, { parent: { ...p.parent, preview: true } });
  });
  await page.goto(url);
  await page.click('.picker__item');
  await page.waitForTimeout(600);
  await page.evaluate(() => { location.hash = '#/globe'; });
  await page.waitForFunction(() => window.wfGlobe, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { document.querySelector('.notice .btn--soft')?.click(); document.querySelector('.glayer--paw')?.click(); });
  console.log(await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl'), e = gl?.getExtension('WEBGL_debug_renderer_info');
    return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'no WebGL';
  }));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

  const measure = mode => page.evaluate(m => new Promise(done => {
    const g = window.wfGlobe, gaps = [];
    let last = 0, i = 0, t0 = 0;
    const step = t => {
      t0 ||= t;
      if (last) gaps.push(t - last);
      last = t;
      i++;
      if (m === 'drag') g.spinBy(1.2, 0.3 * Math.sin(i / 20));
      if (m === 'spin') g.spinBy(0.07, 0);
      if (m === 'pinch') g.zoomBy(i % 120 < 60 ? 1.012 : 1 / 1.012);
      if (t - t0 < 3000) { requestAnimationFrame(step); return; }
      gaps.sort((a, b) => a - b);
      const sum = gaps.reduce((s, x) => s + x, 0);
      done({ fps: Math.round((gaps.length * 1000) / sum), p95: gaps[Math.floor(gaps.length * 0.95)].toFixed(1), meter: document.querySelector('.globe__fps')?.textContent ?? '' });
    };
    requestAnimationFrame(step);
  }), mode);

  for (const layer of ['temp', 'relief', 'none']) {
    await page.evaluate(id => document.querySelector(`[data-layer="${id}"]`).click(), layer);
    await page.waitForTimeout(2500);
    for (const mode of ['spin', 'drag', 'pinch']) {
      await page.evaluate(() => { window.wfGlobe.flyTo(121, 23.7, 1, { duration: 1 }); });
      await page.waitForTimeout(300);
      const r = await measure(mode);
      console.log(`${layer.padEnd(6)} ${mode.padEnd(5)} ${String(r.fps).padStart(3)} fps  p95 ${r.p95.padStart(6)} ms  ${r.meter}`);
    }
  }
}

const BENCHES = { globe: globeBench, notes: notesBench };
if (!BENCHES[target]) { console.error('Usage: npm run bench -- globe|notes'); process.exit(2); }

const server = await serve();
let browser = null;
try {
  browser = await chromium.launch(soft
    ? { headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
    : { headless: false, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
  const ctx = await browser.newContext(VIEW);
  const page = await ctx.newPage();
  page.on('pageerror', e => console.error('page error:', e.message));
  await BENCHES[target](page, `http://127.0.0.1:${server.address().port}`, await ctx.newCDPSession(page));
} finally {
  await browser?.close();
  server.close();
}
