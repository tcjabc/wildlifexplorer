// Where the card and the notebook go on the card screen. Plain numbers in and out, so it can
// be tested without a page (tests/card-layout.test.mjs); viewer.js applies it.
//
// The notebook is always there, collapsed or expanded:
//   'side'    – collapsed: a spine in the 60 px strip at the right; expanded: the notebook
//               takes a share of the stage (PANEL_SHARE, half) and the card is centred and
//               scaled in the rest. Always in landscape; in portrait only while the card
//               stays at least MIN_CARD_BESIDE wide
//   'overlay' – portrait, where the card would be narrower than that: the same spine, but
//               expanded the panel covers the card
//   'phone'   – collapsed: a small tab at the bottom-right (in the hint row); expanded: a
//               full overlay
// The open spread is always shown at card scale (both pages as big as the closed card, so the
// text stays readable). When it is wider than the space it pans sideways (see panDrag).

export const SPINE = 60;            // px: the strip at the right for the collapsed notebook
export const PHONE_MAX = 600;       // px: narrower screens are phones
export const MIN_CARD_BESIDE = 340; // px: the smallest closed card beside the expanded panel
export const EDGE = { threshold: 24, resist: 0.35 }; // dragging past a pan edge
export const PANEL_SHARE = 0.5;     // the expanded notebook's share of the stage width (--nb-panel-share)
export const FILL = 0.97;           // the share of its space the card fills: a thin strip of desk round it

// The expanded panel's width on a stage W px wide.
export const panelWidth = (W, share = PANEL_SHARE) => W * share;

// The card's scale for a space, rounded so its width is a whole number of pixels.
export function fitScale(W, Hs, P, H) {
  const s = Math.max(0.05, Math.min((W * FILL) / P, (Hs * FILL) / H));
  return Math.floor(P * s) / P;
}

// vw: the window's width (phones); W × Hs: the stage under the top bar (landscape when wider).
export function dockMode({ vw, W, Hs, P, H, share = PANEL_SHARE }) {
  if (vw < PHONE_MAX) return 'phone';
  if (W >= Hs) return 'side';
  return P * fitScale(W - panelWidth(W, share), Hs, P, H) >= MIN_CARD_BESIDE ? 'side' : 'overlay';
}

// How much of the stage's right side the notebook takes from the card.
export function reserve({ mode, expanded, W, share = PANEL_SHARE }) {
  if (mode === 'phone') return 0;              // the tab sits in the hint row
  if (mode === 'side' && expanded) return panelWidth(W, share);
  return SPINE;                                // the spine; an overlay panel covers the card
}

// The card screen: the closed card's scale (s0), the open spread's (s1, never changed by the
// notebook, so opening or closing the notebook never zooms the spread) and the visible width.
// Expanded beside the card, the open spread pans in the visible half, under the notebook.
export function cardLayout({ W, Hs, P, H, mode, expanded, share = PANEL_SHARE }) {
  const visibleW = Math.max(1, W - reserve({ mode, expanded, W, share }));
  const s0 = fitScale(visibleW, Hs, P, H);
  const s1 = fitScale(Math.max(1, W - reserve({ mode, expanded: false, W, share })), Hs, P, H);
  return { visibleW, s0, s1 };
}

// Where the open spread's left edge may be. Fits: centred in the visible width. Too wide:
// from showing its left edge (max = 0) to showing its right edge at the visible right (min).
export function spreadRange({ visibleW, P, s }) {
  const w = 2 * P * s;
  if (w <= visibleW) { const left = (visibleW - w) / 2; return { fits: true, min: left, max: left, width: w }; }
  return { fits: false, min: visibleW - w, max: 0, width: w };
}

// A sideways drag on an open spread that doesn't fit. It pans; at the left edge (spread moved
// right as far as it goes), dragging on past the edge (beyond a small threshold, with rubber-
// band resistance) starts closing the card: close is 0–1 of a page turn. Past the other edge
// it only stretches a little.
//   start: the spread's left when the drag began; dx: px dragged; travel: px for a full turn
export function panDrag({ start, dx, min, max, travel }) {
  const want = start + dx;
  const t = Math.max(1, travel);
  if (want > max) {
    const over = want - max;
    return { left: max + Math.min(over, EDGE.threshold) * EDGE.resist, close: Math.min(1, Math.max(0, over - EDGE.threshold) / t) };
  }
  if (want < min) return { left: min - Math.min(min - want, EDGE.threshold) * EDGE.resist, close: 0 };
  return { left: want, close: 0 };
}

// Keep a box (screen px) left of the notebook.
export const clipLeftOf = (box, x) => (box ? { ...box, right: Math.min(box.right, x) } : box);
