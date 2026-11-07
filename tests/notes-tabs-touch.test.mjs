// Field Notes under real touches: the index tabs, and tags coming off. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-tabs-touch.test.mjs
import assert from 'node:assert/strict';
import { LANDSCAPE, label, open, run, rail, PHONE_SIDE, at, tagged, seen, tabs, tabLabels, PORTRAIT, PHONE_UP } from './fixtures/notes-browser.mjs';

run('removing a tag: the page stays open, the tabs carry on through the list it was in, and a note says where it went', async f => {
  const [id] = await rail.collect(f, 1);
  const pages = await tagged(f, id, 4);
  await f.show(pages[1], { start: { view: 'pages', scope: { kind: 'animal', id }, pageId: pages[1] } });
  assert.equal(await f.where(), pages[1]);
  await f.page.click('.nb-tag__x');
  await f.wait(100);
  assert.equal(await f.where(), pages[1], 'it stays open');
  assert.match(await f.page.evaluate(() => document.querySelector('.nb__toast').textContent), /Free pages/);
  await f.page.click('.nb__nav--next');
  await f.wait(800);
  assert.equal(await f.where(), pages[2], 'on to its old neighbour');
  await f.page.click('.nb__nav--prev');
  await f.wait(800);
  assert.equal(await f.where(), pages[0], 'and past its old place');
  assert.equal(await f.page.evaluate(i => t.notes.loadPage(i).then(p => p.tags.length), pages[1]), 0, 'a free page now');
});

run('undoing the tag\'s removal puts the page back in its place', async f => {
  const [id] = await rail.collect(f, 1);
  const pages = await tagged(f, id, 3);
  await f.show(pages[1], { start: { view: 'pages', scope: { kind: 'animal', id }, pageId: pages[1] } });
  await f.page.click('.nb-tag__x');
  await f.wait(100);
  await f.page.click('.nb-undo');
  await f.wait(100);
  await f.page.click('.nb__nav--next');
  await f.wait(800);
  assert.equal(await f.where(), pages[2]);
  await f.page.click('.nb__nav--prev');
  await f.wait(800);
  assert.equal(await f.where(), pages[1]);
});

run('the tabs: Contents, each animal in its group\'s colour, free pages; the one for the place sits forward', async f => {
  const ids = await rail.collect(f, 3);
  const first = await tagged(f, ids[0], 2);
  await tagged(f, ids[1], 1);
  await f.seed([[]]);
  await f.show(first[0], { start: { view: 'pages', scope: { kind: 'animal', id: ids[0] }, pageId: first[0] } });
  assert.deepEqual(await tabs(f), ['contents', ids[0], ids[1], 'free']);
  const tab = id => f.page.evaluate(i => { const b = document.querySelector(`.nb-tab[data-tab="${i}"]`), r = b.getBoundingClientRect(); const note = getComputedStyle(b, '::before'); return { current: b.getAttribute('aria-current'), short: parseFloat(note.right), w: r.width, h: r.height, label: b.getAttribute('aria-label'), bg: note.backgroundColor }; }, id);
  const on = await tab(ids[0]), off = await tab(ids[1]);
  assert.equal(on.current, 'true');
  assert.equal(off.current, null);
  assert.ok(on.short < off.short, 'further out');
  assert.equal(on.w, off.w, 'with the same zone to tap');
  assert.equal(on.bg, await f.page.evaluate(() => { const d = document.createElement('i'); d.setAttribute('data-group', 'mammals'); d.style.color = 'var(--g)'; document.body.append(d); const c = getComputedStyle(d).color; d.remove(); return c; }), 'the group\'s colour');
  assert.match(on.label, /[A-Z]/);
  await f.page.click(`.nb-tab[data-tab="${ids[1]}"]`);
  await f.wait(800);
  assert.equal(await f.page.evaluate(() => t.where().scope.id), ids[1]);
  assert.equal((await tab(ids[1])).current, 'true');
});

run('more tabs than fit: the nearest ones, and "more" opens the contents', async f => {
  const ids = await rail.collect(f, 30);
  assert.ok(ids.length > 16);
  const all = [];
  for (const id of ids) all.push((await tagged(f, id, 1))[0]);
  const at = Math.floor(ids.length / 2);
  await f.show(all[at], { start: { view: 'pages', scope: { kind: 'animal', id: ids[at] }, pageId: all[at] } });
  const shown = await tabs(f);
  assert.equal(shown[0], 'contents');
  assert.equal(shown.at(-1), 'more');
  assert.ok(shown.length < ids.length);
  assert.ok(shown.includes(ids[at]));
  const low = await f.page.evaluate(() => { const nav = document.querySelector('.nb__nav--next').getBoundingClientRect(), last = [...document.querySelectorAll('.nb-tab')].at(-1).getBoundingClientRect(); return last.bottom <= nav.top + 1; });
  assert.ok(low, 'clear of the turn buttons');
  await f.page.click('.nb-tab[data-tab="more"]');
  await f.wait(800);
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.view), 'contents');
});

