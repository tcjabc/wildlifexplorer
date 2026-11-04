// Coming back to a card from the globe: which side was showing (the front, the open spread
// or the Fact File) and where the notebook was (collapsed or expanded, its view and page).
// The card screen leaves this when it closes for another screen (app.js); opening the same
// card straight from the globe takes it back, once. Kept in memory only.
//
//   { cardId, side: 'front' | 'inside' | 'back', notes: null | { expanded, view, scope, pageId }, viaMap }
// viaMap: the globe was opened from the card's map, so "Back to card" can go back in history.

let saved = null;

export function remember(state) {
  saved = state?.cardId ? { ...state } : null;
}

// The card's saved state, if the last card left was this one (and forget it).
export function take(cardId) {
  const s = saved?.cardId === cardId ? saved : null;
  saved = null;
  return s;
}

// Whether the globe now showing was opened from this card's map (so history.back() returns
// to it), without using the state up.
export const cameFromMap = cardId => Boolean(saved?.viaMap && saved.cardId === cardId);

// Which maps open the globe: a card with a range file, shown in the viewer (onMap given; a
// pack reveal has none).
export const opensGlobe = (card, onMap) => Boolean(onMap && card?.range);

// Only these sides come back; anything else opens on the front.
export const SIDES = ['front', 'inside', 'back'];
export const sideOf = ({ p = 0, f = 0 } = {}) => (f > 0.5 ? 'back' : p > 0.5 ? 'inside' : 'front');
