// Packs: the unopened packs waiting (oldest on top) and when the next one comes.
// Hoarding is fine; they wait here for as long as the child likes.
import { h, mount } from '../dom.js';
import { bi, tx, label } from '../i18n.js';
import { unopenedPacks } from '../store.js';
import { openNow, nextDropText, packFace } from '../packs.js';

export function render(main) {
  const left = unopenedPacks();
  // The top of the stack is the oldest pack, the one that opens next.
  const stack = left.slice(0, 3).reverse().map(packFace);
  mount(main, h('section', { class: 'page packs' },
    h('h1', { class: 'page__title' }, h('span', { 'aria-hidden': 'true' }, '🎁'), tx('packs.title')),
    left.length
      ? h('div', { class: 'packs__ready' },
        h('button', { class: 'packstack', type: 'button', 'aria-label': label('packs.open'), onclick: openNow }, stack),
        h('p', { class: 'packs__count' }, tx(left.length === 1 ? 'packs.one' : 'packs.many', { n: left.length })),
        h('button', { class: 'btn btn--accent btn--big', type: 'button', onclick: openNow }, tx('packs.open')))
      : h('p', { class: 'empty' }, h('span', { 'aria-hidden': 'true' }, '📭 '), tx('packs.none')),
    h('p', { class: 'packs__next' }, bi(nextDropText()))));
}
