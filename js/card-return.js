// Coming back to a card from the globe or the full notebook: which side was showing (the front, or the
// back where the card turns over), which heading was lit, and where the notebook was (collapsed or
// expanded, its view and page). The card screen leaves this when it closes for another screen (app.js); opening the
// same card straight from there takes it back, once. Kept in memory only.
//
//   { cardId, side: 'front' | 'back', heading, notes: null | { expanded, view, scope, pageId }, viaMap, viaFull }
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
export const SIDES = ['front', 'back'];
// f: the turn-over, in half turns from the front (js/viewer.js): odd is the back, either way round.
export const onBack = f => Math.abs(f - 2 * Math.round(f / 2)) > 0.5;
export const sideOf = ({ f = 0 } = {}) => (onBack(f) ? 'back' : 'front');
