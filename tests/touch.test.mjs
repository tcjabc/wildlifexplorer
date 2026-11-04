// Drags must stay drags on a touchscreen (the iPad bug: drags acted like single taps on the
// globe and the cards). js/gesture.js track() runs here in real browsers: WebKit with an iPad
// profile and Chromium (Playwright).
//
// A touch pointer is captured by the element touched (implicit capture: WebKit and Chromium
// both fire gotpointercapture on it, checked below). When track() takes the pointer over for a
// drag, that element gets lostpointercapture, which bubbles up; track() used to read it as a
// lost drag and stop after one move, and Safari's click at the end then counted as a tap.
// Playwright can only tap a touchscreen in WebKit, not drag, so there the implicit capture is
// recreated on a real mouse drag (WebKit's own capture code runs); in Chromium a real touch
// drag is sent through the DevTools protocol.
//
// Skipped when the browsers aren't installed: npx playwright install webkit chromium
// Run: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }
const have = type => { try { return pw && existsSync(pw[type].executablePath()); } catch { return false; } };

// The harness: a stage with a child, as the globe (stage, canvas) and the viewer (stage, pages).
const PAGE = `<!doctype html><meta name=viewport content="width=device-width">
<div id=stage style="position:fixed;inset:0;touch-action:none"><div id=child style="position:absolute;left:100px;top:100px;width:400px;height:400px"></div></div>
<script type=module>
import { track } from '/js/gesture.js';
window.log = [];
const stage = document.getElementById('stage'), child = document.getElementById('child');
track(stage, {
  lock: () => true, move: () => log.push('move'), end: () => log.push('end'), cancel: () => log.push('cancel'), tap: () => log.push('tap'),
  pinchStart: () => log.push('pinchStart'), pinchMove: () => log.push('pinchMove'), pinchEnd: () => log.push('pinchEnd'),
});
child.addEventListener('click', () => log.push('click'));
// Recreate a touchscreen's implicit capture for a mouse pointer.
child.addEventListener('pointerdown', e => { if (window.implicit) child.setPointerCapture(e.pointerId); });
for (const t of ['gotpointercapture']) child.addEventListener(t, e => log.push(t + ':' + e.pointerType));
window.ready = true;
</script>`;

let server, url;
before(async () => {
  server = createServer(async (req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(PAGE); return; }
    try { const body = await readFile(ROOT + req.url.slice(1)); res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(body); } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

async function open(type) {
  const browser = await pw[type].launch();
  const ctx = await browser.newContext({ ...pw.devices['iPad (gen 7) landscape'] });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.ready);
  const log = () => page.evaluate(() => window.log.splice(0));
  return { browser, ctx, page, log };
}
const count = (log, name) => log.filter(x => x === name).length;

for (const type of ['webkit', 'chromium']) {
  test(`${type}: a touch is captured by the element touched (implicit capture)`, { skip: !have(type) && `${type} not installed` }, async () => {
    const { browser, page, log } = await open(type);
    try {
      await page.touchscreen.tap(200, 200);
      await page.waitForTimeout(200);
      assert.ok((await log()).includes('gotpointercapture:touch'));
    } finally { await browser.close(); }
  });

  test(`${type}: a drag stays a drag with the touched element holding the pointer, and its click is no tap`, { skip: !have(type) && `${type} not installed` }, async () => {
    const { browser, page, log } = await open(type);
    try {
      await page.evaluate(() => { window.implicit = true; });
      await page.mouse.move(200, 200);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(200 + i * 15, 200 + i * 4);
      await page.mouse.up();
      // Safari sends a click at the end of the sequence; it must not count.
      await page.evaluate(() => document.getElementById('child').click());
      await page.waitForTimeout(100);
      const l = await log();
      assert.equal(count(l, 'move'), 10, `every move arrives (${l.join(' ')})`);
      assert.equal(count(l, 'end'), 1);
      assert.equal(count(l, 'cancel'), 0);
      assert.equal(count(l, 'tap'), 0);
      assert.equal(count(l, 'click'), 0, 'the click after a drag is swallowed');
    } finally { await browser.close(); }
  });

  test(`${type}: a tap is still a tap, and its click goes through`, { skip: !have(type) && `${type} not installed` }, async () => {
    const { browser, page, log } = await open(type);
    try {
      await page.touchscreen.tap(250, 250);
      await page.evaluate(() => document.getElementById('child').click());
      await page.waitForTimeout(100);
      const l = await log();
      assert.equal(count(l, 'tap'), 1, l.join(' '));
      assert.ok(count(l, 'click') >= 1, 'the click goes through');
      assert.equal(count(l, 'move'), 0);
    } finally { await browser.close(); }
  });

  test(`${type}: a pointer the browser cancels mid-drag springs back, and no tap follows`, { skip: !have(type) && `${type} not installed` }, async () => {
    const { browser, page, log } = await open(type);
    try {
      await page.evaluate(() => {
        const child = document.getElementById('child');
        const ev = (t, x, y) => child.dispatchEvent(new PointerEvent(t, { pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }));
        ev('pointerdown', 200, 200);
        for (let i = 1; i <= 5; i++) ev('pointermove', 200 + i * 20, 200);
        ev('pointercancel', 300, 200);
        child.click();
      });
      const l = await log();
      assert.equal(count(l, 'cancel'), 1, l.join(' '));
      assert.equal(count(l, 'end'), 0);
      assert.equal(count(l, 'tap'), 0);
      assert.equal(count(l, 'click'), 0);
    } finally { await browser.close(); }
  });
}

test('chromium: a real touchscreen drag and a two-finger pinch', { skip: !have('chromium') && 'chromium not installed' }, async () => {
  const { browser, ctx, page, log } = await open('chromium');
  try {
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await touch('touchStart', [{ x: 200, y: 200 }]);
    for (let i = 1; i <= 10; i++) { await touch('touchMove', [{ x: 200 + i * 15, y: 200 }]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(300);
    let l = await log();
    assert.equal(count(l, 'move'), 10, l.join(' '));
    assert.equal(count(l, 'end'), 1);
    assert.equal(count(l, 'tap') + count(l, 'click') + count(l, 'cancel'), 0, l.join(' '));

    await touch('touchStart', [{ x: 250, y: 250, id: 1 }, { x: 350, y: 350, id: 2 }]);
    for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: 250 - i * 10, y: 250 - i * 10, id: 1 }, { x: 350 + i * 10, y: 350 + i * 10, id: 2 }]); await page.waitForTimeout(16); }
    await touch('touchEnd', []);
    await page.waitForTimeout(300);
    l = await log();
    assert.equal(count(l, 'pinchStart'), 1, l.join(' '));
    assert.ok(count(l, 'pinchMove') >= 5);
    assert.equal(count(l, 'tap') + count(l, 'click'), 0);
  } finally { await browser.close(); }
});
