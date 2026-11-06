// The notebook's view: where the page lies, fitting, zoom limits and what a gesture means (js/notes-view.js).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atFit, pinchOpensFull, fullPageBox, bookBox, stackDepth, tabFit, tabsShown, paginate, deskSpot } from '../js/notes-view.js';
import {
  fitScale, clampView, pinchView, settleView, swipeTurn, secondFingerCounts, isTap, pixelRatio, MAX_ZOOM, railFit, popPlace, keyboardLift } from '../js/notes-view.js';

const page = { pageW: 1120, pageH: 1400 };
const margins = { top: 40, bottom: 28, side: 12 };

test('the page takes all the room inside the desk\'s margins, in both layouts', () => {
  assert.deepEqual(bookBox({ w: 784, h: 800, ...margins, ...page }), { width: 585, height: 732, left: 100, top: 40 });
  assert.deepEqual(bookBox({ w: 800, h: 974, ...margins, ...page }), { width: 724, height: 906, left: 38, top: 40 });
  const narrow = bookBox({ w: 384, h: 900, ...margins, ...page });
  assert.equal(narrow.width, 360, 'a phone: the width decides');
  assert.equal(narrow.top, Math.round(40 + (832 - narrow.height) / 2), 'and it lies in the middle');
});

test('the page moves left to leave the tabs their room, as far as its margin allows', () => {
  assert.equal(bookBox({ w: 800, h: 974, ...margins, ...page, right: 64 }).left, 16, 'all it can, with a gap at the edge');
  assert.equal(bookBox({ w: 800, h: 974, ...margins, ...page, right: 44 }).left, 32);
  const kept = bookBox({ w: 800, h: 974, ...margins, ...page, right: 64, keep: 76 });
  assert.deepEqual([kept.width, kept.height, kept.left], [708, 885, 16], 'room kept costs the page a little');
  assert.equal(800 - kept.left - kept.width, 76);
  assert.equal(bookBox({ w: 784, h: 800, ...margins, ...page, right: 64 }).left, 100, 'with room already, it stays in the middle');
  assert.equal(bookBox({ w: 384, h: 900, ...margins, ...page, right: 64 }).left, 12, 'on a phone there is none to find');
});

test('tabs fit by the room measured', () => {
  assert.equal(tabFit(99), 'full');
  assert.equal(tabFit(84), 'full');
  assert.equal(tabFit(83), 'narrow');
  assert.equal(tabFit(60), 'narrow');
  assert.equal(tabFit(59), 'stub');
  assert.equal(tabFit(12), 'stub');
});

test('tabs that don\'t all fit: the first, the nearest, and more', () => {
  const entries = ['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h'].map(id => ({ id })), ids = list => list.map(e => e.id);
  assert.deepEqual(tabsShown(entries, 3, 8), entries, 'all of them when they fit');
  assert.deepEqual(ids(tabsShown(entries, 3, 5)), ['c', 'b', 'd', 'e', 'more']);
  assert.deepEqual(ids(tabsShown(entries, 7, 5)), ['c', 'f', 'g', 'h', 'more'], 'near the end');
  assert.deepEqual(ids(tabsShown(entries, 0, 5)), ['c', 'a', 'b', 'd', 'more'], 'on the contents');
  assert.ok(ids(tabsShown(entries, 5, 5)).includes('f'), 'the place is always there');
});

test('rows flow onto pages, and a heading never ends one', () => {
  const r = n => Array.from({ length: n }, (_, i) => ({ i })), h = { head: true };
  assert.deepEqual(paginate(r(5), { perPage: 3 }).map(p => p.length), [3, 2]);
  assert.deepEqual(paginate(r(5), { perPage: 3, first: 1 }).map(p => p.length), [1, 3, 1], 'the title takes room on the first');
  assert.deepEqual(paginate([{}, {}, h, {}], { perPage: 3 }).map(p => p.length), [2, 2]);
  assert.deepEqual(paginate([], { perPage: 3 }), [[]]);
});

const tool = { len: 150, wide: 36 };
test('the tool lies beside the roll where the gap takes it, and under the book where that does', () => {
  const beside = deskSpot({ w: 1280, h: 800, roll: { left: 12, top: 68, right: 236, bottom: 670 }, book: { left: 336, top: 0, right: 945, bottom: 800 }, near: 369, ...tool });
  assert.ok(beside.x > 236 && beside.x < 336 && Math.abs(beside.y - 369) < 1);
  assert.ok(Math.abs(beside.turn) < 0.3, 'standing, at a slight angle');
  const under = deskSpot({ w: 800, h: 1280, roll: { left: 8, top: 1102, right: 620, bottom: 1272 }, book: { left: 20, top: 124, right: 768, bottom: 1098 }, ...tool });
  assert.ok(under.x > 620 && under.y > 1098);
  assert.ok(Math.abs(under.turn - Math.PI / 2) < 0.3, 'lying down');
});

