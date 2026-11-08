// The back of the card: the Fact File, for readers and grown-ups. Text only, laid out like a printed
// card back: the card's number and series, its name, a compact block of vital statistics, then the
// same headings as the grid (js/headings.js backSections) in the same order, each with its icon and
// colour as a small marker and its full text. Headings with nothing to read are left out. The body
// scrolls inside the card; the card never grows. No speech.
import { h } from './dom.js';
import { bi, tx, label } from './i18n.js';
import { state, groupById } from './store.js';
import { statusBadge, taiwanBadge } from './components.js';
import { backSections, isTopic } from './headings.js';
import { comingSoonKey, factsOf, glossed, headerStrip, preview, relatedOf, statCells, statRows } from './cardparts.js';
import { nameBi } from './zhuyin.js';

const continentsOf = card => (card.continents ?? [])
  .map(id => state.regions?.continents?.find(r => r.id === id)?.name).filter(Boolean);

// A list of names as one line: "Asia · Europe".
const names = list => (list.length > 0
  ? h('p', { class: 'ff__text ff__names' }, list.map(n => h('span', { class: 'ff__name-item' }, bi(n))))
  : null);

// What a heading has besides its text, as text: where it lives, how safe it is, who to look for.
function extras(card, x) {
  if (x.id === 'where') {
    const where = continentsOf(card);
    return [names(where), card.taiwan && taiwanBadge()];
  }
  if (x.id === 'status') return statusBadge(card.status);
  if (x.id === 'who') return names(relatedOf(card).map(r => r.card?.name ?? r.entry.name));
  return null;
}

// The Key Features (on the cover too) and the numbers, in one box.
function vitals(card) {
  const facts = isTopic(card) ? [] : factsOf(card);
  const rows = statRows(card);
  if (!facts.length && !rows.length) return null;
  return h('section', { class: 'ff__vitals', 'aria-label': label('card.vitalStats') },
    h('h3', { class: 'ff__vitals-title' }, tx('card.vitalStats')),
    rows.length > 0 && h('div', { class: 'ff__stats' }, rows.map(r => h('div', { class: 'stat' }, statCells(card, r)))),
    facts.length > 0 && h('ol', { class: 'ff__facts' }, facts.slice(0, 3).map(f => h('li', null, bi(f)))));
}

export function factBack(card) {
  const ctx = { preview: preview(), related: relatedOf(card).length };
  const sections = backSections(card, ctx).map(x => h('section', { class: 'ff__section', 'data-slot': x.slot, 'data-heading': x.id },
    h('h3', { class: 'ff__head' }, h('span', { class: 'ff__mark', 'aria-hidden': 'true' }, x.icon), tx(x.label)),
    extras(card, x),
    x.text.map(glossed)));
  const box = vitals(card);
  const soon = !sections.length && !box && h('p', { class: 'ff__soon' },
    h('span', { class: 'ff__soon-icon', 'aria-hidden': 'true' }, groupById(card.group)?.emoji), tx(comingSoonKey(card)));
  return h('div', { class: 'cpage cpage--back', 'data-group': card.group },
    headerStrip(card, h('span', { class: 'ff__title' }, h('span', { 'aria-hidden': 'true' }, '📁'), tx('card.factFile'))),
    h('div', { class: 'cpage__scroll ff__body', 'data-scroll': '', tabindex: '0', 'aria-label': label('card.factFile') },
      h('h2', { class: 'ff__cardname' }, nameBi(card.name)),
      card.scientificName && h('p', { class: 'ff__sci' }, h('i', { lang: 'la' }, card.scientificName)),
      box,
      sections,
      soon));
}
