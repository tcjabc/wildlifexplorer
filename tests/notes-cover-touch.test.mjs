// Field Notes under real touches: the cover and the contents. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-cover-touch.test.mjs
import assert from 'node:assert/strict';
import { LANDSCAPE, label, run, rail, PHONE_SIDE, panel, tagged, seen, closed, tabs, PORTRAIT, PHONE_UP } from './fixtures/notes-browser.mjs';

for (const [name, viewport] of [['a tablet', LANDSCAPE], ['a tablet in portrait', PORTRAIT], ['a phone', PHONE_SIDE], ['a phone in portrait', PHONE_UP]]) {
  run(`${name}: the contents are a page of the book, with the roll and tray put away and the menu in reach`, async f => {
    const pages = await f.seed(Array.from({ length: 24 }, () => []));
    await f.show(pages[0]);
    await rail.pick(f, 'ruler');
    const sheet = await f.box('.nb__sheet');
    await f.page.click('.nb-tab[data-tab="contents"]');
    await f.wait(900);
    const shown = sel => f.page.evaluate(q => { const e = document.querySelector(q); return Boolean(e) && getComputedStyle(e).visibility === 'visible'; }, sel);
    for (const sel of ['.nb-roll', '.nb-tray', '.nb__new', '.nb-ruler:not([hidden])']) assert.equal(await shown(sel), false, sel);
    assert.ok(await shown('.nb__back') && await shown('.nb__menu'), 'back and the menu stay');
    assert.deepEqual(await f.box('.nb__contents'), sheet, 'a page of the book, in the same place');
    assert.equal(await f.box('.nb-toc__thumb'), undefined, 'text only');
    assert.equal(await f.page.evaluate(() => { const c = document.querySelector('.nb__contents'); return c.scrollHeight > c.clientHeight + 1; }), false, 'it all fits its page');
    await f.page.click('.nb-toc__link[data-free]');
    await f.wait(900);
    assert.ok(await shown('.nb-roll'), 'the roll and tray come back with a page');
  }, viewport);
}

run('the book opens closed with its cover in front of the contents, the explorer\'s name on the label', async f => {
  await f.seed([[], []]);
  await closed(f);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.book), 'closed');
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb-cover__name').textContent), 'Test');
  assert.match(await f.page.evaluate(() => document.querySelector('.nb-cover__title').textContent), /Field Notes/);
  const cover = await f.box('.nb-cover'), page = await f.box('.nb__sheet');
  assert.ok(cover.x <= page.x && cover.y <= page.y && cover.x + cover.w >= page.x + page.w && cover.y + cover.h >= page.y + page.h, 'all over the page');
  assert.equal(await seen(f, '.nb-tabs'), false, 'no tabs on a closed book');
  await f.page.click('.nb-cover__tap');
  await f.wait(1000);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'contents');
  assert.equal(await seen(f, '.nb-cover'), false);
  assert.ok(await seen(f, '.nb-toc__title'));
  assert.ok(await seen(f, '.nb-tabs'));
});

run('the cover turns in 0.8 s on the spiral, and what turns is never what fades', async f => {
  await f.seed([[], []]);
  await closed(f);
  await f.page.click('.nb-cover__tap');
  await f.page.waitForFunction(() => document.getAnimations().some(a => a.effect.target.matches('.nb-cover')));
  const m = await f.page.evaluate(() => {
    const all = document.getAnimations(), turning = all.find(a => a.effect.target.matches('.nb-cover')), t = turning.effect.getComputedTiming();
    return { ms: t.duration, ease: t.easing, faded: turning.effect.getKeyframes().some(k => k.opacity !== undefined), hinge: all.some(a => a.effect.target.matches('.nb-bk__hinge')), origin: getComputedStyle(document.querySelector('.nb-cover')).transformOrigin };
  });
  assert.equal(m.ms, 800);
  assert.ok(m.ease.includes('cubic-bezier(0.45, 0, 0.55, 1)'));
  assert.equal(m.faded, false);
  assert.ok(m.hinge);
  assert.match(m.origin, / 0px$/, 'hinged along its top');
});

