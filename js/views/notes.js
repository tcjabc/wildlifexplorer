// Field Notes on their own: the profile's whole notebook (#/notes), or one animal's pages
// (#/notes/<card id>) with "All pages" one tap away. The whole screen, so its back button is the
// way out: to the screen before it, or the binder when it was opened directly. Opened from the
// panel beside a card (js/card-return.js) it starts on the panel's page, and handBack() says where
// it ended, for the panel to open on when the card comes back.
import { mount } from '../dom.js';
import { notebook } from '../notebook.js';
import { state } from '../store.js';
import * as cardReturn from '../card-return.js';

const tagsOf = pageId => state.notes.find(r => r.pageId === pageId)?.tags ?? [];
let open = null; // the notebook showing, opened from a card's panel: { cardId, book }

export function render(main, [cardId], { from } = {}) {
  const onBack = () => { if (from) history.back(); else location.replace('#/binder'); };
  const start = cardId ? cardReturn.panelOf(cardId) : null;
  const book = notebook({ cardId: cardId ?? null, start, onBack });
  mount(main, book.el);
  open = start ? { cardId, book } : null;
  return () => { open = null; book.destroy(); };
}

export function handBack() {
  if (open) cardReturn.leaveFull(open.cardId, open.book.where(), tagsOf);
}
