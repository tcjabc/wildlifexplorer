// The notebook's view: where the page lies, fitting, zoom limits and what a gesture means (js/notes-view.js).
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atFit, pinchOpensFull, fullPageBox, bookBox, stackDepth } from '../js/notes-view.js';
import {
  fitScale, clampView, pinchView, settleView, swipeTurn, secondFingerCounts, isTap, pixelRatio, MAX_ZOOM, railFit, popPlace, keyboardLift } from '../js/notes-view.js';

const page = { pageW: 1120, pageH: 1400 };
const margins = { top: 40, bottom: 20, side: 12 };

test('the page takes all the room inside the desk\'s margins, in both layouts', () => {
  assert.deepEqual(bookBox({ w: 832, h: 800, ...margins, ...page }), { width: 592, height: 740, left: 120, top: 40 });
  assert.deepEqual(bookBox({ w: 800, h: 986, ...margins, ...page }), { width: 740, height: 926, left: 30, top: 40 });
  const narrow = bookBox({ w: 384, h: 900, ...margins, ...page });
  assert.equal(narrow.width, 360, 'a phone: the width decides');
  assert.equal(narrow.top, Math.round(40 + (840 - narrow.height) / 2), 'and it lies in the middle');
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
  const land = fullPageBox({ w: 1280, h: 800, roll: 224, tray: 224, ...margins, ...page });
  assert.deepEqual(land, { width: 592, height: 740, left: 344, top: 40 });
  const up = fullPageBox({ w: 800, h: 1280, roll: 170, tray: 124, ...margins, ...page });
  assert.deepEqual(up, { width: 740, height: 926, left: 30, top: 164 });
});
