// Field Notes under real touches: the panel beside a card. The harness: tests/fixtures/notes-browser.mjs.
// Run: npm run test:browser -- tests/notes-panel-touch.test.mjs
import assert from 'node:assert/strict';
import { label, open, zoomOf, run, rail, at, panel, fulled, tabs } from './fixtures/notes-browser.mjs';

run('in the panel a photo goes straight on the page and stays selected, so it can be placed', async f => {
  const [a] = await f.seed([[], []]);
  await panel(f, a);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await f.page.setInputFiles('input[accept="image/*"]', { name: 'p.png', mimeType: 'image/png', buffer: png });
  await f.page.waitForSelector('.nb-sel');
  const b = await f.box('.nb-sel'), c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  await f.wait(500);
  await f.drag(c, { x: c.x + 60, y: c.y + 40 });
  const [photo] = await f.items(a);
  assert.equal(photo.t, 'p');
  assert.ok(photo.x > 580, String(photo.x));
}, { width: 640, height: 700 });

run('beside a card the notebook stays a panel with its bar and toolbar, and two fingers pan the page', async f => {
  const [a] = await f.seed([[], []]);
  await f.page.evaluate(() => { document.body.className = ''; document.getElementById('main').dataset.view = 'binder'; document.getElementById('main').style.height = '500px'; document.getElementById('main').style.padding = '0'; });
  await f.page.evaluate(i => { t.open(i, { beside: true, lead: document.createElement('span') }); }, a);
  await f.page.waitForFunction(() => document.querySelector('.nb__sheet canvas').width > 1);
  await f.wait(1600); // past the nudge
  assert.ok(await f.box('.nb__bar'));
  assert.ok(await f.box('.nb__tools'));
  assert.equal(await f.box('.nb-tabs'), undefined);
  const y0 = (await f.box('.nb__sheet')).y;
  await f.two([{ x: 300, y: 350 }, { x: 500, y: 350 }], [{ x: 300, y: 200 }, { x: 500, y: 200 }]);
  assert.ok((await f.box('.nb__sheet')).y < y0 - 100);
  assert.equal((await f.items(a)).length, 0);
});

run('the panel beside a card uses the settings the roll and tray set: colours, thickness and ink', async f => {
  const [a] = await f.seed([[], []]);
  await f.show(a);
  await rail.pick(f, 'pencil');
  await f.page.click('.nb-roll__colours [data-colour="white"]');
  await f.page.evaluate(() => { const i = document.querySelector('.nb-slider'); i.value = 3; i.dispatchEvent(new Event('input', { bubbles: true })); });
  await f.page.click('.nb-rack--ink');
  await f.page.click('.nb-pop--rail [data-colour="green"]');
  await f.wait(100);
  await f.page.evaluate(() => { window.book.destroy(); document.body.className = ''; document.getElementById('main').dataset.view = 'binder'; document.getElementById('main').style.height = '700px'; document.getElementById('main').style.padding = '0'; });
  await f.page.evaluate(i => { t.open(i, { beside: true, lead: document.createElement('span') }); }, a);
  await f.page.waitForFunction(() => document.querySelector('.nb__sheet canvas').width > 1);
  await f.wait(1600);
  assert.equal(await f.box('.nb-roll'), undefined, 'the panel keeps its own toolbar');
  const pressed = () => f.page.evaluate(() => [...document.querySelectorAll('.nb__tools [data-colour][aria-pressed="true"]')].map(b => b.dataset.colour)[0]);
  assert.equal(await pressed(), 'white');
  assert.ok(await f.page.evaluate(() => Boolean(document.querySelector('.nb__tools .nb-size--thick'))));
  await f.page.click('.nb__tools [data-tool="text"]');
  assert.equal(await pressed(), 'green');
  await f.page.click('.nb__tools [data-tool="pencil"]');
  await f.page.click('.nb__tools .nb-tool--colour');
  await f.page.click('.nb-pop [data-colour="red"]');
  await f.wait(100);
  assert.equal(await f.page.evaluate(() => t.state.profile.notesTools.pencil.colour), 'red', 'and back the other way');
}, { width: 1000, height: 800 });

