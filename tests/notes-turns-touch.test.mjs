// Field Notes under real touches: turning pages and what a visit leaves. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-turns-touch.test.mjs
import assert from 'node:assert/strict';
import { stroke, label, run, rail, STAMP, TRAIL, at, tagged } from './fixtures/notes-browser.mjs';

run('the turn buttons go one page at a time, back past the first page to the contents, and a tab opens the contents', async f => {
  const [a, b] = await f.seed([[], [], [], []]);
  await f.show(a);
  await f.page.click('.nb__nav--next');
  await f.wait(800);
  assert.equal(await f.where(), b);
  await f.page.click('.nb__nav--prev');
  await f.wait(800);
  assert.equal(await f.where(), a);
  await f.page.click('.nb__nav--prev');
  await f.wait(800);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'contents', 'turned back from the first page');
  await f.page.click('.nb-tab[data-tab="free"]');
  await f.wait(800);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'pages');
  await f.page.click('.nb-tab[data-tab="contents"]');
  await f.wait(800);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'contents');
});

run('new page and the menu stay in reach, and the menu has no page to choose between', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.click('.nb__rail--end .nb__new');
  await f.wait(500);
  assert.equal(await f.page.evaluate(() => t.ids().length), 3);
  await f.page.click('.nb__rail--end .nb__menu');
  await f.wait(100);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb-menu').open), true);
  assert.equal(await f.page.evaluate(() => document.querySelectorAll('.nb-menu__sides').length), 0);
});

run('an old page keeps all its data through a visit: only what was added changes', async f => {
  const old = [stroke(100, 300), label(120, 500), { t: 'f', c: '#444', k: 'paw', p: [100, 900, 300, 900] }, { t: 'p', id: 'gone', x: 500, y: 1100, w: 300, h: 200, r: 0.05 }];
  const [a] = await f.seed([old, []]);
  await f.show(a);
  await f.drag({ x: 650, y: 300 }, { x: 750, y: 300 });
  const items = await f.items(a);
  assert.deepEqual(items.slice(0, 4), old);
  assert.equal(items.length, 5);
  const page = await f.page.evaluate(i => t.notes.loadPage(i), a);
  assert.deepEqual(Object.keys(page).sort(), ['createdAt', 'editedAt', 'header', 'h', 'id', 'items', 'paper', 'tags', 'version', 'w'].sort());
});

run('a 5:7 page opens centred on the wider paper and is only rewritten if it changes', async f => {
  const [a] = await f.seed([[]]);
  const old = [stroke(100, 300), label(120, 500), { ...STAMP, x: 300 }, TRAIL, { t: 'p', id: 'gone', x: 500, y: 1100, w: 300, h: 200, r: 0 }];
  await f.page.evaluate(async ([i, items]) => {
    const pid = t.state.profile.id, root = await navigator.storage.getDirectory();
    const dir = await (await (await root.getDirectoryHandle('notes')).getDirectoryHandle(pid)).getDirectoryHandle('pages');
    const page = { ...(await t.notes.loadPage(i)), w: 1000, items };
    const w = await (await dir.getFileHandle(`${i}.json`)).createWritable();
    await w.write(JSON.stringify(page));
    await w.close();
  }, [a, old]);
  const raw = () => f.page.evaluate(async i => { const pid = t.state.profile.id, root = await navigator.storage.getDirectory(); const dir = await (await (await root.getDirectoryHandle('notes')).getDirectoryHandle(pid)).getDirectoryHandle('pages'); return JSON.parse(await (await (await dir.getFileHandle(`${i}.json`)).getFile()).text()); }, a);
  await f.show(a);
  const items = await f.items(a);
  assert.equal(items[0].p[0], 160, 'a line: 60 further in');
  assert.equal(items[0].p[1], 300, 'and no lower');
  assert.equal(items[0].p[3], 260, 'every point of it');
  assert.equal(items[1].x, 180);
  assert.equal(items[2].x, 360);
  assert.deepEqual(items[3].p, [160, 700, 360, 700]);
  assert.equal(items[4].x, 560);
  assert.equal((await raw()).w, 1000, 'on disk it is as it was');
  await f.drag({ x: 650, y: 300 }, { x: 750, y: 300 });
  const saved = await raw();
  assert.equal(saved.w, 1120, 'once it changes it is saved at the new width');
  assert.equal(saved.items[0].p[0], 160, 'moved once, not twice');
  assert.equal((await f.items(a))[0].p[0], 160);
});

