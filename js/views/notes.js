// Field Notes on their own: the profile's whole notebook (#/notes), or one animal's pages
// (#/notes/<card id>) with "All pages" one tap away.
import { mount } from '../dom.js';
import { notebook } from '../notebook.js';

export function render(main, [cardId]) {
  const book = notebook({ cardId: cardId ?? null });
  mount(main, book.el);
  return () => { book.destroy(); };
}