test('with no room for the tool, there is no spot: it stays in the roll', () => {
  assert.equal(deskSpot({ w: 844, h: 390, roll: { left: 8, top: 56, right: 264, bottom: 348 }, book: { left: 272, top: 0, right: 564, bottom: 390 }, ...tool }), null);
  assert.equal(deskSpot({ w: 390, h: 844, roll: { left: 4, top: 634, right: 386, bottom: 836 }, book: { left: 3, top: 120, right: 387, bottom: 630 }, ...tool }), null);
});

test('the stack follows the place in the list, and a short list is a thin book', () => {
  assert.deepEqual(stackDepth(0, 1), { before: 0, after: 0 });
  assert.deepEqual(stackDepth(0, 12), { before: 0, after: 1 });
  assert.deepEqual(stackDepth(11, 12), { before: 1, after: 0 });
  const mid = stackDepth(5, 30);
  assert.ok(mid.after > mid.before);
  assert.ok(Math.abs(mid.before + mid.after - 1) < 1e-9);
  const thin = stackDepth(0, 3);
  assert.equal(thin.after, 0.25);
});

test('beside a card the page takes the width and may run taller', () => {
  assert.equal(fitScale({ w: 704, h: 300, pad: 16, byWidth: true, ...page }), 0.6);
});

const frame = { w: 1000, h: 800 }, book = { w: 800, h: 800 };

test('a book smaller than the frame is centred; a bigger one leaves no gap', () => {
  assert.deepEqual(clampView({ k: 1, x: 500, y: 500 }, frame, book), { k: 1, x: 100, y: 0 });
  assert.deepEqual(clampView({ k: 2, x: 500, y: 500 }, frame, book), { k: 2, x: 0, y: 0 });
  assert.deepEqual(clampView({ k: 2, x: -5000, y: -5000 }, frame, book), { k: 2, x: -600, y: -800 });
});

test('a tall page beside a card pans inside its margin', () => {
  const tall = { w: 600, h: 1000 }, f = { w: 632, h: 500 };
  assert.equal(clampView({ k: 1, x: 0, y: 500 }, f, tall, 16).y, 16);
  assert.equal(clampView({ k: 1, x: 0, y: -5000 }, f, tall, 16).y, -516);
});

test('a pinch keeps what was under the fingers under them', () => {
  const start = clampView({ k: 1, x: 0, y: 0 }, frame, book);
  const mid = { x: 500, y: 400 };
  const v = pinchView(start, mid, mid, 2, frame, book);
  assert.equal(v.k, 2);
  assert.equal((mid.x - v.x) / v.k, (mid.x - start.x) / start.k);
  assert.equal((mid.y - v.y) / v.k, (mid.y - start.y) / start.k);
});

test('zoom stays between the fitted page and the limit', () => {
  const start = { k: 1, x: 100, y: 0 }, mid = { x: 500, y: 400 };
  assert.equal(pinchView(start, mid, mid, 0.2, frame, book).k, 1);
  assert.equal(pinchView(start, mid, mid, 50, frame, book).k, MAX_ZOOM);
});

test('ending almost at the fitted page snaps back to it', () => {
  assert.deepEqual(settleView({ k: 1.04, x: 90, y: -5 }, frame, book), { k: 1, x: 100, y: 0 });
  assert.equal(settleView({ k: 1.5, x: 0, y: 0 }, frame, book).k, 1.5);
});

const swipe = { dx: 10, dy: -200, peak: 0.01, zoom: 1 };

test('in the book a clear two-finger swipe up is the next page, and down the one before', () => {
  assert.equal(swipeTurn(swipe), 1);
  assert.equal(swipeTurn({ ...swipe, dy: 200 }), -1);
  assert.equal(swipeTurn({ ...swipe, dx: -200, dy: 10 }), 0, 'sideways is nothing here');
});

test('in the panel the same swipe goes sideways', () => {
  const side = { ...swipe, dx: -200, dy: 10, axis: 'x' };
  assert.equal(swipeTurn(side), 1);
  assert.equal(swipeTurn({ ...side, dx: 200 }), -1);
  assert.equal(swipeTurn({ ...side, dx: 10, dy: -200 }), 0, 'up and down pans there');
});

test('a pinch never turns the page, however far it drifts', () => {
  assert.equal(swipeTurn({ ...swipe, peak: 0.05 }), 0);
  assert.equal(swipeTurn({ ...swipe, peak: 0.3 }), 0);
  assert.equal(swipeTurn({ ...swipe, dx: 0, dy: -600, peak: 0.06 }), 0);
});

