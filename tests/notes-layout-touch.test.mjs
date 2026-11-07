// Field Notes under real touches: how the notebook lies on the screen: the page, the roll, the tray, the tool in hand, the font. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-layout-touch.test.mjs
import assert from 'node:assert/strict';
import { LANDSCAPE, label, open, tweezers, run, inHand, rail, PHONE_SIDE, at, panel, PORTRAIT, PHONE_UP } from './fixtures/notes-browser.mjs';

run('landscape: one page as tall as the desk\'s margins allow, with no app header and no toolbar above it', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const sheets = await f.page.evaluate(() => [...document.querySelectorAll('.nb__sheet')].map(s => { const r = s.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }));
  assert.deepEqual(sheets, [[348, 40, 585, 732]]);
  assert.equal(await f.box('.nb__bar'), undefined);
  assert.ok(await f.box('.nb-tab[data-tab="contents"]'));
  // Capped at 1.5 on a 2x screen.
  const canvas = await f.page.evaluate(() => { const c = document.querySelector('.nb__base'); return c.width / c.getBoundingClientRect().width; });
  assert.ok(Math.abs(canvas - 1.5) < 0.01, String(canvas));
});

run('portrait: the tray above the page, the roll below, and the page in all the room between', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const page = await f.box('.nb__sheet'), tray = await f.box('.nb-tray'), roll = await f.box('.nb-roll'), cover = await f.box('.nb-bk__cover');
  assert.ok(tray.y + tray.h <= cover.y && cover.y + cover.h <= roll.y, 'the book between them');
  assert.ok(Math.abs(page.w / page.h - 0.8) < 0.01, '4:5');
  assert.ok(Math.round(cover.y + cover.h - cover.y) >= Math.round(page.h) + 60 - 1 && page.w > 700, JSON.stringify(page));
}, PORTRAIT);

run('rotating keeps the same page open', async f => {
  const [, b] = await f.seed([[], [], []]);
  await f.show(b);
  assert.equal(await f.where(), b);
  await f.page.setViewportSize(PORTRAIT);
  await f.wait(300);
  assert.equal(await f.where(), b);
  await f.page.setViewportSize(LANDSCAPE);
  await f.wait(300);
  assert.equal(await f.where(), b);
});

