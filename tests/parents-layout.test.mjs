// The grown-ups' gate and page in the real app, at the baseline tablet's size: the question beside
// its keys in landscape with nothing to scroll, stacked in portrait; the cards in two columns in
// landscape, one in portrait, with no sideways scrolling and every control big enough. The wording
// is in tests/gate.test.mjs.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/parents-layout.test.mjs
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

const LANDSCAPE = { width: 1280, height: 800 }, PORTRAIT = { width: 800, height: 1280 };
const GPAD_IN_CHROME = { width: 1280, height: 640 }; // landscape, under Chrome's bars
const MIN_TAP = 64;
const WORDS = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
// An explorer, made on the app's own origin before it opens.
const SEED = `<!doctype html><script type=module>
import * as store from '/js/store.js';
import { loadStrings } from '/js/i18n.js';
await loadStrings();
await store.init();
const p = await store.createProfile({ name: 'Test', lang: new URLSearchParams(location.search).get('lang') });
await store.selectProfile(p.id);
window.ready = true;
</script>`;

let server, url;
before(async () => {
  server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    if (path === '/seed') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(SEED); return; }
    try {
      const file = path === '/' ? 'index.html' : path.slice(1);
      const body = await readFile(ROOT + file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}/`;
});
after(() => server?.close());

const run = (name, viewport, fn, lang = 'en') => test(name, { skip }, async () => {
  const browser = await pw.chromium.launch();
  try {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${url}seed?lang=${lang}`);
    await page.waitForFunction(() => window.ready);
    await page.goto(`${url}#/parents`);
    await page.waitForSelector('.picker__item, .gate');
    if (await page.$('.picker__item')) await page.click('.picker__item:not(.picker__item--add)');
    await page.waitForSelector('.main .gate');
    await fn(page);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

const box = (page, selector) => page.$eval(selector, el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });

const question = page => page.$eval('.gate__question .t-en, .gate__question .t-any', el => el.textContent);
const answerOf = text => {
  const [, a, b] = text.match(/What is (\w+) times (\w+)\?/);
  return (WORDS.indexOf(a) + 2) * (WORDS.indexOf(b) + 2);
};
async function type(page, n) {
  for (const digit of String(n)) await page.click(`.gate__key:text-is("${digit}")`);
  await page.click('.gate__key--go');
}
async function pass(page) {
  await type(page, answerOf(await question(page)));
  await page.waitForSelector('.parents__cards');
}

async function fitsBeside(page) {
  const ask = await box(page, '.gate__ask'), pad = await box(page, '.gate__pad'), form = await box(page, '.gate');
  assert.ok(ask.right <= pad.left, 'the question left of the keys');
  const { height } = page.viewportSize();
  assert.ok(form.bottom <= height, `the gate ends at ${form.bottom}, in a screen of ${height}`);
  const main = await page.$eval('.main', el => ({ scroll: el.scrollHeight, client: el.clientHeight }));
  assert.ok(main.scroll <= main.client, `nothing to scroll (${main.scroll} in ${main.client})`);
}

run('the gate in landscape: the question beside its keys, nothing to scroll', LANDSCAPE, fitsBeside);
run('the same under Chrome\'s bars on the tablet', GPAD_IN_CHROME, fitsBeside);
run('with both languages showing too', LANDSCAPE, fitsBeside, 'both');

run('the gate in portrait: stacked', PORTRAIT, async page => {
  const ask = await box(page, '.gate__ask'), pad = await box(page, '.gate__pad');
  assert.ok(ask.bottom <= pad.top, 'the question above the keys');
});

run('a wrong answer asks a new question; the right one opens the page', LANDSCAPE, async page => {
  const first = await question(page);
  await type(page, answerOf(first) + 1);
  const second = await question(page);
  assert.notEqual(second, first);
  assert.equal(await page.$eval('.gate__entry', el => el.textContent), '', 'the answer box is cleared');
  await pass(page);
});

run('in Chinese the question is in words too', LANDSCAPE, async page => {
  assert.match(await page.$eval('.gate__question .t-zh', el => el.textContent), /^[二三四五六七八九]乘以[二三四五六七八九]是多少？$/);
}, 'zh');

run('in its sheet (adding an explorer), on the tablet under Chrome\'s bars: beside its keys, nothing to scroll', GPAD_IN_CHROME, async page => {
  await page.evaluate(async () => { (await import('/js/components.js')).grownUpCheck(); });
  await page.waitForSelector('dialog .gate');
  const ask = await box(page, 'dialog .gate__ask'), pad = await box(page, 'dialog .gate__pad');
  assert.ok(ask.right <= pad.left);
  const sheet = await page.$eval('dialog.sheet', el => ({ scroll: el.scrollHeight, client: el.clientHeight, bottom: el.getBoundingClientRect().bottom }));
  assert.ok(sheet.scroll <= sheet.client && sheet.bottom <= GPAD_IN_CHROME.height, JSON.stringify(sheet));
});

test('the first explorer on a new device needs no gate', { skip }, async () => {
  const browser = await pw.chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: LANDSCAPE, serviceWorkers: 'block' })).newPage();
    await page.goto(url);
    await page.waitForSelector('dialog form input');
    assert.equal(await page.$('.gate'), null);
  } finally { await browser.close(); }
});

const cardLefts = page => page.$$eval('.parents__cards > *', els => [...new Set(els.map(el => Math.round(el.getBoundingClientRect().left)))]);

async function noSideways(page) {
  const sizes = await page.$eval('.main', el => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  assert.ok(sizes.scroll <= sizes.client, `no sideways scrolling (${sizes.scroll} in ${sizes.client})`);
  const over = await page.$$eval('.parents__cards *', els => els.filter(el => {
    const card = el.closest('.panel');
    return card && el.getBoundingClientRect().right > card.getBoundingClientRect().right + 0.5;
  }).map(el => el.className));
  assert.deepEqual(over, [], 'nothing sticks out of its card');
}

async function bigControls(page) {
  const small = await page.$$eval('.parents button, .parents input:not([hidden]):not([type=checkbox]), .parents select, .parents .switch, .parents a', (els, min) => els
    .map(el => ({ name: el.className || el.tagName, h: el.getBoundingClientRect().height, visible: el.offsetParent !== null }))
    .filter(c => c.visible && c.h < min), MIN_TAP);
  assert.deepEqual(small, []);
}

run('the page in landscape: two columns of cards', LANDSCAPE, async page => {
  await pass(page);
  assert.equal((await cardLefts(page)).length, 2);
  const heights = await page.$$eval('.parents__cards > *', els => els.map(el => el.getBoundingClientRect().height));
  assert.ok(new Set(heights.map(Math.round)).size > 2, 'each card as tall as what is in it');
  await noSideways(page);
  await bigControls(page);
});

run('the page in portrait: one column', PORTRAIT, async page => {
  await pass(page);
  assert.equal((await cardLefts(page)).length, 1);
  await noSideways(page);
  await bigControls(page);
});

run('both languages, on the narrowest landscape that has two columns', { width: 740, height: 360 }, async page => {
  await pass(page);
  assert.equal((await cardLefts(page)).length, 2);
  await noSideways(page);
}, 'both');