for (const [name, viewport, fits] of [['a tablet', LANDSCAPE, 'full'], ['a tablet in portrait', PORTRAIT, 'narrow'], ['a phone', PHONE_SIDE, 'stub'], ['a phone in portrait', PHONE_UP, 'narrow']]) {
  run(`${name}: tabs fit by the room measured (${fits}), each 44 px to tap, and none lies wider than a tab over the page`, async f => {
    const [id] = await rail.collect(f, 1);
    const pages = await tagged(f, id, 2);
    await f.show(pages[0], { start: { view: 'pages', scope: { kind: 'animal', id }, pageId: pages[0] } });
    assert.equal(await f.page.evaluate(() => document.querySelector('.nb').dataset.tabs), fits);
    const page = await f.box('.nb__sheet');
    const boxes = await f.page.evaluate(() => [...document.querySelectorAll('.nb-tab')].map(b => { const r = b.getBoundingClientRect(); return { x: r.x, w: r.width, h: r.height, right: r.right }; }));
    for (const b of boxes) {
      assert.ok(b.w >= 44 && b.h >= 44, JSON.stringify(b));
      assert.ok(b.right <= viewport.width + 1, 'on the screen');
      assert.ok(page.x + page.w - b.x <= (fits === 'stub' ? 44 : 1), `${page.x + page.w - b.x} px over the page`);
    }
    if (fits !== 'stub') return;
    assert.equal(await f.page.evaluate(() => document.querySelector('.nb-tab .nb-tab__initial').textContent), 'C', 'an initial');
    assert.equal(await seen(f, '.nb-tab .nb-tab__name'), false, 'its label only on press');
  }, viewport);
}

for (const [name, viewport] of [['a tablet', LANDSCAPE], ['a tablet in portrait', PORTRAIT]]) {
  run(`${name}: every animal's tab label reads across with nothing clipped, in each language setting`, async f => {
    const [a] = await f.seed([[], []]);
    await f.show(a);
    await f.page.evaluate(() => document.fonts.load('12px "WildFile Notes"'));
    for (const mode of ['en', 'zh', 'both']) {
      for (const l of await tabLabels(f, mode)) {
        assert.equal(l.clipped, false, `${mode}: ${l.id}: ${l.text}`);
        assert.equal(l.across, true);
      }
    }
    const en = await tabLabels(f, 'en');
    const bear = en.find(l => l.id === 'formosan-black-bear');
    assert.equal(bear.short, false, 'a name that fits stays whole');
    assert.match(bear.text, /Formosan.*Black.*Bear/);
    const squirrel = en.find(l => l.id === 'red-and-white-giant-flying-squirrel');
    assert.ok(squirrel?.short, 'the longest falls back');
    assert.match(squirrel.text, /^\S+ Squirrel$/, 'to the emoji and its last word, which names the animal');
  }, viewport);
}

run('tabs showing together that would read the same use the last two words; a bracket is no part of a word', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await f.page.evaluate(() => document.fonts.load('12px "WildFile Notes"'));
  const read = names => f.page.evaluate(async list => {
    const i18n = await import('/js/i18n.js'), tabs = await import('/js/notes-tabs.js');
    const box = document.querySelector('.nb-tabs'), was = [...box.children];
    i18n.setMode('en');
    const entries = list.map((en, i) => ({ id: `t${i}`, group: 'mammals', emoji: en.includes('Sun') ? '🌱' : '🐘', name: { en, zh: '' } }));
    const made = entries.map(e => tabs.tabButton(e, { text: e.name.en, current: false, onclick: () => {} }));
    box.replaceChildren(...made);
    tabs.fitLabels(made, entries);
    const out = made.map(t => t.querySelector('.nb-tab__name').innerText.trim());
    box.replaceChildren(...was);
    return out;
  }, names);
  const long = 'An Animal With A Very Long Name Indeed And At Last';
  assert.deepEqual(await read([`${long} Black Bear`, `${long} Sun Bear`, `${long} Macaque`]), ['🐘 Black Bear', '🌱 Sun Bear', '🐘 Macaque'], 'the same words, whatever the emoji');
  assert.deepEqual(await read([`${long} (Water Bear)`]), ['🐘 Bear']);
});
