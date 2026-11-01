import { h, mount, safeUrl } from '../dom.js';
import { bi, tx } from '../i18n.js';
import { state, thumbOf, isVisible } from '../store.js';

function link(url, text) {
  const href = safeUrl(url);
  return href ? h('a', { href, target: '_blank', rel: 'noopener' }, text) : text;
}

export function render(main) {
  const items = state.cards.flatMap(card => ['photo', 'illustration', 'silhouette']
    .filter(k => card[k]?.file)
    .map(k => ({ card, kind: k, img: card[k] })));

  mount(main, h('section', { class: 'page' },
    h('a', { class: 'btn btn--soft', href: '#/more' }, '← ', tx('nav.more')),
    h('h1', { class: 'page__title' }, h('span', { 'aria-hidden': 'true' }, '📷'), tx('credits.title')),
    h('p', null, tx('credits.intro')),
    h('p', { class: 'muted' }, tx('credits.data')),
    h('p', { class: 'muted' }, tx('credits.map')),
    h('p', { class: 'muted' }, tx('credits.gbif')),
    items.length
      ? h('ul', { class: 'credits' }, items.map(({ card, kind, img }) => h('li', { class: 'credits__item', 'data-group': card.group },
        // Thumbnails of cards not collected yet are blurred so the credits don't spoil them.
        h('img', { class: ['credits__thumb', kind === 'silhouette' && 'credits__thumb--silhouette', !isVisible(card) && 'is-secret'], src: kind === 'silhouette' ? img.file : thumbOf(img.file), alt: '', loading: 'lazy' }),
        h('div', { class: 'credits__text' },
          h('p', { class: 'credits__name' }, bi(card.name), ' ',
            h('span', { class: 'chip' }, tx(`credits.${kind}`))),
          h('p', null, img.author, ' · ', link(img.licenseUrl, img.license), ' · ', link(img.sourceUrl, tx('card.source')))))))
      : h('p', null, tx('credits.none'))));
}
