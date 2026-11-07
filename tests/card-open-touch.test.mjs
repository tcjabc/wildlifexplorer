// The open card under real touches, in the real app (index.html, the router, the card screen) in
// Chromium at the baseline tablet's size, landscape and portrait. Speech is recorded, not spoken.
// Frame rates, voices and the feel of it on the tablet can't be tested here.
//
// Skipped when the browser isn't installed: npx playwright install chromium
// Run: npm run test:browser -- tests/card-open-touch.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setUp } from './fixtures/browser.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pw = null;
try { pw = await import('playwright'); } catch { /* not installed */ }
const have = () => { try { return pw && existsSync(pw.chromium.executablePath()); } catch { return false; } };
const skip = !have() && 'chromium not installed';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.webp': 'image/webp' };
let server, url;
before(async () => {
  server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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

const LANDSCAPE = { width: 1280, height: 800 }, PORTRAIT = { width: 800, height: 1280 };

async function open(viewport, profile = {}, reducedMotion = 'no-preference') {
  const browser = await pw.chromium.launch();
  return setUp(browser, async () => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: true, serviceWorkers: 'block', reducedMotion });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.said = [];
      speechSynthesis.speak = u => { window.said.push({ text: u.text, lang: u.lang, rate: u.rate }); };
      speechSynthesis.cancel = () => { window.said.push(null); };
    });
    await page.goto(url);
    await page.waitForFunction(() => !document.body.classList.contains('is-loading'), null, { timeout: 10000 });
    await page.evaluate(async p => { const s = await import('/js/store.js'); await s.createProfile({ name: 'Test', lang: 'en', ...p }); }, profile);
    await page.reload();
    await page.click('.picker__item:not(.picker__item--add)', { timeout: 10000 });
    await page.waitForSelector('main[data-view="binder"]', { timeout: 10000 });
    await page.evaluate(async () => {
      const store = await import('/js/store.js');
      for (const c of store.state.cards) store.state.collected[c.id] = { cardId: c.id };
    });
    const cdp = await ctx.newCDPSession(page);
    const send = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const wait = ms => page.waitForTimeout(ms);
    const box = sel => page.evaluate(s => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
    const middle = b => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
    const f = {
      browser, page, errors, wait, box,
      async card(id) {
        await page.evaluate(i => { location.hash = `#/card/${encodeURIComponent(i)}`; }, id);
        await page.waitForSelector('.viewer .card3d');
        await page.waitForFunction(i => document.querySelector('.viewer__bar') && location.hash.endsWith(i), id);
        await f.rests('front'); // past the zoom in
      },
      // The card at rest in this pose (the pose only changes once the spring has settled).
      rests: pose => page.waitForFunction(p => {
        const c = document.querySelector('.card3d');
        return c.classList.contains('is-rest') && c.dataset.pose === p;
      }, pose, { timeout: 4000 }),
      layout: () => page.evaluate(() => document.querySelector('.card3d').dataset.layout),
      async drag(from, to, steps = 8) {
        await send('touchStart', [{ ...from, id: 1 }]);
        for (let i = 1; i <= steps; i++) {
          await send('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, id: 1 }]);
          await wait(16);
        }
        await send('touchEnd', []);
        await wait(900);
      },
      async tap(sel) {
        const at = middle(await box(sel));
        await send('touchStart', [{ ...at, id: 1 }]);
        await wait(30);
        await send('touchEnd', []);
        await wait(200);
      },
      // A swipe across the middle of the closed card, which opens it.
      async swipe() {
        const c = await box('.card3d');
        const y = c.y + c.h / 2;
        await f.drag({ x: c.x + c.w * 0.8, y }, { x: c.x + c.w * 0.1, y });
        await f.rests('open');
      },
      lit: () => page.evaluate(() => [...document.querySelectorAll('.hbtn.is-on')].map(b => b.dataset.heading)),
      stage: () => page.evaluate(() => document.querySelector('.stage').firstElementChild?.className),
      said: () => page.evaluate(() => window.said.filter(Boolean).map(u => u.text)),
      forget: () => page.evaluate(() => { window.said.length = 0; }),
    };
    return f;
  });
}
const run = (name, fn, viewport = LANDSCAPE, profile, motion) => test(name, { skip }, async () => {
  const f = await open(viewport, profile, motion);
  try { await fn(f); assert.deepEqual(f.errors, []); } finally { await f.browser.close(); }
});
const both = (name, fn) => {
  run(`${name} (landscape)`, f => fn(f, 'side'), LANDSCAPE);
  run(`${name} (portrait)`, f => fn(f, 'stacked'), PORTRAIT);
};