run('the stack shows how far through the book the page is: pages to come below, pages turned above', async f => {
  const pages = await f.seed(Array.from({ length: 12 }, () => []));
  await f.show(pages[0]);
  const depth = () => f.page.evaluate(() => { const c = document.querySelector('.nb-bk').style; return [c.getPropertyValue('--nb-before'), c.getPropertyValue('--nb-after')].map(Number); });
  const [b0, a0] = await depth();
  assert.ok(a0 > 0.8 && b0 < a0, 'nearly all still to come');
  await f.show(pages[6]);
  const [b1, a1] = await depth();
  assert.ok(b1 > 0.5 && a1 > 0.3 && a1 < a0, JSON.stringify([b1, a1]));
  const edge = await f.page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { before: r('.nb-bk__before').top, coils: r('.nb-bk__spiral').top, after: r('.nb-bk__after').bottom, page: r('.nb__sheet').bottom }; });
  assert.ok(edge.before < edge.coils - 2, `turned pages show above the coils: ${JSON.stringify(edge)}`);
  assert.ok(edge.after > edge.page + 6, `pages to come show below the page: ${JSON.stringify(edge)}`);
  await f.show(pages[11]);
  const [b2, a2] = await depth();
  assert.equal(b2, 1);
  assert.equal(a2, 0, 'the end of the book');
});

run('a turn is one flip of 0.6 s, by transform and opacity, and leaves nothing behind', async f => {
  const [a] = await f.seed([[], [], []]);
  await f.show(a);
  await f.page.click('.nb__nav--next');
  await f.page.waitForSelector('.nb-leaf');
  const motion = await f.page.evaluate(() => {
    const all = document.getAnimations().filter(x => x.effect.target.closest?.('.nb-leaf-wrap'));
    return {
      props: [...new Set(all.flatMap(x => x.effect.getKeyframes().flatMap(k => Object.keys(k))).filter(k => !['offset', 'computedOffset', 'easing', 'composite'].includes(k)))].sort(),
      ms: all.map(x => x.effect.getComputedTiming().duration), ease: all.map(x => x.effect.getComputedTiming().easing),
      turned: all.find(x => x.effect.target.matches('.nb-leaf')).effect.getKeyframes().some(k => k.opacity !== undefined),
    };
  });
  assert.deepEqual(motion.props, ['opacity', 'transform']);
  assert.deepEqual(motion.ms, [600, 600]);
  assert.ok(motion.ease.includes('cubic-bezier(0.45, 0, 0.55, 1)'));
  assert.equal(motion.turned, false, 'what turns is never what fades, or its front would show from behind');
  await f.wait(800);
  assert.equal(await f.box('.nb-leaf'), undefined);
});

run('with reduced motion a turn is a 0.3 s crossfade, with nothing turning', async f => {
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  const [a] = await f.seed([[], [], []]);
  await f.show(a);
  await f.page.click('.nb__nav--next');
  await f.page.waitForSelector('.nb-leaf');
  const motion = await f.page.evaluate(() => document.getAnimations().filter(x => x.effect.target.closest?.('.nb-bk__turn')).map(x => ({ ms: x.effect.getComputedTiming().duration, keys: x.effect.getKeyframes().flatMap(k => Object.keys(k)) })));
  assert.equal(motion.length, 1);
  assert.equal(motion[0].ms, 300);
  assert.ok(motion[0].keys.includes('opacity') && !motion[0].keys.includes('transform'));
  await f.wait(450);
  assert.equal(await f.box('.nb-leaf'), undefined);
  assert.equal(await f.place(), 2);
});

run('a jump to a distant page is one flip with the target underneath, never through the pages between', async f => {
  const [id, other] = await rail.collect(f, 2);
  const mine = await tagged(f, id, 6), theirs = await tagged(f, other, 2);
  await f.show(mine[5], { start: { view: 'pages', scope: { kind: 'animal', id }, pageId: mine[5] } });
  await f.page.evaluate(() => { window.leaves = 0; new MutationObserver(m => { for (const r of m) window.leaves += [...r.addedNodes].filter(n => n.matches?.('.nb-leaf-wrap')).length; }).observe(document.querySelector('.nb-bk__turn'), { childList: true }); });
  await f.page.click(`.nb-tab[data-tab="${other}"]`);
  await f.wait(150);
  assert.equal(await f.where(), theirs[1], 'the target is there already, under the leaf');
  await f.wait(800);
  assert.equal(await f.page.evaluate(() => window.leaves), 1, 'one leaf');
  await f.page.click('.nb-tab[data-tab="contents"]');
  await f.wait(800);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'contents');
  assert.ok(await f.page.evaluate(() => window.leaves) <= 3, 'one flip: back has a leaf for each page');
});