run('a page under the cover opens with the roll unrolling; Back closes the book before it leaves', async f => {
  const [a] = await f.seed([[], []]);
  await f.page.evaluate(i => { window.left = 0; t.open(null, { cardId: t.state.cards[0].id, start: null, onBack: () => { window.left = document.querySelector('.nb').dataset.book; } }); }, a);
  await f.page.waitForSelector('.nb-cover__tap');
  await f.wait(300);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'pages');
  await f.page.click('.nb-cover__tap');
  await f.page.waitForFunction(() => document.getAnimations().some(x => x.effect.target.matches('.nb-roll')));
  await f.wait(1000);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.book), undefined, 'open');
  await f.page.click('.nb__back');
  await f.wait(400);
  assert.equal(await f.page.evaluate(() => window.left), 0, 'still closing');
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.book), 'closing');
  await f.wait(700);
  assert.equal(await f.page.evaluate(() => window.left), 'closed', 'closed, then gone');
});

run('nothing draws through a closed book', async f => {
  const [a] = await f.seed([[], []]);
  await f.page.evaluate(() => t.open(null, { cardId: t.state.cards[0].id, start: null }));
  await f.page.waitForSelector('.nb-cover__tap');
  await f.wait(300);
  await f.drag({ x: 500, y: 300 }, { x: 650, y: 300 });
  assert.deepEqual((await f.items(a)), []);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.book), 'closed');
});

run('with reduced motion the cover crossfades in 0.3 s, and nothing turns', async f => {
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  await f.seed([[], []]);
  await closed(f);
  await f.page.click('.nb-cover__tap');
  await f.page.waitForFunction(() => document.getAnimations().some(x => x.effect.target.closest?.('.nb-bk__hinge')));
  const m = await f.page.evaluate(() => document.getAnimations().filter(x => x.effect.target.closest?.('.nb-bk__hinge')).map(x => ({ ms: x.effect.getComputedTiming().duration, keys: x.effect.getKeyframes().flatMap(k => Object.keys(k)) })));
  assert.equal(m.length, 1);
  assert.equal(m[0].ms, 300);
  assert.ok(m[0].keys.includes('opacity') && !m[0].keys.includes('transform'));
  await f.wait(450);
  assert.equal(await seen(f, '.nb-cover'), false);
});

run('no cover from the panel, or beside a card', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a); // start: where the panel was
  assert.equal(await f.box('.nb-cover'), undefined);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.book), undefined);
  await panel(f, a);
  assert.equal(await f.box('.nb-cover'), undefined);
}, { width: 640, height: 700 });

run('a long contents flows onto more pages, read-only, turned like any page; animals are links with count and date', async f => {
  const ids = await rail.collect(f, 20);
  for (const id of ids) await tagged(f, id, 1);
  await f.seed([[], []]);
  await f.page.evaluate(() => t.open(null, { start: { view: 'contents' } }));
  await f.page.waitForSelector('.nb-toc__link');
  await f.wait(400);
  const links = () => f.page.evaluate(() => [...document.querySelectorAll('.nb-toc__link')].map(l => l.dataset.card ?? l.dataset.free ?? 'new'));
  const first = await links();
  assert.equal(await f.page.evaluate(() => getComputedStyle(document.querySelector('.nb-toc__title')).fontWeight), '700');
  assert.ok(first.length > 5 && first.length < 20, 'not all on one page');
  assert.match(await f.page.evaluate(() => document.querySelector('.nb-toc__link .nb-toc__meta').textContent), /1 page.*2026/);
  const canvas = await f.page.evaluate(() => document.querySelector('.nb__base').toDataURL());
  await f.drag({ x: 500, y: 300 }, { x: 650, y: 310 });
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb__base').toDataURL()), canvas, 'nothing draws here');
  await f.two([{ x: 500, y: 700 }, { x: 700, y: 700 }], [{ x: 500, y: 400 }, { x: 700, y: 400 }]);
  await f.wait(300);
  const second = await links();
  assert.ok(second.length && second[0] !== first[0], 'the next contents page');
  assert.equal(await f.box('.nb-toc__title'), undefined, 'the heading is on the first');
  for (let i = 0; i < 3 && !(await links()).includes('new'); i++) { await f.page.click('.nb__nav--next'); await f.wait(800); }
  const last = await links();
  assert.equal(last.at(-1), 'new', 'free pages after the animals, then a new one');
  assert.equal(last.filter(l => /-/.test(l) && !ids.includes(l)).length, 2);
  await f.page.click('.nb__nav--next');
  await f.wait(900);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'pages', 'on past the contents to the first section');
});