for (const [name, viewport, across] of [['a tablet', LANDSCAPE, true], ['a phone', PHONE_SIDE, true], ['a tablet in portrait', PORTRAIT, false], ['a phone in portrait', PHONE_UP, false]]) {
  run(`${name}: ${across ? 'the roll and the tray beside the book' : 'the tray above the book and the roll below'}, nothing cut off, every tap 44 px`, async f => {
    const [a] = await f.seed([[], []]);
    await f.show(a);
    const start = await f.box('.nb__rail--start'), end = await f.box('.nb__rail--end'), cover = await f.box('.nb-bk__cover');
    if (across) assert.ok(start.x + start.w <= cover.x + 1 && cover.x + cover.w <= end.x + 1);
    else assert.ok(end.y + end.h <= cover.y + 1 && cover.y + cover.h <= start.y + 1);
    const inside = (b, r) => b.x >= r.x - 1 && b.y >= r.y - 1 && b.x + b.w <= r.x + r.w + 1 && b.y + b.h <= r.y + r.h + 1;
    const screen = { x: 0, y: 0, w: viewport.width, h: viewport.height };
    assert.ok(inside(await f.box('.nb__back'), screen));
    const roll = await f.box('.nb-roll');
    for (const sel of ['.nb-roll', '.nb__railfoot', '.nb-undo', '.nb__railfoot .nb-input', '.nb-slider', '.nb-roll__colours', '.nb-pt[data-pt="ruler"]', '.nb-pt[data-pt="eraser"]']) assert.ok(inside(await f.box(sel), sel === '.nb-roll' ? start : roll), sel);
    for (const sel of ['.nb__new', '.nb__menu', '.nb-tray', '.nb-rack--ink', '.nb-rack[data-rack="sponge"]', '.nb-rack[data-rack="tweezers"]', '.nb-rack[data-rack="washi"]', '.nb-rack[data-rack="photos"]']) assert.ok(inside(await f.box(sel), end), sel);
    assert.ok(await f.page.evaluate(() => { const r = document.querySelector('.nb-roll'); return r.scrollHeight <= r.clientHeight + 1 && r.scrollWidth <= r.clientWidth + 1; }), 'nothing spills out of the roll');
    const small = await f.page.evaluate(() => [...document.querySelectorAll('.nb__rail button, .nb__rail input, .nb__back, .nb-tab, .nb__nav')].filter(b => b.offsetParent).map(b => { const r = b.getBoundingClientRect(); return [b.className, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => Math.min(w, h) < 44));
    assert.deepEqual(small, []);
    const clash = await f.page.evaluate(() => { const r = e => e.getBoundingClientRect(), back = r(document.querySelector('.nb__back')); return [...document.querySelectorAll('.nb__rail button')].filter(b => { const q = r(b); return q.right > back.left && q.left < back.right && q.bottom > back.top && q.top < back.bottom; }).length; });
    assert.equal(clash, 0, 'back sits on nothing');
  }, viewport);
}

run('undo, redo and pen or finger are wooden tokens on the roll, bigger than a tap; the panel keeps its icons', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const foot = () => f.page.evaluate(() => [...document.querySelectorAll('.nb__railfoot .nb-token')].map(b => { const r = b.getBoundingClientRect(); return { art: Boolean(b.querySelector('svg')), w: r.width, h: r.height, op: getComputedStyle(b).opacity }; }));
  const tokens = await foot();
  assert.equal(tokens.length, 3);
  for (const k of tokens) { assert.ok(k.art); assert.ok(k.w >= 52 && k.h >= 52, JSON.stringify(k)); assert.equal(k.op, '1', 'never faint, even with nothing to undo'); }
  const input = () => f.page.evaluate(() => document.querySelector('.nb__railfoot .nb-input path:last-child').getAttribute('d'));
  const finger = await input();
  await f.page.click('.nb__railfoot .nb-input');
  await f.wait(50);
  assert.notEqual(await input(), finger, 'it shows which');
  await f.page.evaluate(() => { window.book.destroy(); document.body.className = ''; document.getElementById('main').dataset.view = 'binder'; document.getElementById('main').style.height = '700px'; });
  await f.page.evaluate(i => { t.open(i, { beside: true, lead: document.createElement('span') }); }, a);
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb__tools .nb-undo').textContent), '↶');
});

// The loops at the baseline tablet's size and in portrait: what a tap at the middle of each tool's
// loop finds, and how big that is.
for (const [name, viewport] of [['landscape', LANDSCAPE], ['portrait', PORTRAIT]]) {
  run(`${name}: each tool in the roll has its own 44 px to tap`, async f => {
    const [a] = await f.seed([[], []]);
    await f.show(a);
    const zones = await f.page.evaluate(() => [...document.querySelectorAll('.nb-pt')].map(b => {
      const r = b.getBoundingClientRect();
      return { id: b.dataset.pt, w: r.width, h: r.height, hit: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2).closest('.nb-pt')?.dataset.pt };
    }));
    assert.equal(zones.length, 5);
    for (const z of zones) { assert.ok(Math.min(z.w, z.h) >= 44, JSON.stringify(z)); assert.equal(z.hit, z.id); }
  }, viewport);
}

