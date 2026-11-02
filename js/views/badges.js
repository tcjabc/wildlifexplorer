import { h, mount } from '../dom.js';
import { bi, tx, dateText } from '../i18n.js';
import { state, progress } from '../store.js';

export function render(main) {
  mount(main, h('section', { class: 'page' },
    h('h1', { class: 'page__title' }, h('span', { 'aria-hidden': 'true' }, '🏅'), tx('badge.title')),
    h('p', { class: 'muted' }, tx('badge.hint')),
    h('ul', { class: 'medals' }, state.groups.map(g => {
      const earned = state.badges[g.id];
      return h('li', { class: 'medal-item' },
        h('a', { class: ['medal', earned && 'medal--earned'], href: `#/binder/${g.id}`, 'data-group': g.id },
          h('span', { 'aria-hidden': 'true' }, g.emoji)),
        h('span', { class: 'medal-item__name' }, bi(g.name)),
        h('span', { class: 'medal-item__sub' },
          earned ? tx('badge.earnedOn', { date: dateText(earned) }) : tx('badge.progress', progress(g.id))));
    }))));
}
