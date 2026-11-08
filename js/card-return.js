// Coming back to a card from the globe or the full notebook: which side was showing (the cover, the
// open card and which heading was lit, or the back with what was under it) and where the notebook was (collapsed or expanded, its
// view and page). The card screen leaves this when it closes for another screen (app.js); opening the
// same card straight from there takes it back, once. Kept in memory only.
//
//   { cardId, side: 'front' | 'inside' | 'back', under: 'front' | 'inside', heading,
//     notes: null | { expanded, view, scope, pageId }, viaMap, viaFull }
// under: what the back lies over (the card turns over closed or open, and turns back to it).
// viaMap: the globe was opened from the card's map, so "Back to card" can go back in history.
// viaFull: the full notebook was opened from the card's panel, and opens where the panel was.

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

// Where the panel was, when the full notebook now opening for this card was opened from it.
export const panelOf = cardId => (saved?.viaFull && saved.cardId === cardId ? saved.notes : null);

// Where the panel opens after the full notebook: on the page it ended on when that is one of this
// card's, in the card's own list. Otherwise where it was, so that going through other animals'
// pages in the full notebook never leaves one of them beside this card.
//   ended: where() of the full notebook. tagsOf(pageId): that page's animals.
export function panelAfterFull(cardId, started, ended, tagsOf) {
  const ours = ended?.view === 'pages' && ended.pageId && tagsOf(ended.pageId).includes(cardId);
  return ours ? { ...started, view: 'pages', scope: { kind: 'animal', id: cardId }, pageId: ended.pageId } : started;
}

// The full notebook is closing: what the card will come back to.
export function leaveFull(cardId, ended, tagsOf) {
  const started = panelOf(cardId);
  if (started) saved = { ...saved, notes: panelAfterFull(cardId, started, ended, tagsOf) };
}

// Which maps open the globe: a card with a range file, shown in the viewer (onMap given; a
// pack reveal has none).
export const opensGlobe = (card, onMap) => Boolean(onMap && card?.range);

// Only these sides come back; anything else opens on the front.
export const SIDES = ['front', 'inside', 'back'];
export const sideOf = ({ p = 0, f = 0 } = {}) => (f > 0.5 && f < 1.5 ? 'back' : p > 0.5 ? 'inside' : 'front');
export const underOf = ({ p = 0 } = {}) => (p > 0.5 ? 'inside' : 'front');
