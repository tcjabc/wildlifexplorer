import { h, mount, safeUrl } from '../dom.js';
import { bi, tx, t, label } from '../i18n.js';
import { state, cardsIn, isVisible, groupById } from '../store.js';
import { picture, statusBadge, taiwanBadge, readButton, cardNo, groupTitle } from '../components.js';
import { stop } from '../speech.js';

const filled = p => p && (p.en || p.zh);
const kindIcon = kind => (kind === 'photo' ? '📷' : '🎨');

function creditLine(img, kind, onOpen) {
  return h('button', { class: 'credit', type: 'button', onclick: onOpen },
    h('span', { 'aria-hidden': 'true' }, kindIcon(kind)),
    h('span', { class: 'credit__text' }, `${img.author} · ${img.license}`),
    h('span', { class: 'credit__more', 'aria-hidden': 'true' }, 'ⓘ'));
}

function creditSheetContent(img, kind, onClose) {
  const licenseUrl = safeUrl(img.licenseUrl);
  const sourceUrl = safeUrl(img.sourceUrl);
  return [
    h('h2', { class: 'sheet__title' }, h('span', { 'aria-hidden': 'true' }, kindIcon(kind)), tx('card.creditTitle')),
    h('dl', { class: 'facts-list' },
      h('dt', null, tx('card.author')), h('dd', null, img.author),
      h('dt', null, tx('card.license')), h('dd', null, img.license)),
    h('div', { class: 'sheet__actions' },
      licenseUrl && h('a', { class: 'btn btn--soft', href: licenseUrl, target: '_blank', rel: 'noopener' }, tx('card.openLicense')),
      sourceUrl && h('a', { class: 'btn btn--soft', href: sourceUrl, target: '_blank', rel: 'noopener' }, tx('card.openSource')),
      h('button', { class: 'btn btn--primary', type: 'button', onclick: onClose }, tx('card.close'))),
  ];
}

function taxonomy(card) {
  const tax = card.taxonomy;
  const rows = tax ? ['class', 'order', 'family'].filter(r => tax[r]) : [];
  if (!rows.length) return null;
  return h('dl', { class: 'taxonomy' }, rows.map(r => h('div', { class: 'taxonomy__row' },
    h('dt', null, tx(`card.${r}`)),
    h('dd', null,
      h('i', { lang: 'la' }, tax[r].sci),
      tax[r].zh && ' ',
      tax[r].zh && h('span', { class: 't-zh', lang: 'zh-Hant-TW' }, tax[r].zh)))));
}

const navButton = (target, key) => h('a', {
  class: ['btn btn--icon', !target && 'is-hidden'],
  href: target ? `#/card/${encodeURIComponent(target.id)}` : '#',
  'aria-label': label(key),
  onclick: e => { if (!target) e.preventDefault(); },
}, key === 'card.prev' ? '‹' : '›');

