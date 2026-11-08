import { h, mount, safeUrl } from '../dom.js';
import { bi, tx } from '../i18n.js';
import { state, thumbOf, isVisible } from '../store.js';
import { habitatOf } from '../habitat.js';
import { foodPhotos } from '../food.js';
import { babiesOf, behaviourOf, dykOf } from '../stage-pictures.js';
import { LAYERS, LAYER_CREDITS } from '../layers.js';

function link(url, text) {
  const href = safeUrl(url);
  return href ? h('a', { href, target: '_blank', rel: 'noopener' }, text) : text;
}

export function render(main) {
  const items = state.cards.flatMap(card => ['photo', 'illustration', 'silhouette', 'call']
    .filter(k => card[k]?.file)
    .map(k => ({ card, kind: k, img: card[k] }))
    .concat(habitatOf(card) ? [{ card, kind: 'habitat', img: habitatOf(card) }] : [])
    .concat(foodPhotos(card).map(img => ({ card, kind: 'food', img })))
    .concat(babiesOf(card) ? [{ card, kind: 'babies', img: babiesOf(card) }] : [])
    .concat(behaviourOf(card) ? [{ card, kind: 'behaviour', img: behaviourOf(card) }] : [])
    .concat(dykOf(card) ? [{ card, kind: 'dyk', img: dykOf(card) }] : [])
    .concat(card.compare?.silhouette?.file ? [{ card, kind: 'silhouette', img: card.compare.silhouette }] : []));
  // Standalone lookalikes (no card of their own) are always shown, so never blurred.
  const entries = Object.values(state.lookalikes.entries ?? {}).flatMap(e => ['photo', 'silhouette']
    .filter(k => e[k]?.file)
    .map(k => ({ card: e, kind: k, img: e[k], entry: true })));
  items.push(...entries);

  mount(main, h('section', { class: 'page' },
    h('a', { class: 'btn btn--soft', href: '#/parents' }, '← ', tx('parents.title')),
    h('h1', { class: 'page__title' }, h('span', { 'aria-hidden': 'true' }, '📷'), tx('credits.title')),
    h('p', null, tx('credits.intro')),
    h('p', { class: 'muted' }, tx('credits.data')),
    h('p', { class: 'muted' }, tx('credits.map')),
    h('p', { class: 'muted' }, tx('credits.gbif')),
    h('p', { class: 'muted' }, tx('credits.desk')),
    h('p', { class: 'muted' }, tx('credits.font')),
    items.length
      ? h('ul', { class: 'credits' }, items.map(({ card, kind, img, entry }) => h('li', { class: 'credits__item', 'data-group': card.group },
        // Thumbnails of cards not collected yet are blurred so the credits don't spoil them.
        kind === 'call'
          ? h('span', { class: 'credits__emoji', 'aria-hidden': 'true' }, '🔊')
          : h('img', { class: ['credits__thumb', kind === 'silhouette' && 'credits__thumb--silhouette', !entry && !isVisible(card) && 'is-secret'], src: kind === 'silhouette' ? img.file : thumbOf(img.file), alt: '', loading: 'lazy' }),
        h('div', { class: 'credits__text' },
          h('p', { class: 'credits__name' }, bi(card.name), ' ',
            h('span', { class: 'chip' }, tx(`credits.${kind}`)), entry && h('span', { class: 'chip' }, tx('credits.lookalike'))),
          h('p', null, img.author, ' · ', link(img.licenseUrl, img.license), ' · ', link(img.sourceUrl, tx('card.source')))))))
      : h('p', null, tx('credits.none')),
    h('h2', { class: 'panel__title' }, h('span', { 'aria-hidden': 'true' }, '🌍 '), tx('credits.layers')),
    h('ul', { class: 'credits' }, LAYER_CREDITS.map(c => {
      const L = LAYERS.find(l => l.id === c.layer);
      return h('li', { class: 'credits__item' },
        h('span', { class: 'credits__emoji', 'aria-hidden': 'true' }, L?.emoji ?? '🏠'),
        h('div', { class: 'credits__text' },
          h('p', { class: 'credits__name' }, tx(L ? `layer.${L.id}` : 'credits.home')),
          h('p', null, c.author, ' · ', link(c.licenseUrl, c.license), ' · ', link(c.sourceUrl, tx('card.source')))));
    }))));
}
