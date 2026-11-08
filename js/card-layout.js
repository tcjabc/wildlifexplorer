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
// The card fills the space the notebook leaves: front and back side by side when that space is wide,
// one page that turns over when it isn't (openLayout).

export const SPINE = 60;            // px: the strip at the right for the collapsed notebook
export const PHONE_MAX = 600;       // px: narrower screens are phones
export const MIN_CARD_BESIDE = 340; // px: the smallest closed card beside the expanded panel
export const PANEL_SHARE = 0.5;     // the expanded notebook's share of the stage width (--nb-panel-share)
export const FILL = 0.97;           // the share of its space the card fills: a thin strip of desk round it
export const SIDE_RATIO = 1.15;     // a space wider than tall by this much has the sides next to each other
export const GRID_COLS = 4;         // heading buttons across (js/headings.js has two rows of them)
export const GRID_ROOM = 60;        // the menu page's border, padding and the gaps in its grid, in card px

// The expanded panel's width on a stage W px wide.
export const panelWidth = (W, share = PANEL_SHARE) => W * share;

// A scale rounded so a width of P is a whole number of pixels.
const whole = (s, P) => Math.floor(P * Math.max(0.05, s)) / P;

// The card's scale for a space.
export function fitScale(W, Hs, P, H) {
  return whole(Math.min((W * FILL) / P, (Hs * FILL) / H), P);
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

// The card screen: the closed card's scale and the width left for the card.
export function cardLayout({ W, Hs, P, H, mode, expanded, share = PANEL_SHARE }) {
  const visibleW = Math.max(1, W - reserve({ mode, expanded, W, share }));
  return { visibleW, s0: fitScale(visibleW, Hs, P, H) };
}

// The card in the space left for it. It has two faces of the same size, the front (the stage and the
// heading grid) and the back (the Fact File). The sizes are in card px, before the scale s.
//   'side'    – room for two pages: front and back side by side, always both there. A page is the
//               card's design size, wider on a short screen so the buttons still reach `tap` px.
//   'stacked' – not: one page filling the space, turning over between front and back.
// pageW × h: one page. w: the whole card (two pages, or one).
export function openLayout({ visibleW, Hs, P, H, tap = 64 }) {
  const W = visibleW * FILL, T = Hs * FILL;
  const buttons = GRID_COLS * tap; // the screen px the grid's buttons need, at least
  if (visibleW / Hs >= SIDE_RATIO && W / 2 > buttons) {
    // Two pages wide enough for the buttons must fit across too: 2 (buttons + GRID_ROOM s) <= W.
    const s = whole(Math.min(W / (2 * P), T / H, (W / 2 - buttons) / GRID_ROOM), P);
    const pageW = Math.max(P, buttons / s + GRID_ROOM);
    return { kind: 'side', s, menuW: pageW, pageW, w: 2 * pageW, h: H };
  }
  const s = whole(Math.min(W / P, T / H), P);
  return { kind: 'stacked', s, menuW: W / s, pageW: W / s, w: W / s, h: T / s };
}

// Keep a box (screen px) left of the notebook.
export const clipLeftOf = (box, x) => (box ? { ...box, right: Math.min(box.right, x) } : box);
