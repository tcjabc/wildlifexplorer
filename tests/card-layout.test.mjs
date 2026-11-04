// Card screen layout with the notebook (js/card-layout.js), and the pan / close edge rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitScale, dockMode, reserve, cardLayout, spreadRange, panDrag, clipLeftOf, panelWidth, SPINE, PHONE_MAX, MIN_CARD_BESIDE, PANEL_SHARE, EDGE } from '../js/card-layout.js';
import { releaseOutcome } from '../js/gesture-release.js';

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

test('the open spread keeps card scale: expanding the notebook never zooms it', () => {
  for (const [name, s] of Object.entries(SCREENS)) {
    const mode = modeOf(s);
    const shut = cardLayout({ W: s.W, Hs: s.Hs, P, H, mode, expanded: false });
    const open = cardLayout({ W: s.W, Hs: s.Hs, P, H, mode, expanded: true });
    assert.equal(open.s1, shut.s1, name);
    assert.equal(shut.s1, shut.s0, `${name}: the spread is as big as the closed card`);
    assert.ok(open.s0 <= shut.s0, `${name}: beside the panel the closed card may shrink`);
    if (mode === 'side') {
      // Behind the notebook: it pans in the visible half, so every part can come out.
      const r = spreadRange({ visibleW: open.visibleW, P, s: open.s1 });
      assert.equal(r.fits, false, `${name}: the spread is wider than half the stage`);
      assert.equal(r.min + r.width, open.visibleW, `${name}: the right page's edge can reach the notebook`);
    }
  }
});

test('the spread is centred when it fits, and pans between its own edges when it does not', () => {
  const fits = spreadRange({ visibleW: 1120, P, s: 1 });
  assert.equal(fits.fits, true);
  assert.equal(fits.min, fits.max);
  assert.equal(fits.min, (1120 - 2 * P) / 2);
  const wide = spreadRange({ visibleW: 700, P, s: 1.2 });
  assert.equal(wide.fits, false);
  assert.equal(wide.max, 0, 'left edge at the screen\'s left');
  assert.equal(wide.min, 700 - 2 * P * 1.2, 'right edge at the visible right');
  // Landscape fits with the notebook collapsed; portrait and phones never fit.
  for (const [name, s] of Object.entries(SCREENS)) {
    const l = cardLayout({ W: s.W, Hs: s.Hs, P, H, mode: modeOf(s), expanded: false });
    assert.equal(spreadRange({ visibleW: l.visibleW, P, s: l.s1 }).fits, name === 'landscape', name);
  }
});

test('edge rule: inside the edges a sideways drag only pans', () => {
  const r = { min: -600, max: 0, travel: 400 };
  assert.deepEqual(panDrag({ ...r, start: -300, dx: 100 }), { left: -200, close: 0 });
  assert.deepEqual(panDrag({ ...r, start: -300, dx: -200 }), { left: -500, close: 0 });
});

test('edge rule: at the left edge, dragging on to the right stretches first, then closes', () => {
  const r = { min: -600, max: 0, travel: 400 };
  const small = panDrag({ ...r, start: 0, dx: EDGE.threshold - 4 });
  assert.equal(small.close, 0, 'within the threshold it only stretches');
  assert.ok(small.left > 0 && small.left < EDGE.threshold, 'with resistance');
  const far = panDrag({ ...r, start: -100, dx: 100 + EDGE.threshold + 200 });
  assert.equal(far.close, 200 / 400, 'past the threshold, half a page turn');
  assert.equal(far.left, EDGE.threshold * EDGE.resist, 'the spread stops moving; the page turns');
  assert.equal(panDrag({ ...r, start: 0, dx: 5000 }).close, 1);
});

test('edge rule: past the right edge it only stretches, never closes', () => {
  const r = { min: -600, max: 0, travel: 400 };
  const past = panDrag({ ...r, start: -600, dx: -500 });
  assert.equal(past.close, 0);
  assert.ok(past.left < -600 && past.left >= -600 - EDGE.threshold * EDGE.resist);
});

test('edge rule release: past the threshold far enough (or a flick) closes; otherwise it stays open at the edge', () => {
  const s = (p, panLeft) => ({ p, panLeft, range: { min: -600, max: 0 }, travel: { x: 400, y: 300 }, dir: 1 });
  assert.deepEqual(releaseOutcome('pan', s(0.6, 8), { vx: 50 }), { prop: 'p', target: 0, velocity: -50 / 400 });
  const back = releaseOutcome('pan', s(0.9, 8), { vx: 10 });
  assert.equal(back.prop, 'p'); assert.equal(back.target, 1); assert.equal(back.pan, 0);
  assert.equal(releaseOutcome('pan', s(0.95, 8), { vx: 900 }).target, 0, 'a quick flick closes');
  // Not closing: the spread springs inside its edges.
  assert.deepEqual(releaseOutcome('pan', s(1, -250), { vx: 0 }), { pan: -250, velocity: 0 });
  assert.equal(releaseOutcome('pan', s(1, 8), {}).pan, 0);
  assert.equal(releaseOutcome('pan', s(1, -650), {}).pan, -600);
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
