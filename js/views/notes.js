// Field Notes on their own: the profile's whole notebook (#/notes), or one animal's pages
// (#/notes/<card id>) with "All pages" one tap away. The whole screen, so its back button is the
// way out: to the screen before it, or the binder when it was opened directly.
import { mount } from '../dom.js';
import { notebook } from '../notebook.js';

export function render(main, [cardId], { from } = {}) {
  const onBack = () => { if (from) history.back(); else location.replace('#/binder'); };
  const book = notebook({ cardId: cardId ?? null, onBack });
  mount(main, book.el);
  return () => { book.destroy(); };
}