run('the panel\'s open book button is 44 px, labelled, in its top corner, and opens the full notebook', async f => {
  const [a] = await f.seed([[], []]);
  await panel(f, a);
  const b = await f.box('.nb__full'), bar = await f.box('.nb__bar');
  assert.ok(b.w >= 44 && b.h >= 44);
  assert.ok(b.x + b.w >= bar.x + bar.w - 12 && b.y < bar.y + 12, 'in the corner of the bar');
  await f.page.setViewportSize({ width: 400, height: 700 });
  await f.page.evaluate(() => { document.getElementById('main').style.width = '400px'; });
  await f.wait(200);
  const narrow = await f.box('.nb__full'), wrapped = await f.box('.nb__bar');
  assert.ok(wrapped.h > 60 && narrow.y < wrapped.y + 12 && narrow.x + narrow.w >= wrapped.x + wrapped.w - 12, 'and when the bar wraps');
  const clear = await f.page.evaluate(() => { const r = document.querySelector('.nb__full').getBoundingClientRect(); return [...document.querySelectorAll('.nb__pages > *')].every(e => { const b = e.getBoundingClientRect(); return b.right <= r.left || b.top >= r.bottom || !b.width; }); });
  assert.ok(clear, 'over nothing');
  assert.equal(await f.page.evaluate(() => document.querySelector('.nb__full').getAttribute('aria-label')), 'Open the full notebook');
  await f.page.click('.nb__full');
  await f.page.waitForFunction(() => document.querySelector('.nb-grow'));
  assert.equal(await fulled(f), 0, 'it grows first');
  await f.wait(350);
  assert.equal(await fulled(f), 1);
  await f.wait(400);
  assert.equal(await f.box('.nb-grow'), undefined, 'and leaves nothing behind');
}, { width: 640, height: 700 });

run('a pinch past 1.3× on the panel opens the full notebook, saving first; a shorter one goes back', async f => {
  const [a] = await f.seed([[], []]);
  await panel(f, a);
  await f.two([{ x: 270, y: 400 }, { x: 370, y: 400 }], [{ x: 260, y: 400 }, { x: 380, y: 400 }]); // ×1.2
  assert.equal(await fulled(f), 0);
  assert.equal(zoomOf(await f.transform()), 1, 'back to the fitted page');
  await f.drag({ x: 200, y: 300 }, { x: 300, y: 300 }); // something to save
  await f.send('touchStart', [{ x: 270, y: 400, id: 1 }, { x: 370, y: 400, id: 2 }]);
  for (let i = 1; i <= 8; i++) { await f.send('touchMove', [{ x: 270 - i * 5, y: 400, id: 1 }, { x: 370 + i * 5, y: 400, id: 2 }]); await f.wait(16); }
  await f.wait(500);
  assert.equal(await fulled(f), 1, 'crossing it is enough, before the fingers lift');
  await f.send('touchEnd', []);
  await f.wait(100);
  assert.equal(await fulled(f), 1, 'once');
  assert.equal((await f.items(a)).length, 1);
}, { width: 640, height: 700 });

run('with reduced motion the full notebook opens at once, with nothing growing', async f => {
  await f.page.emulateMedia({ reducedMotion: 'reduce' });
  const [a] = await f.seed([[], []]);
  await panel(f, a);
  await f.page.click('.nb__full');
  await f.wait(60);
  assert.equal(await fulled(f), 1);
  assert.equal(await f.box('.nb-grow'), undefined);
}, { width: 640, height: 700 });

run('a pinch on a selected item in the panel resizes it and opens nothing; no onFull, no button', async f => {
  const [a] = await f.seed([[{ t: 'p', id: 'missing', x: 500, y: 500, w: 500, h: 500, r: 0 }], []]);
  await panel(f, a);
  await f.page.click('.nb__tools [data-tool="stamp"]');
  await f.page.keyboard.press('Escape');
  await f.page.evaluate(() => document.querySelector('.nb-pick').close());
  const s = await f.box('.nb__sheet'), c = { x: s.x + s.w / 2, y: s.y + (500 * s.h) / 1400 };
  await f.tap(c);
  await f.two([{ x: c.x - 40, y: c.y }, { x: c.x + 40, y: c.y }], [{ x: c.x - 80, y: c.y }, { x: c.x + 80, y: c.y }]);
  assert.equal(await fulled(f), 0);
  assert.ok((await f.items(a))[0].w > 800);
  await f.page.evaluate(i => { t.open(i, { beside: true, lead: document.createElement('span') }); }, a);
  await f.wait(300);
  assert.equal(await f.box('.nb__full'), undefined);
}, { width: 640, height: 700 });
