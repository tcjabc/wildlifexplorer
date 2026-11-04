// Packs: the unopened packs waiting (oldest on top) and when the next one comes.
// Hoarding is fine; they wait here for as long as the child likes. On a grown-up's phone:
// every pack, waiting or opened (and when), with nothing to open.
import { h, mount } from '../dom.js';
import { bi, tx, label, dateText } from '../i18n.js';
import { state, unopenedPacks, watching, dropById } from '../store.js';
import { openNow, nextDropText, packFace } from '../packs.js';

const when = iso => dateText(iso, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function watchList(main) {
  const list = [...state.packs].reverse(); // newest first
  mount(main, h('section', { class: 'page packs' },
    h('h1', { class: 'page__title' }, h('span', { 'aria-hidden': 'true' }, '🎁'), tx('packs.title')),
    h('p', { class: 'muted' }, tx('watch.packsNote')),
    list.length
      ? h('ul', { class: 'watch-packs' }, list.map(k => {
        const drop = dropById(k.dropId);
        const emojis = k.cardIds.map(id => state.groups.find(g => g.id === state.byId.get(id)?.group)?.emoji).join('');
        return h('li', { class: ['watch-pack', k.openedAt && 'is-opened'] },
          h('span', { class: 'watch-pack__emojis', 'aria-hidden': 'true' }, emojis),
          h('span', { class: 'watch-pack__text' },
            drop && h('strong', null, tx('pack.label', { series: drop.series, week: drop.week })),
            h('span', { class: 'muted' }, k.openedAt ? tx('watch.opened', { when: when(k.openedAt) }) : tx('watch.waiting', { when: when(k.dueAt) }))));
      }))
      : h('p', { class: 'empty' }, h('span', { 'aria-hidden': 'true' }, '📭 '), tx('watch.noPacks')),
    h('p', { class: 'packs__next' }, bi(nextDropText()))));
}

export function render(main) {
  if (watching()) { watchList(main); return; }
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
