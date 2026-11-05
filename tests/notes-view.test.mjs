// The notebook's view: open pages, fitting, zoom limits and what a gesture means (js/notes-view.js).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotsFor, fitScale, clampView, pinchView, settleView, swipeTurn, secondFingerCounts, isTap, pixelRatio, MAX_ZOOM,
} from '../js/notes-view.js';

const ids = ['a', 'b', 'c', 'd', 'e'];

test('a spread pairs pages in list order, whichever of the two is asked for', () => {
  assert.deepEqual(slotsFor(ids, 0, true), { start: 0, at: 0, slots: ['a', 'b'] });
  assert.deepEqual(slotsFor(ids, 1, true), { start: 0, at: 1, slots: ['a', 'b'] });
  assert.deepEqual(slotsFor(ids, 3, true), { start: 2, at: 1, slots: ['c', 'd'] });
});

test('an odd page out has a blank slot beside it; no pages at all is two blanks', () => {
  assert.deepEqual(slotsFor(ids, 4, true), { start: 4, at: 0, slots: ['e', null] });
  assert.deepEqual(slotsFor([], 0, true), { start: 0, at: 0, slots: [null, null] });
});

test('one page at a time shows just that page, and rotating keeps it open', () => {
  assert.deepEqual(slotsFor(ids, 3, false), { start: 3, at: 0, slots: ['d'] });
  const { start, at } = slotsFor(ids, 3, true);
  assert.equal(start + at, 3);
  assert.deepEqual(slotsFor([], 0, false).slots, [null]);
});

test('a position past the end comes back to the last page', () => {
  assert.equal(slotsFor(ids, 9, false).start, 4);
  assert.deepEqual(slotsFor(ids, 9, true).slots, ['e', null]);
});

const page = { pageW: 1000, pageH: 1400 };

test('the page fills the height when width allows, in both layouts', () => {
  assert.equal(fitScale({ w: 1152, h: 800, pages: 2, ...page }), 800 / 1400);
  assert.equal(fitScale({ w: 800, h: 1100, ...page }), 1100 / 1400);
  assert.equal(fitScale({ w: 360, h: 612, ...page }), 360 / 1000); // a phone: the width decides
});

test('beside a card the page takes the width and may run taller', () => {
  assert.equal(fitScale({ w: 632, h: 300, pad: 16, byWidth: true, ...page }), 0.6);
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

const swipe = { dx: -200, dy: 10, peak: 0.01, zoom: 1 };

test('a clear sideways two-finger swipe turns the page', () => {
  assert.equal(swipeTurn(swipe), 1);
  assert.equal(swipeTurn({ ...swipe, dx: 200 }), -1);
});

test('a pinch never turns the page, however far it drifts sideways', () => {
  assert.equal(swipeTurn({ ...swipe, peak: 0.05 }), 0);
  assert.equal(swipeTurn({ ...swipe, peak: 0.3 }), 0);
  assert.equal(swipeTurn({ ...swipe, dx: -600, dy: 0, peak: 0.06 }), 0);
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
  assert.equal(swipeTurn({ ...swipe, dx: -79 }), 0);
  assert.equal(swipeTurn({ ...swipe, dx: -200, dy: 100 }), 0);
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