export function render(main, [id]) {
  const card = state.byId.get(id);
  if (!card) { location.hash = '#/binder'; return; }
  const g = groupById(card.group);
  const back = h('a', { class: 'btn btn--icon', href: `#/binder/${g.id}`, 'aria-label': label('card.back') }, '←');

  if (!isVisible(card)) {
    mount(main, h('section', { class: 'card-view card-view--locked', 'data-group': card.group },
      h('div', { class: 'card-view__bar' }, back),
      h('div', { class: 'locked-msg' },
        h('span', { class: 'silhouette silhouette--big', 'aria-hidden': 'true' }, g.emoji),
        h('p', null, tx('card.locked')))));
    return;
  }

  const siblings = cardsIn(card.group).filter(isVisible);
  const i = siblings.indexOf(card);
  const prev = siblings[i - 1], next = siblings[i + 1];
  const kinds = ['photo', 'illustration'].filter(k => card[k]?.file);
  let kind = kinds[0];
  const facts = (card.facts ?? []).filter(filled);
  const isTopic = !card.scientificName;

  const sheet = h('dialog', { class: 'sheet' });
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.close(); });
  const openCredit = () => {
    mount(sheet, creditSheetContent(card[kind], kind, () => sheet.close()));
    sheet.showModal();
  };

  const picSlot = h('div', { class: 'card-view__pic' }, picture(card, { kind }));
  const creditSlot = h('figcaption', null,
    kind ? creditLine(card[kind], kind, openCredit) : h('span', { class: 'muted' }, tx('card.noImage')));

  const kindButtons = kinds.map(k => h('button', {
    type: 'button', role: 'radio', class: 'seg__btn', 'aria-checked': String(k === kind),
    onclick: () => {
      kind = k;
      mount(picSlot, picture(card, { kind }));
      mount(creditSlot, creditLine(card[kind], kind, openCredit));
      kindButtons.forEach((b, n) => b.setAttribute('aria-checked', String(kinds[n] === k)));
    },
  }, h('span', { 'aria-hidden': 'true' }, kindIcon(k)), tx(`card.${k}`)));

  const read = readButton(() => [
    card.name,
    ...facts,
    ...(filled(card.habitat) ? [t('card.habitat'), card.habitat] : []),
  ], { big: true });

  const body = h('div', { class: 'card-view__body' },
    h('figure', { class: 'card-view__figure' },
      picSlot,
      kinds.length > 1 && h('div', { class: 'seg seg--small', role: 'radiogroup', 'aria-label': label('card.pictureKind') }, kindButtons),
      creditSlot),
    h('div', { class: 'card-view__info' },
      h('h1', { class: 'card-view__name' }, bi(card.name, 'bi--title')),
      card.scientificName && h('p', { class: 'sci', lang: 'la' }, card.scientificName),
      h('div', { class: 'badges-row' }, statusBadge(card.status), card.taiwan && taiwanBadge()),
      facts.length > 0 && h('section', { class: 'panel' },
        h('h2', { class: 'panel__title' }, tx(isTopic ? 'card.about' : 'card.facts')),
        h('ol', { class: 'facts' }, facts.map(f => h('li', null, bi(f))))),
      filled(card.habitat) && h('section', { class: 'panel' },
        h('h2', { class: 'panel__title' }, tx('card.habitat')),
        h('p', null, bi(card.habitat))),
      taxonomy(card)));

  mount(main,
    h('article', { class: 'card-view', 'data-group': card.group },
      h('div', { class: 'card-view__bar' },
        back,
        h('span', { class: 'card-view__group' }, groupTitle(g)),
        h('span', { class: 'card-view__no' }, cardNo(card.number)),
        h('span', { class: 'spacer' }),
        read,
        navButton(prev, 'card.prev'),
        navButton(next, 'card.next')),
      body),
    sheet);

  // Swipe left/right between cards in the same group.
  let start = null;
  body.addEventListener('touchstart', e => { start = e.touches[0]; }, { passive: true });
  body.addEventListener('touchend', e => {
    if (!start) return;
    const end = e.changedTouches[0];
    const dx = end.clientX - start.clientX, dy = end.clientY - start.clientY;
    start = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const target = dx < 0 ? next : prev;
    if (target) { stop(); location.hash = `#/card/${encodeURIComponent(target.id)}`; }
  });

  return () => stop();
}

export function onKey(e, [id]) {
  const card = state.byId.get(id);
  if (!card) return;
  const siblings = cardsIn(card.group).filter(isVisible);
  const i = siblings.indexOf(card);
  const target = e.key === 'ArrowLeft' ? siblings[i - 1] : e.key === 'ArrowRight' ? siblings[i + 1] : null;
  if (target) location.hash = `#/card/${encodeURIComponent(target.id)}`;
  if (e.key === 'Escape' && !document.querySelector('dialog[open]')) location.hash = `#/binder/${card.group}`;
}