both('a sideways swipe opens the card, the hand goes, and the stage and grid fill the screen', async (f, kind) => {
  await f.card('formosan-black-bear');
  // The first time, the cover peeks open first, and the hand waits for it.
  await f.page.waitForFunction(() => !document.querySelector('.viewer__hand').hidden, null, { timeout: 4000 });
  await f.rests('front');
  await f.swipe();
  await f.rests('open');
  assert.equal(await f.layout(), kind);
  assert.equal(await f.page.evaluate(() => document.querySelector('.viewer__hand').hidden), true);
  const stage = await f.box('.stage'), grid = await f.box('.hgrid');
  if (kind === 'side') assert.ok(stage.x + stage.w <= grid.x, 'side by side');
  else assert.ok(stage.y + stage.h <= grid.y, 'stage above the grid');
  const size = await f.page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  assert.equal(size[1], size[0], 'no sideways scroll');
  assert.ok(stage.w * stage.h > 0.2 * 1280 * 800, `a large stage: ${stage.w} x ${stage.h}`);
});

both('every heading button is at least 64 px, all eight, in the same place on every card', async f => {
  const seen = [];
  for (const id of ['formosan-black-bear', 'bengal-tiger', 'atlas-moth']) {
    await f.card(id);
    await f.swipe();
    const grid = await f.page.evaluate(() => [...document.querySelectorAll('.hbtn')].map(b => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.heading, x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height, c: getComputedStyle(b).backgroundColor, grey: b.getAttribute('aria-disabled') === 'true' };
    }));
    assert.equal(grid.length, 8, id);
    for (const b of grid) assert.ok(b.w >= 64 && b.h >= 64, `${id} ${b.id}: ${b.w} x ${b.h}`);
    seen.push(grid);
    await f.page.evaluate(() => { location.hash = '#/binder'; });
    await f.wait(700);
  }
  const place = g => g.map(b => [b.id, b.x, b.y].join());
  assert.deepEqual(place(seen[1]), place(seen[0]));
  assert.deepEqual(place(seen[2]), place(seen[0]));
  const colour = seen[0].map(b => b.c);
  assert.deepEqual(seen[1].filter(b => !b.grey).map(b => b.c), colour.filter((_, i) => !seen[1][i].grey), 'the same colours');
});

