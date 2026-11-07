import { h, mount } from '../dom.js';
import { tx, label } from '../i18n.js';
import { state, cardsIn, progress, groupById } from '../store.js';
import { cardTile, groupTab, groupTitle } from '../components.js';

let lastGroup = null;

export const currentGroup = () => lastGroup;

export function render(main, [groupId]) {
  const g = groupById(groupId) ?? groupById(lastGroup) ?? state.groups[0];
  lastGroup = g.id;
  const cards = cardsIn(g.id);
  const p = progress(g.id);
  const pct = p.total ? Math.round((p.n / p.total) * 100) : 0;

  const tabs = h('nav', { class: 'tabs', 'aria-label': label('nav.groups') },
    state.groups.map(gr => {
      const gp = progress(gr.id);
      return groupTab(gr, { active: gr.id === g.id, href: `#/binder/${gr.id}`, count: `${gp.n}/${gp.total}` });
    }));

  const page = h('div', { class: 'binder__page' },
    h('header', { class: 'binder__head' },
      h('h1', { class: 'binder__title' }, groupTitle(g)),
      h('div', { class: 'meter', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': p.total, 'aria-valuenow': p.n },
        h('span', { class: 'meter__fill', style: { width: `${pct}%` } })),
      h('p', { class: 'binder__count' }, tx('binder.collected', p))),
    cards.length
      ? h('div', { class: 'grid' }, cards.map(cardTile))
      : h('p', { class: 'empty' }, tx('binder.empty')));

  mount(main, h('section', { class: 'binder', 'data-group': g.id }, tabs, page));
  main.querySelector('.tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
}
