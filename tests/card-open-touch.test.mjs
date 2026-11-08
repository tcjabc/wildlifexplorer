// The card, front and back, under real touches, in the real app (index.html, the router, the card
// screen) in Chromium at the baseline tablet's size, landscape and portrait. Any speech is recorded, not spoken.
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
      browser, page, errors, wait, box, send,
      async card(id) {
        await page.evaluate(i => { location.hash = `#/card/${encodeURIComponent(i)}`; }, id);
        await page.waitForSelector('.viewer .card3d');
        await page.waitForFunction(i => document.querySelector('.viewer__bar') && location.hash.endsWith(i), id);
        await f.rests(); // past the zoom in
      },
      // Nothing moving: the card at rest, flat.
      rests: () => page.waitForTimeout(40).then(() => page.waitForFunction(() => {
        const s = document.querySelector('.viewer__stage');
        return s && !s.classList.contains('is-3d');
      }, null, { timeout: 4000 })),
      layout: () => page.evaluate(() => document.querySelector('.viewer__stage').dataset.layout),
      // Showing this face ('front', 'back', or 'both' side by side) and nothing moving.
      faces: face => page.waitForFunction(x => {
        const s = document.querySelector('.viewer__stage');
        return s?.dataset.face === x && !s.classList.contains('is-3d');
      }, face, { timeout: 4000 }),
      // A swipe up or down through the middle of whatever shows.
      async vertical(sel, way) {
        const c = await box(sel);
        const x = c.x + c.w / 2, top = c.y + c.h * 0.25, bottom = c.y + c.h * 0.75;
        await f.drag({ x, y: way === 'up' ? bottom : top }, { x, y: way === 'up' ? top : bottom });
      },
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
      // A swipe sideways across the front: left for the next card, right for the one before.
      async swipe(way = 'left', sel = '.card3d--front') {
        const c = await box(sel);
        const y = c.y + c.h * 0.4, a = c.x + c.w * 0.85, b = c.x + c.w * 0.15;
        await f.drag({ x: way === 'left' ? a : b, y }, { x: way === 'left' ? b : a, y });
      },
      lit: () => page.evaluate(() => [...document.querySelectorAll('.hbtn.is-on')].map(b => b.dataset.heading)),
      stage: () => page.evaluate(() => document.querySelector('.stage').firstElementChild?.className),
      back: () => page.evaluate(() => document.querySelector('.cpage--back').textContent),
      // The section marked on the back, and whether it is in view in the back's scroll.
      section: () => page.evaluate(() => {
        const s = document.querySelector('.ff__section.is-lit'), b = document.querySelector('.ff__body');
        if (!s) return null;
        const r = s.getBoundingClientRect(), v = b.getBoundingClientRect();
        return { id: s.dataset.heading, inView: r.top >= v.top - 2 && r.top < v.bottom - 20 };
      }),
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

both('front and back are the same size: side by side in landscape, one page in portrait; the front has nothing to read', async (f, kind) => {
  await f.card('formosan-black-bear');
  assert.equal(await f.layout(), kind);
  const front = await f.box('.card3d--front'), back = await f.box('.card3d--back');
  assert.ok(Math.abs(front.w - back.w) <= 1 && Math.abs(front.h - back.h) <= 1, `the same size: ${JSON.stringify([front, back])}`);
  if (kind === 'side') {
    assert.ok(Math.abs(front.x + front.w - back.x) <= 1 && Math.abs(front.y - back.y) <= 1, 'the back beside the front');
    assert.equal(await f.page.evaluate(() => document.querySelector('.viewer__stage').dataset.face), 'both');
    assert.equal(await f.page.evaluate(() => document.querySelector('.viewer__flip').classList.contains('is-hidden')), true, 'no 🔄');
  } else {
    assert.ok(Math.abs(front.x - back.x) <= 1 && Math.abs(front.y - back.y) <= 1, 'the back where the front is');
    assert.equal(await f.page.evaluate(() => document.querySelector('.viewer__stage').dataset.face), 'front');
  }
  const stage = await f.box('.front__stage'), grid = await f.box('.hgrid');
  assert.ok(stage.y + stage.h <= grid.y, 'stage above the grid');
  assert.ok(stage.w * stage.h > 0.12 * 1280 * 800, `a large stage: ${stage.w} x ${stage.h}`);
  const front_ = await f.page.evaluate(() => {
    const el = document.querySelector('.cpage--front');
    return { words: el.querySelectorAll('.ff__text, .cover__features, .stat__hint, .open__text').length, open: Boolean(document.querySelector('.leaf, .base')) };
  });
  assert.deepEqual(front_, { words: 0, open: false }, 'no text panel, no cover to open');
  const size = await f.page.evaluate(() => [innerWidth, document.documentElement.scrollWidth]);
  assert.equal(size[1], size[0], 'no sideways scroll');
});