both('a heading lights up, says its name then its text, and switches the stage; again goes back', async f => {
  await f.card('formosan-black-bear');
  await f.swipe();
  assert.deepEqual(await f.lit(), []);
  assert.match(await f.stage(), /stage-pic/, 'the gallery first');
  await f.forget();
  await f.tap('.hbtn[data-heading="status"]');
  assert.deepEqual(await f.lit(), ['status']);
  assert.match(await f.stage(), /stage-status/);
  const said = await f.said();
  assert.equal(said[0], 'Status', 'its name first');
  assert.ok(said.length > 2, 'then its text');
  assert.doesNotMatch(said.join(' '), /\[\[/, 'no glossary marks read out');
  assert.match(await f.page.evaluate(() => document.querySelector('.open__text').textContent), /Red List/);
  await f.tap('.hbtn[data-heading="status"]');
  assert.deepEqual(await f.lit(), []);
  assert.match(await f.stage(), /stage-pic/, 'back to the gallery');
  assert.equal(await f.page.evaluate(() => window.said.at(-1)), null, 'and it stops talking');
});

run('it speaks at the profile\'s speed and in its language', async f => {
  await f.card('formosan-black-bear');
  await f.swipe();
  await f.forget();
  await f.tap('.hbtn[data-heading="habitat"]');
  const u = await f.page.evaluate(() => window.said.filter(Boolean));
  assert.equal(u[0].lang, 'en-GB');
  assert.ok(u.every(x => x.lang === 'en-GB' && Math.abs(x.rate - 0.95) < 1e-6), JSON.stringify(u[0]));
}, LANDSCAPE, { lang: 'en' });

run('in both languages it says English first, then Chinese', async f => {
  await f.page.evaluate(async () => (await import('/js/i18n.js')).setMode('both'));
  await f.card('formosan-black-bear');
  await f.swipe();
  await f.forget();
  await f.tap('.hbtn[data-heading="habitat"]');
  const langs = await f.page.evaluate(() => window.said.filter(Boolean).map(u => u.lang));
  assert.equal(langs[0], 'en-GB');
  assert.equal(langs.at(-1), 'zh-TW');
  assert.deepEqual(langs, [...langs].sort(), 'not mixed');
});

both('a grey heading does nothing when tapped, and a swipe that starts on it still closes the card', async f => {
  await f.card('atlas-moth');
  await f.swipe();
  assert.equal(await f.page.evaluate(() => document.querySelector('.hbtn[data-heading="status"]').getAttribute('aria-disabled')), 'true');
  await f.forget();
  await f.tap('.hbtn[data-heading="status"]');
  assert.deepEqual(await f.lit(), []);
  assert.deepEqual(await f.said(), []);
  const b = await f.box('.hbtn[data-heading="status"]');
  const y = b.y + b.h / 2;
  await f.drag({ x: b.x + b.w / 2, y }, { x: b.x + b.w / 2 + 400, y });
  await f.rests('front');
});

both('the water bear has partners of its own, and 2 of it make a grain of sand', async f => {
  await f.card('tardigrade-water-bear');
  await f.swipe();
  await f.tap('.hbtn[data-heading="size"]');
  await f.wait(800);
  const who = await f.page.evaluate(() => [...document.querySelectorAll('.stage-cmp__who [data-value]')].map(b => b.dataset.value));
  assert.deepEqual(who, ['sand', 'hair', 'salt']);
  assert.match(await f.page.evaluate(() => document.querySelector('.cmp-len').textContent), /0\.5 mm/);
  const pics = await f.page.evaluate(() => [...document.querySelectorAll('.cmp-len__img')].map(i => i.getBoundingClientRect().width));
  assert.ok(Math.abs(pics[0] / pics[1] - 2) < 0.1, `one scale: ${pics}`);
  await f.forget();
  await f.tap('.count');
  await f.tap('.count');
  assert.deepEqual(await f.said(), ['1', '2 water bears = 1 grain of sand']);
  await f.tap('.stage-cmp__who [data-value="hair"]');
  await f.wait(800);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.count').length), 0, 'nothing to count against a hair');
  assert.match(await f.page.evaluate(() => document.querySelector('.cmp-len').textContent), /0\.07 mm/);
  await f.tap('.stage-cmp__who [data-value="salt"]');
  await f.wait(800);
  await f.forget();
  await f.tap('.count');
  await f.tap('.count');
  assert.deepEqual(await f.said(), ['1', '2 grains of salt = 1 water bear']);
});

both('the cherry is drawn as a tree, with its own partners', async f => {
  await f.card('taiwan-cherry');
  await f.swipe();
  await f.tap('.hbtn[data-heading="size"]');
  await f.wait(800);
  const who = await f.page.evaluate(() => [...document.querySelectorAll('.stage-cmp__who [data-value]')].map(b => b.dataset.value));
  assert.deepEqual(who, ['you', 'adult', 'car']);
  const tree = await f.page.evaluate(() => { const i = [...document.querySelectorAll('.cmp-len__img')].find(x => x.src.endsWith('cherry-tree.svg')); return i && i.getBoundingClientRect().height; });
  const adult = await f.page.evaluate(() => { const i = [...document.querySelectorAll('.cmp-len__img')].find(x => x.src.endsWith('grown-up.svg')); return i && i.getBoundingClientRect().height; });
  assert.ok(Math.abs(tree / adult - 550 / 170) < 0.15, `one scale: ${tree} and ${adult}`);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.count__fig').length), 3, 'about 3 grown-ups to the top of the tree');
  await f.page.evaluate(async () => (await import('/js/i18n.js')).setMode('zh'));
  assert.match(await f.page.evaluate(() => document.querySelector('.open__text').textContent), /樹高/);
});

both('Size: the comparison fills the stage, the partners swap, and the row counts aloud', async f => {
  await f.card('formosan-black-bear');
  await f.swipe();
  await f.tap('.hbtn[data-heading="size"]');
  assert.match(await f.stage(), /stage-cmp/);
  await f.wait(800);
  const checked = () => f.page.evaluate(() => document.querySelector('.stage-cmp__who [aria-checked="true"]').dataset.value);
  assert.equal(await checked(), 'adult', 'no height on the profile: the grown-up');
  await f.tap('.stage-cmp__who [data-value="cat"]');
  await f.wait(800);
  assert.equal(await checked(), 'cat');
  const pics = await f.page.evaluate(() => [...document.querySelectorAll('.cmp-len__img')].map(i => i.getBoundingClientRect().width));
  assert.ok(Math.abs(pics[1] / pics[0] - 150 / 48) < 0.1, `one scale: ${pics}`);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.count__fig').length), 3, '150 cm is about 3 cats');
  await f.forget();
  await f.tap('.count');
  await f.tap('.count');
  await f.tap('.count');
  assert.deepEqual(await f.said(), ['1', '2', '3 cats!']);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.count__fig.is-lit').length), 3);
});

run('with their height on the profile, the child comes first, and the figures are theirs', async f => {
  await f.card('formosan-black-bear');
  await f.swipe();
  await f.tap('.hbtn[data-heading="size"]');
  await f.wait(800);
  assert.equal(await f.page.evaluate(() => document.querySelector('.stage-cmp__who [aria-checked="true"]').dataset.value), 'you');
  assert.equal(await f.page.evaluate(() => document.querySelector('.count__img').getAttribute('src')), 'assets/child.svg');
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.count__fig').length), 2, '150 cm is about 2 of a 75 cm child');
  await f.forget();
  await f.tap('.count');
  await f.tap('.count');
  assert.deepEqual(await f.said(), ['1', '2 of you!']);
}, LANDSCAPE, { heightCm: 75, weightKg: 12 });

both('Where: a range map fills the stage, and with no range the continent lights up', async f => {
  const fills = async () => {
    const stage = await f.box('.stage'), map = await f.box('.stage .map');
    assert.ok(Math.abs(map.w - stage.w) < 2 && Math.abs(map.h - stage.h) < 2, 'as big as the stage');
  };
  await f.card('bengal-tiger');
  await f.swipe();
  await f.tap('.hbtn[data-heading="where"]');
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.stage .map__continent').length), 1);
  await fills();
  await f.page.evaluate(() => { location.hash = '#/binder'; });
  await f.wait(700);
  await f.card('formosan-black-bear');
  await f.swipe();
  await f.tap('.hbtn[data-heading="where"]');
  await f.page.waitForSelector('.stage .map__range', { state: 'attached' });
  assert.ok(await f.box('.stage .map-open'), 'it opens the globe');
  await fills();
});

run('back from the globe: the card is open on the same heading, and quiet', async f => {
  await f.card('formosan-black-bear');
  await f.swipe();
  await f.tap('.hbtn[data-heading="where"]');
  await f.rests('open');
  await f.page.waitForSelector('.stage .map-open');
  await f.tap('.stage .map-open');
  await f.page.waitForFunction(() => location.hash.startsWith('#/globe/'));
  await f.wait(500);
  await f.forget();
  await f.page.evaluate(() => history.back());
  await f.page.waitForFunction(() => location.hash.startsWith('#/card/') && document.querySelector('.card3d'));
  await f.rests('open');
  assert.deepEqual(await f.lit(), ['where']);
  assert.match(await f.stage(), /stage-map/);
  assert.deepEqual(await f.said(), []);
});

run('Babies: a row to tap and count, from the card\'s number of young', async f => {
  await f.card('taiwan-blue-magpie');
  await f.swipe();
  await f.tap('.hbtn[data-heading="babies"]');
  assert.match(await f.stage(), /stage-babies/);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.count__fig').length), 8);
});

both('topic cards: their own set, in the same grid, with the facts where they were put', async f => {
  await f.card('kenting-coral-reefs');
  await f.swipe();
  const grid = await f.page.evaluate(() => [...document.querySelectorAll('.hbtn')].map(b => [b.dataset.heading, b.getAttribute('aria-disabled') !== 'true']));
  assert.deepEqual(grid.map(g => g[0]), ['what', 'how', 'who', 'when', 'wow', 'where', 'help', 'dyk']);
  assert.deepEqual(grid.filter(g => g[1]).map(g => g[0]), ['what', 'when', 'where']);
  await f.tap('.hbtn[data-heading="when"]');
  assert.match(await f.page.evaluate(() => document.querySelector('.open__text').textContent), /full moon/);
  await f.tap('.hbtn[data-heading="where"]');
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.stage .map__spot').length), 1, 'a pin on the place');
});

run('beside the expanded notebook the open card stacks, in the room that is left', async f => {
  await f.card('formosan-black-bear');
  await f.swipe();
  assert.equal(await f.layout(), 'side');
  await f.tap('.nbdock__spine');
  await f.wait(500);
  assert.equal(await f.layout(), 'stacked');
  const base = await f.box('.base'), panel = await f.box('.nbdock__panel');
  assert.ok(base.x + base.w <= panel.x, 'clear of the notebook');
  const tile = await f.box('.hbtn');
  assert.ok(tile.w >= 64 && tile.h >= 64);
});

run('swiping up no longer turns the card over, and swiping down still goes back to the binder', async f => {
  await f.card('formosan-black-bear');
  const c = await f.box('.card3d');
  const x = c.x + c.w / 2;
  await f.drag({ x, y: c.y + c.h * 0.8 }, { x, y: c.y + c.h * 0.2 });
  await f.rests('front');
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.face--x, .cpage--back').length), 0);
  await f.drag({ x, y: c.y + c.h * 0.2 }, { x, y: c.y + c.h * 0.9 });
  assert.equal(await f.page.evaluate(() => document.querySelector('.viewer')), null);
  assert.match(await f.page.evaluate(() => location.hash), /^#\/binder/);
});

run('with reduced motion the card still comes to rest, sharp, open and shut', async f => {
  await f.card('formosan-black-bear');
  await f.wait(300); // no zoom to wait through: give the page a moment before the first touch
  await f.swipe();
  await f.tap('.hbtn[data-heading="habitat"]');
  assert.deepEqual(await f.lit(), ['habitat']);
  const b = await f.box('.hbtn[data-heading="size"]');
  const y = b.y + b.h / 2;
  await f.drag({ x: b.x + b.w / 2, y }, { x: b.x + b.w / 2 + 400, y });
  await f.rests('front');
}, LANDSCAPE, undefined, 'reduce');
