// Card screen layout with the notebook (js/card-layout.js), and the pan / close edge rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, dockMode, reserve, cardLayout, openLayout, clipLeftOf, panelWidth, SPINE, PHONE_MAX, MIN_CARD_BESIDE, PANEL_SHARE, GRID_COLS, GRID_ROOM } from '../js/card-layout.js';

const P = 448, H = 560;
// Stage sizes under the top bar and hint: tablet landscape, tablet portrait, phone.
const SCREENS = { landscape: { vw: 1180, W: 1180, Hs: 660 }, portrait: { vw: 820, W: 820, Hs: 1000 }, phone: { vw: 375, W: 375, Hs: 640 } };
const modeOf = s => dockMode({ vw: s.vw, W: s.W, Hs: s.Hs, P, H });

test('phones get the tab and overlay; tablets the spine and a half-width panel beside the card', () => {
  assert.equal(PANEL_SHARE, 0.5);
  assert.equal(panelWidth(1180), 590);
  assert.equal(dockMode({ vw: PHONE_MAX - 1, W: PHONE_MAX - 1, Hs: 640, P, H }), 'phone');
  assert.equal(modeOf(SCREENS.landscape), 'side');
  assert.equal(modeOf(SCREENS.portrait), 'side');
});

test('landscape is always 50/50, however small the card gets beside the notebook', () => {
  for (const [W, Hs] of [[600, 300], [800, 500], [1024, 640], [1366, 900]]) assert.equal(dockMode({ vw: W, W, Hs, P, H }), 'side', `${W}x${Hs}`);
});

test(`portrait: 50/50 while the closed card stays at least ${MIN_CARD_BESIDE} px wide, otherwise the panel overlays it`, () => {
  for (const vw of [600, 650, 700, 744, 768, 820, 1024]) {
    const Hs = 1100;
    const mode = dockMode({ vw, W: vw, Hs, P, H });
    if (mode === 'side') {
      const { s0, visibleW } = cardLayout({ W: vw, Hs, P, H, mode, expanded: true });
      assert.equal(visibleW, vw / 2, `${vw}px: the card gets the left half`);
      assert.ok(P * s0 >= MIN_CARD_BESIDE, `${vw}px: card ${P * s0}`);
    } else assert.equal(mode, 'overlay', `${vw}px`);
  }
  assert.equal(dockMode({ vw: 700, W: 700, Hs: 1000, P, H }), 'overlay');
  assert.equal(dockMode({ vw: 768, W: 768, Hs: 1000, P, H }), 'side');
});

test('the notebook takes the spine strip when collapsed, half the stage only when expanded beside the card', () => {
  assert.equal(reserve({ mode: 'side', expanded: false, W: 1180 }), SPINE);
  assert.equal(reserve({ mode: 'side', expanded: true, W: 1180 }), 590);
  assert.equal(reserve({ mode: 'side', expanded: true, W: 1000, share: 0.4 }), 400);
  assert.equal(reserve({ mode: 'overlay', expanded: true, W: 700 }), SPINE);
  assert.equal(reserve({ mode: 'phone', expanded: true, W: 375 }), 0);
});

// The stages of the baseline tablet and a phone, under the top bar with the notebook collapsed.
const GPAD = { landscape: { visibleW: 1220, Hs: 716 }, portrait: { visibleW: 740, Hs: 1196 } };

test('the open card: side by side in landscape, stacked in portrait and beside the notebook', () => {
  assert.equal(openLayout({ ...GPAD.landscape, P, H }).kind, 'side');
  assert.equal(openLayout({ ...GPAD.portrait, P, H }).kind, 'stacked');
  assert.equal(openLayout({ visibleW: 640, Hs: 716, P, H }).kind, 'stacked', 'the notebook takes half the landscape stage');
  assert.equal(openLayout({ visibleW: 375, Hs: 640, P, H }).kind, 'stacked');
});

test('the open card stays inside its space, and fills most of the tablet', () => {
  for (const [visibleW, Hs] of [[1220, 716], [740, 1196], [640, 716], [375, 640], [784, 322], [1024, 600]]) {
    const o = openLayout({ visibleW, Hs, P, H });
    assert.ok(o.w * o.s <= visibleW, `${visibleW}x${Hs}: width ${o.w * o.s}`);
    assert.ok(o.h * o.s <= Hs, `${visibleW}x${Hs}: height ${o.h * o.s}`);
  }
  for (const [name, g] of Object.entries(GPAD)) {
    const o = openLayout({ ...g, P, H });
    const share = (o.w * o.s * o.h * o.s) / (1280 * 800);
    assert.ok(share > 0.75, `${name}: ${share}`);
  }
});

test('a heading button is never under 64 px, however short the screen', () => {
  for (const [visibleW, Hs] of [[1220, 716], [740, 1196], [640, 716], [375, 640], [784, 322], [667, 300]]) {
    const o = openLayout({ visibleW, Hs, P, H, tap: 64 });
    const cell = (o.menuW - GRID_ROOM) / GRID_COLS;
    assert.ok(cell * o.s >= 64 - 1e-6, `${visibleW}x${Hs}: ${cell * o.s}`);
  }
});

test('side by side, both pages are the cover\'s size on the tablet', () => {
  const o = openLayout({ ...GPAD.landscape, P, H });
  assert.equal(o.menuW, P);
  assert.equal(o.h, H);
});

test('gesture zones are clipped to the left of the notebook', () => {
  assert.deepEqual(clipLeftOf({ left: 100, right: 900, top: 0, bottom: 10 }, 700), { left: 100, right: 700, top: 0, bottom: 10 });
  assert.deepEqual(clipLeftOf({ left: 100, right: 500, top: 0, bottom: 10 }, 700), { left: 100, right: 500, top: 0, bottom: 10 });
  assert.equal(clipLeftOf(null, 700), null);
});

test('fitScale keeps the card inside the space and a whole number of pixels wide', () => {
  for (const [W, Hs] of [[1120, 660], [420, 1000], [375, 640]]) {
    const s = fitScale(W, Hs, P, H);
    assert.ok(P * s <= W && H * s <= Hs, `${W}x${Hs}`);
    assert.equal(Math.round(P * s), P * s);
  }
});

test('the spine in the CSS is as wide as the strip the layout keeps for it', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
  assert.equal(Number(css.match(/--nb-spine-w:\s*(\d+)px/)?.[1]), SPINE);
});

test('the panel share in the CSS is the one the layout uses', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');
  assert.equal(Number(css.match(/--nb-panel-share:\s*([\d.]+)/)?.[1]), PANEL_SHARE);
});