run('the book lies outside the page: the canvas is the size the desk\'s margins leave, with or without it', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const page = await f.box('.nb__sheet'), cover = await f.box('.nb-bk__cover'), spiral = await f.box('.nb-bk__spiral');
  const margins = await f.page.evaluate(() => ['top', 'bottom', 'side'].map(n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--nb-book-${n}`))));
  assert.equal(page.h, 800 - margins[0] - margins[1], 'the whole height but the margins');
  assert.ok(cover.y >= 0 && cover.y + cover.h <= 800, 'the book inside the screen');
  assert.ok(cover.x < page.x && cover.x + cover.w > page.x + page.w && cover.y < page.y && cover.y + cover.h > page.y + page.h, 'and all round the page');
  assert.ok(spiral.y + spiral.h <= page.y + 5, 'the coils above it');
  const blurred = await f.page.evaluate(() => [...document.querySelectorAll('.nb-bk, .nb-bk *, .nb-roll, .nb-tray')].filter(e => { const c = getComputedStyle(e); return c.filter !== 'none' || /px [1-9][0-9]*px [^0]/.test(c.boxShadow) && !/0px [0-9.]+px 0px/.test(c.boxShadow); }).length);
  assert.equal(blurred, 0, 'no filters or soft shadows');
  const desk = await f.page.evaluate(() => getComputedStyle(document.querySelector('.nb')).backgroundImage);
  assert.match(desk, /img\/desk\/wood\.webp/);
});

run('the roll unrolls once when the notebook opens, by transform alone; reduced motion skips it', async f => {
  const [a] = await f.seed([[], []]);
  await f.page.evaluate(i => t.open(i), a);
  await f.page.waitForFunction(() => document.getAnimations().some(x => x.effect.target.matches('.nb-roll')));
  const props = await f.page.evaluate(() => document.getAnimations().filter(x => x.effect.target.closest('.nb-roll')).flatMap(x => x.effect.getKeyframes().flatMap(k => Object.keys(k))).filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)));
  assert.deepEqual([...new Set(props)], ['transform']);
  await f.wait(500);
  await f.page.click('.nb__nav--next');
  await f.wait(60);
  assert.equal(await f.page.evaluate(() => document.getAnimations().filter(x => x.effect.target.matches?.('.nb-roll')).length), 0, 'not again on a turn');
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  await f.page.evaluate(i => t.open(i), a);
  await f.wait(150);
  assert.equal(await f.page.evaluate(() => document.getAnimations().length), 0);
});

for (const [name, viewport, room] of [['a tablet', LANDSCAPE, true], ['a tablet in portrait', PORTRAIT, true], ['a phone', PHONE_SIDE, false], ['a phone in portrait', PHONE_UP, false]]) {
  run(`${name}: the tool in hand ${room ? 'lies on the desk beside the roll' : 'stays raised in its loop'}, by the free space measured`, async f => {
    const [a] = await f.seed([[], []]);
    await f.show(a);
    await rail.pick(f, 'pen');
    await f.wait(350);
    const state = () => f.page.evaluate(() => ({ raised: [...document.querySelectorAll('.nb-pt[data-raised]')].map(b => b.dataset.pt), away: [...document.querySelectorAll('.nb-pt[data-away]')].map(b => b.dataset.pt), desk: document.querySelector('.nb-desktool').hidden ? null : document.querySelector('.nb-desktool').dataset.tool }));
    if (!room) { assert.deepEqual(await state(), { raised: ['pen'], away: [], desk: null }); return; }
    assert.deepEqual(await state(), { raised: [], away: ['pen'], desk: 'pen' });
    const tool = await f.box('.nb-desktool'), cover = await f.box('.nb-bk__cover'), roll = await f.box('.nb-roll'), tray = await f.box('.nb-tray');
    const clear = (p, q) => p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y;
    assert.ok(clear(tool, cover) && clear(tool, roll) && clear(tool, tray), JSON.stringify({ tool, cover, roll, tray }));
    assert.ok(tool.x >= 0 && tool.y >= 0 && tool.x + tool.w <= viewport.width && tool.y + tool.h <= viewport.height);
    assert.ok(tool.w >= 44 && tool.h >= 44);
    await f.page.click('.nb-desktool');
    await f.wait(350);
    assert.deepEqual(await state(), { raised: [], away: ['pencil'], desk: 'pencil' }, 'put back: the pencil comes out, and a finger still draws');
    assert.equal(await inHand(f), 'pencil');
    await rail.pick(f, 'highlighter');
    await f.wait(300);
    await rail.pick(f, 'highlighter'); // its empty loop
    await f.wait(300);
    assert.equal(await inHand(f), 'pencil');
    await rail.pick(f, 'pencil');
    await f.wait(300);
    assert.deepEqual(await state(), { raised: ['pencil'], away: [], desk: null }, 'the pencil goes back too, still in the hand');
    await f.drag({ x: viewport.width / 2, y: viewport.height / 2 }, { x: viewport.width / 2 + 40, y: viewport.height / 2 + 20 });
    assert.equal((await f.items(a)).length, 1, 'and still draws');
    await rail.rack(f, 'sponge');
    await f.wait(100);
    assert.equal((await state()).desk, null, 'with something from the tray, the desk is clear');
  }, viewport);
}

run('notebook text is in the subset of Andika, with its single-storey a, and the app\'s own font is left alone', async f => {
  const [a] = await f.seed([[label(300, 500)], []]);
  await f.show(a);
  await f.page.evaluate(() => document.fonts.load('40px "WildFile Notes"'));
  assert.ok(await f.page.evaluate(() => document.fonts.check('40px "WildFile Notes"')));
  assert.match(await f.page.evaluate(() => getComputedStyle(document.querySelector('.nb-tab')).fontFamily), /WildFile Notes/);
  assert.doesNotMatch(await f.page.evaluate(() => getComputedStyle(document.body).fontFamily), /WildFile Notes/);
});
