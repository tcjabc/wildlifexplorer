// Field Notes under real touches: stamps, the footprint roller and ABC. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-stamps-touch.test.mjs
import assert from 'node:assert/strict';
import { K, label, open, tweezers, run, rail, at } from './fixtures/notes-browser.mjs';

run('the panda stamp: a tap picks it up on the first animal, more taps stay on it, and stamping links the page', async f => {
  const ids = await rail.collect(f, 3);
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.buzzes(f);
  const label = () => f.page.evaluate(() => document.querySelector('.nb-rack[data-rack="stamp"]').getAttribute('aria-label'));
  await rail.rack(f, 'stamp');
  const first = await label();
  await rail.rack(f, 'stamp');
  await rail.rack(f, 'stamp');
  assert.equal(await label(), first, 'no cycling');
  await f.tap({ x: 450, y: 600 });
  const [item] = await f.items(a);
  assert.equal(item.t, 'm');
  assert.equal(item.card, ids[0]);
  assert.deepEqual((await f.page.evaluate(i => t.notes.loadPage(i), a)).tags, [ids[0]]);
  assert.deepEqual(await f.page.evaluate(() => window.buzz), [15]);
});

run('with no animals collected the panda stamp says how to get some', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.rack(f, 'stamp');
  assert.ok(await f.page.evaluate(() => document.querySelector('.nb-pick').open));
});

run('a stamp from before the rules still draws, and stays on the page', async f => {
  const topic = await f.page.evaluate(() => t.state.cards.find(c => c.group === 'conservation').id);
  const [a] = await f.seed([[{ t: 'm', c: '#444', card: topic, x: 600, y: 900, s: 180, r: 0 }], []]);
  await f.show(a);
  await f.wait(200);
  assert.equal((await f.items(a)).length, 1);
  assert.notDeepEqual(await rail.pixel(f, 600, 900), await rail.pixel(f, 600, 1200));
});

run('the ink pad colours what is stamped, and a tap on a stamp selects it rather than stamping over it', async f => {
  const ids = await rail.collect(f, 1);
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.click('.nb-rack--ink');
  await f.page.click('.nb-pop--rail [data-colour="white"]');
  await f.page.mouse.click(5, 5); // closes it: a tap elsewhere
  await rail.rack(f, 'stamp');
  await f.tap({ x: 450, y: 600 });
  await f.tap({ x: 450, y: 600 });
  const items = await f.items(a);
  assert.equal(items.length, 1);
  assert.equal(items[0].c.toLowerCase(), '#ffffff');
  assert.ok(await f.box('.nb-sel'));
  assert.ok(ids.length);
});

run('the footprint stamp rolls a trail, and the trail can be selected, moved, turned and deleted', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.buzzes(f);
  await rail.rack(f, 'roller');
  await f.drag({ x: 420, y: 500 }, { x: 670, y: 500 }, 12);
  const [trail] = await f.items(a);
  assert.equal(trail.t, 'f');
  assert.deepEqual(await f.page.evaluate(() => window.buzz), [15], 'one thunk for the trail, not one per print');
  await f.tap({ x: 520, y: 500 });
  assert.ok(await f.box('.nb-sel'));
  await f.drag({ x: 520, y: 500 }, { x: 520, y: 560 });
  const [moved] = await f.items(a);
  assert.ok(Math.abs(moved.p[1] - trail.p[1] - 60 / K) < 2);
  assert.equal(moved.p.length, trail.p.length);
  await f.two([{ x: 480, y: 560 }, { x: 560, y: 560 }], [{ x: 480, y: 520 }, { x: 560, y: 600 }]);
  const [turned] = await f.items(a);
  assert.ok(Math.abs(turned.p[1] - turned.p[turned.p.length - 1]) > 50, 'it now runs at an angle');
  assert.deepEqual(Object.keys(turned).sort(), ['c', 'k', 'p', 't']);
  await f.wait(450);
  const del = await f.box('.nb-sel__del');
  await f.tap({ x: del.x + del.w / 2, y: del.y + del.h / 2 });
  assert.equal((await f.items(a)).length, 0);
});

run('the ABC stamp places text in the ink, which can be turned like any stamp', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.buzzes(f);
  await rail.rack(f, 'text');
  await f.tap({ x: 450, y: 500 });
  assert.deepEqual(await f.page.evaluate(() => window.buzz), [15]);
  await f.page.keyboard.type('Otter');
  await f.page.keyboard.press('Enter');
  await f.wait(550);
  await tweezers(f);
  await f.tap({ x: 470, y: 515 });
  assert.ok(await f.box('.nb-sel'));
  assert.equal(await f.box('.nb-text'), undefined, 'tweezers open no keyboard');
  await f.two([{ x: 430, y: 515 }, { x: 510, y: 515 }], [{ x: 430, y: 480 }, { x: 510, y: 550 }]); // one finger lands on ✎: it joins the pinch
  const [text] = await f.items(a);
  assert.equal(text.v, 'Otter');
  assert.ok(text.r > 0.3, String(text.r));
});

run('with the keyboard up, a text box near the bottom rises above it and everything comes back after', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.evaluate(() => {
    const vv = new EventTarget();
    vv.offsetTop = 0; vv.height = innerHeight;
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  });
  const before = await f.box('.nb__sheet');
  await rail.rack(f, 'text');
  await f.tap({ x: 450, y: 740 });
  await f.page.evaluate(() => { visualViewport.height = 420; visualViewport.dispatchEvent(new Event('resize')); });
  const box = await f.box('.nb-text');
  assert.ok(box.y + box.h <= 420, `${box.y + box.h}`);
  assert.ok(box.y > 0);
  assert.equal((await f.box('.nb__sheet')).w, before.w, 'the page keeps its size');
  await f.page.keyboard.type('Low down');
  await f.page.keyboard.press('Enter');
  await f.wait(550);
  assert.deepEqual(await f.box('.nb__sheet'), before);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').style.height), '');
  assert.equal((await f.items(a))[0].v, 'Low down');
});

run('the ink pad and the stamps\' rubber show the ink in use', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  const fills = () => f.page.evaluate(() => [...document.querySelectorAll('.nb-tray .nb-a-ink')].map(e => getComputedStyle(e).fill));
  const tint = id => f.page.evaluate(c => { const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue(`--pencil-${c}`); document.body.append(d); const v = getComputedStyle(d).color; d.remove(); return v; }, id);
  assert.deepEqual([...new Set(await fills())], [await tint('graphite')]);
  await f.page.click('.nb-rack--ink');
  await f.page.click('.nb-pop--rail [data-colour="red"]');
  await f.wait(50);
  const now = await fills(), red = await tint('red');
  assert.equal(now.length, 4, 'the pad and three stamps');
  assert.deepEqual([...new Set(now)], [red]);
});