test('close fingers may wander by 12 px; wide ones by 5%', () => {
  assert.equal(swipeTurn({ ...swipe, span: 60, peak: 8 / 60 }), 1, '8 px at 60 apart turns');
  assert.equal(swipeTurn({ ...swipe, span: 60, peak: 11.9 / 60 }), 1);
  assert.equal(swipeTurn({ ...swipe, span: 60, peak: 12 / 60 }), 0, '12 px at 60 apart is a pinch');
  assert.equal(swipeTurn({ ...swipe, span: 240, peak: 11.9 / 240 }), 1, '5% and 12 px meet at 240 px');
  assert.equal(swipeTurn({ ...swipe, span: 240, peak: 12 / 240 }), 0);
  assert.equal(swipeTurn({ ...swipe, span: 400, peak: 19 / 400 }), 1, 'further apart, 5% is the more');
  assert.equal(swipeTurn({ ...swipe, span: 400, peak: 20 / 400 }), 0);
});

test('a short, slanted or zoomed-in swipe does not turn the page', () => {
  assert.equal(swipeTurn({ ...swipe, dy: -79 }), 0);
  assert.equal(swipeTurn({ ...swipe, dx: 100, dy: -200 }), 0);
  assert.equal(swipeTurn({ ...swipe, zoom: 1.5 }), 0);
});

test('a second finger only counts soon after the first', () => {
  assert.equal(secondFingerCounts(120), true);
  assert.equal(secondFingerCounts(200), false);
});

test('a tap stays put and is quick', () => {
  assert.equal(isTap(4, 100), true);
  assert.equal(isTap(10, 100), false);
  assert.equal(isTap(4, 350), false);
});

test('the canvas never goes past 1.5 device pixels per CSS pixel', () => {
  assert.equal(pixelRatio(3), 1.5);
  assert.equal(pixelRatio(1), 1);
  assert.equal(pixelRatio(undefined), 1);
});

test('the rails go by orientation, on a phone too: side rails in landscape, bands in portrait', () => {
  assert.equal(railFit({ w: 1280, h: 800 }), 'tall');
  assert.equal(railFit({ w: 780, h: 360 }), 'short', 'a phone on its side keeps side rails, in two columns');
  assert.equal(railFit({ w: 800, h: 1280 }), 'wide');
  assert.equal(railFit({ w: 360, h: 740 }), 'narrow', 'a phone upright: bands, in two rows');
});

test('popovers open on the page side of their button, and stay on the screen', () => {
  const frame = { w: 800, h: 600 }, anchor = { left: 10, right: 70, top: 100, bottom: 140 };
  assert.deepEqual(popPlace({ anchor, frame, w: 150, h: 200, side: 'right' }), { left: 70, top: 100 });
  assert.deepEqual(popPlace({ anchor: { left: 730, right: 790, top: 500, bottom: 540 }, frame, w: 150, h: 200, side: 'left' }), { left: 580, top: 400 });
  assert.deepEqual(popPlace({ anchor, frame, w: 150, h: 200, side: 'below' }), { left: 10, top: 140 });
  assert.deepEqual(popPlace({ anchor: { left: 700, right: 760, top: 540, bottom: 590 }, frame, w: 150, h: 200, side: 'above' }), { left: 650, top: 340 }, 'up from the bottom band');
});

test('a text box rises just clear of the keyboard, and never out of the top', () => {
  assert.equal(keyboardLift({ box: { top: 100, bottom: 200 }, viewTop: 0, viewBottom: 500 }), 0, 'already clear');
  assert.equal(keyboardLift({ box: { top: 500, bottom: 560 }, viewTop: 0, viewBottom: 400, margin: 16 }), 176);
  assert.equal(keyboardLift({ box: { top: 60, bottom: 500 }, viewTop: 0, viewBottom: 400, margin: 16 }), 44, 'a tall box keeps its top in sight');
  assert.equal(keyboardLift({ box: { top: 10, bottom: 500 }, viewTop: 0, viewBottom: 400, margin: 16 }), 0);
});

test('a pinch opens the full notebook only from the fitted page, and only from 1.3 times', () => {
  assert.equal(pinchOpensFull(1, 1.29), false);
  assert.equal(pinchOpensFull(1, 1.3), true);
  assert.equal(pinchOpensFull(1.05, 2), true, 'as good as fitted');
  assert.equal(pinchOpensFull(1.5, 2), false, 'zoomed in already: it only zooms');
  assert.equal(pinchOpensFull(1, 0.7), false);
  assert.equal(atFit(1), true);
  assert.equal(atFit(1.2), false);
});

test('a page lands on the desk between the roll and the tray, or between the tray and the roll', () => {
  const land = fullPageBox({ w: 1280, h: 800, roll: 248, tray: 248, ...margins, ...page });
  assert.deepEqual(land, { width: 585, height: 732, left: 348, top: 40 });
  const up = fullPageBox({ w: 800, h: 1280, roll: 182, tray: 124, right: 64, ...margins, ...page });
  assert.deepEqual(up, { width: 724, height: 906, left: 16, top: 164 });
});
