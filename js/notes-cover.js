// The notebook's front cover: what Field Notes shows first, closed on the desk. A component of its
// own so a decorated cover (colours, stickers of collected animals and badges) can take its place:
// everything on the outside goes in .nb-cover__front. js/notes-book.js turns it on the spiral.
import { h } from './dom.js';

//   title: the notebook's name. name: the explorer's. label: for a screen reader. onOpen: it was tapped.
export function bookCover({ title, name, label, onOpen }) {
  // The tap zone is a layer of its own: a button can't hold 3D faces.
  const el = h('div', { class: 'nb-cover' },
    h('div', { class: 'nb-cover__front' },
      h('div', { class: 'nb-cover__label' },
        h('div', { class: 'nb-cover__title' }, title),
        h('div', { class: 'nb-cover__name' }, name))),
    h('div', { class: 'nb-cover__inside' }),
    h('button', { type: 'button', class: 'nb-cover__tap', 'aria-label': label, onclick: () => onOpen() }));
  return { el };
}