both('every heading button is at least 64 px, all eight, in the same place on every card', async f => {
  const seen = [];
  for (const id of ['formosan-black-bear', 'bengal-tiger', 'atlas-moth']) {
    await f.card(id);
    const grid = await f.page.evaluate(() => [...document.querySelectorAll('.hbtn')].map(b => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.heading, x: Math.round(r.x), y: Math.round(r.y), w: r.width, h: r.height, c: getComputedStyle(b).backgroundColor, grey: b.hasAttribute('aria-disabled') };
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
  for (const g of seen) assert.deepEqual(g.map(b => b.c), colour, 'the same colours, every one lit');
  assert.ok(seen.flat().every(b => !b.grey), 'nothing greyed out');
});

both('a heading lights up without a sound, switches the stage and finds its section on the back', async (f, kind) => {
  await f.card('formosan-black-bear');
  assert.deepEqual(await f.lit(), []);
  assert.match(await f.stage(), /stage-pic/, 'the gallery first');
  await f.forget();
  await f.tap('.hbtn[data-heading="status"]');
  assert.deepEqual(await f.lit(), ['status']);
  assert.match(await f.stage(), /stage-status/);
  if (kind === 'side') {
    await f.wait(700); // it glides there
    assert.deepEqual(await f.section(), { id: 'status', inView: true }, 'the back shows its section');
  } else {
    // On one page the back has it ready: 🔄 turns over to it, and back.
    await f.page.click('.viewer__bar .viewer__flip');
    await f.faces('back');
    assert.deepEqual(await f.section(), { id: 'status', inView: true });
    assert.match(await f.back(), /Red List/);
    await f.page.click('.viewer__bar .viewer__flip');
    await f.faces('front');
  }
  // Again: back to the gallery, in both, and the card stays on the side it shows.
  await f.tap('.hbtn[data-heading="status"]');
  assert.deepEqual(await f.lit(), []);
  assert.match(await f.stage(), /stage-pic/, 'back to the gallery');
  assert.equal(await f.section(), null);
  assert.equal(await f.page.evaluate(() => document.querySelector('.viewer__stage').dataset.face), kind === 'side' ? 'both' : 'front');
  await f.wait(150);
  assert.deepEqual(await f.said(), [], 'nothing was said');
});

both('the photo and the illustration: two dots at the bottom centre, only on cards with both, and one credits button', async f => {
  await f.card('formosan-black-bear'); // photo and illustration
  const dots = () => f.page.evaluate(() => [...document.querySelectorAll('.stage .stage-pic__dot')].map(d => [d.dataset.kind, d.getAttribute('aria-checked')]));
  assert.deepEqual(await dots(), [['photo', 'true'], ['illustration', 'false']]);
  const at = await f.page.evaluate(() => {
    const st = document.querySelector('.stage').getBoundingClientRect(), g = document.querySelector('.stage-pic__dots').getBoundingClientRect();
    const d = document.querySelector('.stage-pic__dot').getBoundingClientRect();
    return { centre: Math.abs((g.left + g.right) / 2 - (st.left + st.right) / 2), bottom: st.bottom - g.bottom, tap: Math.min(d.width, d.height) };
  });
  assert.ok(at.centre <= 2 && at.bottom <= 2, `at the bottom centre: ${JSON.stringify(at)}`);
  assert.ok(at.tap >= 43, `a whole tap target: ${at.tap}`);
  await f.tap('.stage-pic__dot[data-kind="illustration"]');
  assert.deepEqual(await dots(), [['photo', 'false'], ['illustration', 'true']]);
  assert.match(await f.page.evaluate(() => document.querySelector('.stage-pic .pic').getAttribute('src')), /illustration/);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.stage .cover__credit').length), 1, 'one credits button');
  assert.match(await f.page.evaluate(() => location.hash), /formosan-black-bear$/, 'a tap on a dot changes no card');
  await f.page.evaluate(() => { location.hash = '#/binder'; });
  await f.wait(700);
  await f.card('formosan-rock-macaque'); // a photo only
  assert.deepEqual(await dots(), []);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.stage .cover__credit').length), 1);
});

const readButton = '.viewer__bar .btn--read';

run('🔊 says the card\'s name and nothing else, at the profile\'s speed', async f => {
  await f.card('formosan-black-bear');
  await f.forget();
  await f.tap(readButton);
  await f.wait(150);
  let u = await f.page.evaluate(() => window.said.filter(Boolean));
  assert.deepEqual(u.map(x => x.text), ['Formosan Black Bear']);
  assert.equal(u[0].lang, 'en-GB');
  assert.ok(Math.abs(u[0].rate - 0.95) < 1e-6);
  await f.tap('.hbtn[data-heading="habitat"]');
  await f.forget();
  await f.page.evaluate(() => speechSynthesis.cancel());
  await f.tap(readButton);
  await f.wait(150);
  if ((await f.said()).length === 0) { await f.tap(readButton); await f.wait(150); } // the first tap only stopped it
  u = await f.page.evaluate(() => window.said.filter(Boolean));
  assert.deepEqual(u.map(x => x.text), ['Formosan Black Bear'], 'still only the name, with a heading lit');
});

run('in both languages 🔊 says the name in English, then Chinese', async f => {
  await f.page.evaluate(async () => (await import('/js/i18n.js')).setMode('both'));
  await f.card('formosan-black-bear');
  await f.forget();
  await f.tap(readButton);
  await f.wait(150);
  assert.deepEqual(await f.page.evaluate(() => window.said.filter(Boolean).map(u => [u.lang, u.text])), [['en-GB', 'Formosan Black Bear'], ['zh-TW', '臺灣黑熊']]);
});

run('a heading plays its recording if the card has one, in the language, and nothing if it hasn\'t', async f => {
  await f.page.evaluate(async () => {
    const { state } = await import('/js/store.js');
    state.byId.get('formosan-black-bear').narration = { habitat: { en: 'audio/narration/bear-habitat-en.m4a', zh: 'audio/narration/bear-habitat-zh.m4a' } };
    window.played = [];
    window.Audio = class { constructor(src) { this.src = src; window.played.push(src); } addEventListener() {} pause() {} play() { return Promise.resolve(); } };
  });
  await f.card('formosan-black-bear');
  await f.forget();
  await f.tap('.hbtn[data-heading="behaviour"]');
  assert.deepEqual(await f.page.evaluate(() => window.played), [], 'no file: nothing plays');
  await f.tap('.hbtn[data-heading="habitat"]');
  assert.deepEqual(await f.page.evaluate(() => window.played), ['audio/narration/bear-habitat-en.m4a']);
  assert.deepEqual(await f.said(), []);
});

both('a swipe sideways changes card, either way; with no card that way it springs back', async f => {
  await f.card('formosan-black-bear'); // the first mammal
  const order = await f.page.evaluate(async () => {
    const s = await import('/js/store.js');
    return s.cardsIn('mammals').filter(s.isVisible).map(c => c.id);
  });
  assert.equal(order[0], 'formosan-black-bear');
  await f.swipe('right');
  await f.rests();
  assert.match(await f.page.evaluate(() => location.hash), /formosan-black-bear$/, 'nothing before the first: it stays');
  await f.swipe('left');
  await f.page.waitForFunction(id => location.hash.endsWith(id), order[1], { timeout: 3000 });
  await f.rests();
  await f.swipe('right');
  await f.page.waitForFunction(id => location.hash.endsWith(id), order[0], { timeout: 3000 });
});

both('a heading with nothing of its own is lit and shows its emoji; a swipe that starts on it still moves the card', async f => {
  await f.card('atlas-moth'); // the only invertebrate: no card either side, so it springs back
  assert.equal(await f.page.evaluate(() => document.querySelector('.hbtn[data-heading="status"]').hasAttribute('aria-disabled')), false);
  await f.forget();
  await f.tap('.hbtn[data-heading="status"]');
  assert.deepEqual(await f.lit(), ['status']);
  assert.deepEqual(await f.said(), [], 'silent, like every heading');
  assert.deepEqual(await f.page.evaluate(() => [document.querySelector('.stage').firstElementChild.className, document.querySelector('.stage .stage-emoji')?.textContent]),
    ['stage-pic stage-placeholder', '❤️'], 'its own emoji, big on the paper');
  const b = await f.box('.hbtn[data-heading="status"]');
  const y = b.y + b.h / 2, x = b.x + b.w / 2;
  const before = (await f.box('.card3d--front')).x;
  await f.send('touchStart', [{ x, y, id: 1 }]);
  for (let i = 1; i <= 8; i++) { await f.send('touchMove', [{ x: x - 25 * i, y, id: 1 }]); await f.wait(16); }
  const during = (await f.box('.card3d--front')).x;
  await f.send('touchEnd', []);
  await f.rests();
  assert.ok(during < before - 20, `it follows the finger (a little, with nowhere to go): ${before} → ${during}`);
  assert.ok(Math.abs((await f.box('.card3d--front')).x - before) <= 1, 'and springs back');
  assert.match(await f.page.evaluate(() => location.hash), /atlas-moth$/);
});

both('the water bear has partners of its own, each on one scale with it', async f => {
  await f.card('tardigrade-water-bear');
  await f.tap('.hbtn[data-heading="size"]');
  await f.wait(800);
  const who = await f.page.evaluate(() => [...document.querySelectorAll('.stage-cmp__who [data-value]')].map(b => b.dataset.value));
  assert.deepEqual(who, ['sand', 'hair', 'salt']);
  assert.match(await f.page.evaluate(() => document.querySelector('.cmp-len').textContent), /0\.5 mm/);
  const pics = await f.page.evaluate(() => [...document.querySelectorAll('.cmp-len__img')].map(i => i.getBoundingClientRect().width));
  assert.ok(Math.abs(pics[0] / pics[1] - 2) < 0.1, `one scale: ${pics}`);
  await f.tap('.stage-cmp__who [data-value="hair"]');
  await f.wait(800);
  assert.match(await f.page.evaluate(() => document.querySelector('.cmp-len').textContent), /0\.07 mm/);
  await f.tap('.stage-cmp__who [data-value="salt"]');
  await f.wait(800);
  assert.match(await f.page.evaluate(() => document.querySelector('.cmp-len').textContent), /0\.3 mm/);
});

run('the caption gives the card\'s statistic, not the size of the picture', async f => {
  await f.card('bengal-tiger');
  await f.tap('.hbtn[data-heading="size"]');
  await f.wait(800);
  const text = await f.page.evaluate(() => document.querySelector('.cmp-len').textContent);
  assert.match(text, /164–211 cm/);
  assert.doesNotMatch(text, /225/);
});

both('the cherry is drawn as a tree, with its own partners', async f => {
  await f.card('taiwan-cherry');
  await f.tap('.hbtn[data-heading="size"]');
  await f.wait(800);
  const who = await f.page.evaluate(() => [...document.querySelectorAll('.stage-cmp__who [data-value]')].map(b => b.dataset.value));
  assert.deepEqual(who, ['you', 'adult', 'car']);
  const tree = await f.page.evaluate(() => { const i = [...document.querySelectorAll('.cmp-len__img')].find(x => x.src.endsWith('cherry-tree.svg')); return i && i.getBoundingClientRect().height; });
  const adult = await f.page.evaluate(() => { const i = [...document.querySelectorAll('.cmp-len__img')].find(x => x.src.endsWith('grown-up.svg')); return i && i.getBoundingClientRect().height; });
  assert.ok(Math.abs(tree / adult - 550 / 170) < 0.15, `one scale: ${tree} and ${adult}`);
  await f.page.evaluate(async () => (await import('/js/i18n.js')).setMode('zh'));
  assert.match(await f.back(), /樹高/);
});

both('Size: the comparison fills the stage, the partners swap, and nothing to tap and count', async f => {
  await f.card('formosan-black-bear');
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
  // Only the modes and the partners are buttons: the scene itself is to look at.
  assert.ok(await f.page.evaluate(() => [...document.querySelectorAll('.stage button')].every(b => b.closest('.cmp-toggle'))), 'no buttons but the modes and the partners');
  const body = await f.box('.stage-cmp__body'), stage = await f.box('.stage'), top = await f.box('.stage-cmp__top');
  assert.ok(Math.abs(body.y + body.h - (stage.y + stage.h)) < 2, 'the scene runs to the bottom of the stage');
  assert.ok(body.y >= top.y + top.h - 1, 'under the buttons');
});

both('Size, weight: the scales and the "× n" line, with exactly n on the pan', async f => {
  await f.card('formosan-rock-macaque');
  await f.tap('.hbtn[data-heading="size"]');
  await f.wait(500);
  await f.tap('.stage .cmp-toggle [data-value="weight"]');
  await f.tap('.stage-cmp__who [data-value="adult"]');
  await f.wait(2500);
  const got = await f.page.evaluate(() => {
    const cap = document.querySelector('.stage .cmp__caption').innerText;
    const pan = document.querySelector('.cmp-wt__pan:has(.cmp-wt__count)');
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('.stage-cmp__who, .stage-cmp__top')].map(e => e.getBoundingClientRect());
    const icons = [...pan.querySelectorAll('.cmp-wt__stack > *')].map(e => e.getBoundingClientRect());
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    return {
      n: Number(/×\s*(\d+)/.exec(cap)?.[1]),
      shown: icons.filter(r => r.top >= stage.top - 1 && r.bottom <= stage.bottom + 1).length,
      covers: icons.some(r => buttons.some(b => hit(r, b))),
    };
  });
  assert.ok(got.n > 1, `a "× n" line: ${got.n}`);
  assert.equal(got.shown, got.n, 'as many on the pan as it says');
  assert.equal(got.covers, false, 'the stack stays off the buttons');
});

run('with their height on the profile, the child comes first, at their own height', async f => {
  await f.card('formosan-black-bear');
  await f.tap('.hbtn[data-heading="size"]');
  await f.wait(800);
  assert.equal(await f.page.evaluate(() => document.querySelector('.stage-cmp__who [aria-checked="true"]').dataset.value), 'you');
  assert.equal(await f.page.evaluate(() => document.querySelector('.cmp-len__img').getAttribute('src')), 'assets/child.svg');
  assert.match(await f.page.evaluate(() => document.querySelector('.cmp-len').textContent), /75 cm/);
}, LANDSCAPE, { heightCm: 75, weightKg: 12 });

both('Where: a range map fills the stage, and with no range the continent lights up', async f => {
  const fills = async () => {
    const stage = await f.box('.stage'), map = await f.box('.stage .map');
    assert.ok(Math.abs(map.w - stage.w) < 2 && Math.abs(map.h - stage.h) < 2, 'as big as the stage');
  };
  await f.card('bengal-tiger');
  await f.tap('.hbtn[data-heading="where"]');
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.stage .map__continent').length), 1);
  await fills();
  await f.page.evaluate(() => { location.hash = '#/binder'; });
  await f.wait(700);
  await f.card('formosan-black-bear');
  await f.tap('.hbtn[data-heading="where"]');
  await f.page.waitForSelector('.stage .map__range', { state: 'attached' });
  assert.ok(await f.box('.stage .map-open'), 'it opens the globe');
  await fills();
});

run('back from the globe: the same heading is lit, its section on the back, and quiet', async f => {
  await f.card('formosan-black-bear');
  await f.tap('.hbtn[data-heading="where"]');
  await f.rests();
  await f.page.waitForSelector('.stage .map-open');
  await f.tap('.stage .map-open');
  await f.page.waitForFunction(() => location.hash.startsWith('#/globe/'));
  await f.wait(500);
  await f.forget();
  await f.page.evaluate(() => history.back());
  await f.page.waitForFunction(() => location.hash.startsWith('#/card/') && document.querySelector('.card3d'));
  await f.rests();
  assert.deepEqual(await f.lit(), ['where']);
  assert.match(await f.stage(), /stage-map/);
  assert.equal((await f.section())?.id, 'where');
  assert.deepEqual(await f.said(), []);
});

run('back from the globe on one page: the back comes back too', async f => {
  await f.card('formosan-black-bear');
  await f.page.click('.viewer__bar .viewer__flip');
  await f.faces('back');
  await f.page.waitForSelector('.cpage--back .map-open');
  await f.tap('.cpage--back .map-open');
  await f.page.waitForFunction(() => location.hash.startsWith('#/globe/'));
  await f.wait(500);
  await f.page.evaluate(() => history.back());
  await f.page.waitForFunction(() => location.hash.startsWith('#/card/') && document.querySelector('.card3d'));
  await f.faces('back');
}, PORTRAIT);

run('Babies: its own photo of the young (nothing to tap); its placeholder where there is none; the back shows the section', async f => {
  for (const [id, own] of [['taiwan-blue-magpie', true], ['leopard-cat', true], ['formosan-black-bear', false]]) {
    await f.card(id);
    await f.tap('.hbtn[data-heading="babies"]');
    await f.rests();
    assert.deepEqual(await f.lit(), ['babies'], id);
    const pic = await f.page.evaluate(() => ({ cls: document.querySelector('.stage').firstElementChild.className, src: document.querySelector('.stage .pic')?.getAttribute('src') }));
    if (own) {
      assert.match(pic.cls, /stage-babies/, id);
      assert.match(pic.src, /-babies-/, `${id}: the photo of its young`);
    } else {
      assert.match(pic.cls, /stage-placeholder/, `${id}: its placeholder`);
      assert.equal(await f.page.evaluate(() => document.querySelector('.stage .stage-emoji')?.textContent), '🥚', id);
    }
    assert.equal((await f.section())?.id, 'babies', id);
    assert.equal(await f.page.evaluate(() => document.querySelectorAll('.stage button:not(.cover__credit):not(.stage-pic__dot)').length), 0, `${id}: nothing to tap`);
    await f.page.evaluate(() => { location.hash = '#/binder'; });
    await f.wait(700);
  }
});

run('Behaviour: its own photo (nothing to tap); the Profile where a card has one; its placeholder where there is neither', async f => {
  for (const [id, want] of [['lion', 'photo'], ['formosan-black-bear', 'profile'], ['atlas-moth', 'placeholder']]) {
    await f.card(id);
    await f.tap('.hbtn[data-heading="behaviour"]');
    await f.rests();
    assert.deepEqual(await f.lit(), ['behaviour'], id);
    const got = await f.page.evaluate(() => ({ cls: document.querySelector('.stage').firstElementChild.className, src: document.querySelector('.stage .pic')?.getAttribute('src') }));
    if (want === 'photo') {
      assert.match(got.cls, /stage-behaviour/, id);
      assert.match(got.src, /-behaviour-/, id);
      assert.equal(await f.page.evaluate(() => document.querySelectorAll('.stage button:not(.cover__credit)').length), 0, `${id}: nothing to tap`);
    } else if (want === 'profile') {
      assert.match(got.cls, /stage-profile/, `${id}: the Profile magnifier stays`);
    } else {
      assert.match(got.cls, /stage-placeholder/, `${id}: its placeholder`);
      assert.equal(await f.page.evaluate(() => document.querySelector('.stage .stage-emoji')?.textContent), '🐾', id);
    }
    assert.equal((await f.section())?.id, 'behaviour', id);
    await f.page.evaluate(() => { location.hash = '#/binder'; });
    await f.wait(700);
  }
});

both('topic cards: their own set, in the same grid, with their facts on the back', async f => {
  await f.card('kenting-coral-reefs');
  const grid = await f.page.evaluate(() => [...document.querySelectorAll('.hbtn')].map(b => [b.dataset.heading, !b.hasAttribute('aria-disabled')]));
  assert.deepEqual(grid.map(g => g[0]), ['what', 'how', 'who', 'when', 'wow', 'where', 'help', 'dyk']);
  assert.ok(grid.every(g => g[1]), 'every tile lit');
  const ids = await f.page.evaluate(() => [...document.querySelectorAll('.ff__section')].map(x => x.dataset.heading));
  assert.deepEqual(ids, ['what', 'when', 'where']);
  assert.match(await f.back(), /full moon/);
  await f.tap('.hbtn[data-heading="where"]');
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.stage .map__spot').length), 1, 'a pin on the place');
  // A heading with no fact and no view of its own: its emoji on the stage; the back has no section
  // for it, so nothing is marked and it doesn't scroll.
  const top = await f.page.evaluate(() => document.querySelector('.ff__body').scrollTop);
  await f.tap('.hbtn[data-heading="how"]');
  await f.wait(400);
  assert.deepEqual(await f.lit(), ['how']);
  assert.equal(await f.page.evaluate(() => document.querySelector('.stage .stage-emoji')?.textContent), '⚙️');
  assert.equal(await f.section(), null, 'no section to mark');
  assert.equal(await f.page.evaluate(() => document.querySelector('.ff__body').scrollTop), top, 'the back stays where it was');
});

run('beside the expanded notebook the card is one page, in the room that is left', async f => {
  await f.card('formosan-black-bear');
  assert.equal(await f.layout(), 'side');
  await f.tap('.nbdock__spine');
  await f.wait(500);
  assert.equal(await f.layout(), 'stacked');
  const front = await f.box('.card3d--front'), panel = await f.box('.nbdock__panel');
  assert.ok(front.x + front.w <= panel.x, 'clear of the notebook');
  const tile = await f.box('.hbtn');
  assert.ok(tile.w >= 64 && tile.h >= 64);
});

run('one page: a swipe up turns it over to the back, the same size and place; down turns it back, and down again over the other way', async f => {
  await f.card('formosan-black-bear');
  const front = await f.box('.card3d--front');
  await f.vertical('.front__stage', 'up');
  await f.faces('back');
  const back = await f.box('.card3d--back');
  assert.ok(Math.abs(back.x - front.x) <= 1 && Math.abs(back.y - front.y) <= 1 && Math.abs(back.w - front.w) <= 1 && Math.abs(back.h - front.h) <= 1, `the front's size and place: ${JSON.stringify([front, back])}`);
  assert.deepEqual(await f.page.evaluate(() => [document.querySelector('.card-pos').inert, getComputedStyle(document.querySelector('.card-pos')).opacity]), [true, '0'], 'the front is out of reach');
  await f.vertical('.ff__body', 'down');
  await f.faces('front');
  await f.vertical('.front__stage', 'down');
  await f.faces('back');
  assert.ok(await f.page.evaluate(() => document.querySelector('.viewer')), 'still the card: down no longer goes to the binder');
}, PORTRAIT);

run('one page: the back scrolls first, then up again turns it on round to the front', async f => {
  await f.card('formosan-black-bear');
  await f.vertical('.front__stage', 'up');
  await f.faces('back');
  const scrolls = await f.page.evaluate(() => { const b = document.querySelector('.ff__body'); return b.scrollHeight > b.clientHeight; });
  assert.ok(scrolls, 'the bear has more than fits');
  await f.vertical('.ff__body', 'up');
  await f.faces('back');
  assert.ok(await f.page.evaluate(() => document.querySelector('.ff__body').scrollTop) > 0, 'it scrolled, and stayed on the back');
  await f.page.evaluate(() => { const b = document.querySelector('.ff__body'); b.scrollTop = b.scrollHeight; });
  await f.vertical('.ff__body', 'up');
  await f.faces('front');
}, PORTRAIT);

run('side by side, an up or down swipe turns nothing: both faces stay', async f => {
  await f.card('formosan-black-bear');
  await f.vertical('.front__stage', 'up');
  await f.faces('both');
  await f.vertical('.front__stage', 'down');
  await f.faces('both');
  assert.ok(await f.page.evaluate(() => document.querySelector('.viewer')), 'still the card');
});

run('the back: everything to read, the grid\'s headings in its order, with statistics and the map, in the explorer\'s language', async f => {
  await f.card('formosan-black-bear');
  await f.page.click('.viewer__bar button[aria-label="翻面"]');
  await f.faces('back');
  const got = await f.page.evaluate(async () => {
    const { backSections } = await import('/js/headings.js');
    const { state } = await import('/js/store.js');
    const card = state.byId.get('formosan-black-bear');
    const back = document.querySelector('.cpage--back');
    return {
      ids: [...back.querySelectorAll('.ff__section:not(.ff__vitals)')].map(x => x.dataset.heading),
      want: backSections(card, { related: (card.related ?? []).length }).map(x => x.id),
      first: [...back.querySelector('.ff__body').children].map(e => e.className.split(' ')[0]).slice(0, 5),
      pictures: [...back.querySelectorAll('img, svg, canvas')].filter(e => !e.closest('.ff__where')).length,
      map: Boolean(back.querySelector('.ff__where .map')),
      badges: [...back.querySelectorAll('.ff__where .badge')].length,
      stats: back.querySelectorAll('.ff__vitals .stat').length,
      marks: [...back.querySelectorAll('.ff__mark')].map(m => getComputedStyle(m).backgroundColor),
      head: back.querySelector('.cover__top').textContent,
      english: /Habitat|forests|Least Concern/.test(back.innerText), // (IUCN is in the Chinese too)
      speech: window.said.filter(Boolean).length,
    };
  });
  assert.deepEqual(got.ids, got.want);
  assert.deepEqual(got.first, ['ff__cardname', 'ff__sci', 'ff__vitals', 'ff__where', 'ff__section'], 'title, Latin name, vital statistics, where in the world, then the headings');
  assert.equal(got.pictures, 0, 'no pictures but the map');
  assert.equal(got.map, true);
  assert.equal(got.badges, 2, 'its status and Found in Taiwan');
  assert.ok(got.stats >= 2, 'length and weight at least');
  assert.equal(new Set(got.marks).size, got.marks.length, 'each heading its own colour');
  assert.match(got.head, /S1/);
  assert.equal(got.english, false, 'Chinese only');
  assert.equal(got.speech, 0, 'silent');
}, PORTRAIT, { lang: 'zh' });

// The hand: where it is and whether it is showing.
const hand = f => f.page.evaluate(() => {
  const el = document.querySelector('.viewer__hand');
  if (el.hidden) return null;
  const r = el.getBoundingClientRect(), p = document.querySelector('.front__stage').getBoundingClientRect();
  const size = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hand-size'));
  const dy = parseFloat(el.style.getPropertyValue('--hand-y'));
  return {
    x: r.left, y: r.top,
    inside: r.left - size / 2 >= p.left - 1 && r.left + size / 2 <= p.right + 1 && r.top - dy - size / 2 >= p.top - 1 && r.top + dy + size / 2 <= p.bottom + 1,
    lowRight: r.left > p.left + p.width * 0.6 && r.top > p.top + p.height * 0.5,
    small: size <= 56,
  };
});
const shown = f => f.page.waitForFunction(() => !document.querySelector('.viewer__hand').hidden, null, { timeout: 4000 });
const hidden = f => f.page.evaluate(() => document.querySelector('.viewer__hand').hidden);

run('the hand shows as a card opens, small in the stage\'s bottom corner, and never comes back on a heading tap', async f => {
  await f.card('formosan-black-bear');
  await shown(f);
  const h = await hand(f);
  assert.deepEqual([h.inside, h.lowRight, h.small], [true, true, true], 'small, on the stage, off its middle');
  // It never takes a tap: what is under it gets it.
  const under = await f.page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.viewer__hand')), [h.x, h.y]);
  assert.equal(under, false, 'taps go through it');
  await f.tap('.hbtn[data-heading="habitat"]');
  assert.equal(await hidden(f), true, 'a heading tap ends it');
  await f.tap('.hbtn[data-heading="food"]');
  await f.wait(1500);
  assert.equal(await hidden(f), true, 'and it stays gone');
  // Once a session: the next card opened shows none.
  await f.page.evaluate(() => { location.hash = '#/binder'; });
  await f.wait(600);
  await f.card('formosan-rock-macaque');
  await f.wait(1500);
  assert.equal(await hidden(f), true, 'not twice in a session');
}, PORTRAIT);

run('the hand plays its swipe a couple of times and is gone', async f => {
  await f.card('formosan-black-bear');
  await shown(f);
  await f.page.waitForFunction(() => document.querySelector('.viewer__hand').hidden, null, { timeout: 9000 });
}, PORTRAIT);

run('once the explorer has turned a card over, the hand never shows again', async f => {
  await f.card('formosan-black-bear');
  await shown(f);
  await f.vertical('.front__stage', 'up');
  await f.faces('back');
  assert.equal(await hidden(f), true, 'anything that moves the card ends it');
  assert.equal(await f.page.evaluate(() => Object.entries(localStorage).find(([k]) => k.startsWith('we-flipped-'))?.[1]), '1');
  // A new session: still none.
  await f.page.evaluate(() => { sessionStorage.clear(); location.hash = '#/binder'; });
  await f.wait(600);
  await f.card('formosan-rock-macaque');
  await f.wait(1500);
  assert.equal(await hidden(f), true);
}, PORTRAIT);

run('side by side there is no hand', async f => {
  await f.card('formosan-black-bear');
  await f.wait(1500);
  assert.equal(await f.page.evaluate(() => document.querySelector('.viewer__hand').hidden), true);
});

run('with reduced motion the card still comes to rest, sharp, turned over and back', async f => {
  await f.card('formosan-black-bear');
  await f.wait(300); // no zoom to wait through: give the page a moment before the first touch
  await f.tap('.hbtn[data-heading="habitat"]');
  assert.deepEqual(await f.lit(), ['habitat']);
  await f.vertical('.front__stage', 'up');
  await f.faces('back');
  // Habitat's section is in view: from the back's top, down turns it back.
  await f.page.evaluate(() => { document.querySelector('.ff__body').scrollTop = 0; });
  await f.vertical('.ff__body', 'down');
  await f.faces('front');
  const b = await f.box('.hbtn[data-heading="size"]');
  const y = b.y + b.h / 2;
  await f.drag({ x: b.x + b.w / 2, y }, { x: b.x + b.w / 2 - 400, y });
  await f.page.waitForFunction(() => location.hash.endsWith('formosan-rock-macaque'), null, { timeout: 3000 });
  await f.rests();
}, PORTRAIT, undefined, 'reduce');
