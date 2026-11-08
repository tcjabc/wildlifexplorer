// The back of the card: the Fact File, everything on the card to read, laid out like a printed card
// back: the card's number and series, its name, a compact block of vital statistics and the Key
// Features, where in the world it lives (the map, which opens the globe), how safe it is and whether
// it is found in Taiwan, then the same headings as the grid on the front (js/headings.js
// backSections) in the same order, each with its icon and colour as a small marker and its full
// text. Headings with nothing to read are left out. The body scrolls inside the card; the card never
// grows. No speech.
import { h, reducedMotion } from './dom.js';
import { bi, tx, label } from './i18n.js';
import { state, groupById } from './store.js';
import { statusBadge, taiwanBadge } from './components.js';
import { backSections, isTopic } from './headings.js';
import { comingSoonKey, factsOf, glossed, headerStrip, mapButton, preview, relatedOf, statCells, statRows } from './cardparts.js';
import { worldMap } from './worldmap.js';
import { nameBi } from './zhuyin.js';

const continentsOf = card => (card.continents ?? [])
  .map(id => state.regions?.continents?.find(r => r.id === id)?.name).filter(Boolean);

// A list of names as one line: "Asia · Europe".
const names = list => (list.length > 0
  ? h('p', { class: 'ff__text ff__names' }, list.map(n => h('span', { class: 'ff__name-item' }, bi(n))))
  : null);

// What a heading has besides its text: where it lives, who to look for. (How safe it is and Found in
// Taiwan are near the top, with the map.)
function extras(card, x) {
  if (x.id === 'where') return names(continentsOf(card));
  if (x.id === 'who') return names(relatedOf(card).map(r => r.card?.name ?? r.entry.name));
  return null;
}

// Where in the World: the map (a button to the globe, where the card has a range), its status and
// Found in Taiwan beside it.
function where(card, onMap) {
  const map = mapButton(card, worldMap(card, { label: label('card.where') }), onMap, 'ff__map')
    ?? h('div', { class: 'ff__map' }, worldMap(card, { label: label('card.where') }));
  const badges = [statusBadge(card.status), card.taiwan && taiwanBadge()].filter(Boolean);
  return h('section', { class: 'ff__where', 'aria-label': label('card.where') },
    h('h3', { class: 'ff__vitals-title' }, tx('card.where')),
    h('div', { class: 'ff__where-row' }, map, badges.length > 0 && h('div', { class: 'ff__badges' }, badges)));
}

// The Key Features (on the cover too) and the numbers, in one box.
function vitals(card) {
  const facts = isTopic(card) ? [] : factsOf(card);
  const rows = statRows(card);
  if (!facts.length && !rows.length) return null;
  // Size has no section of its own: its numbers are here.
  return h('section', { class: 'ff__vitals ff__section', 'data-heading': 'size', 'aria-label': label('card.vitalStats') },
    h('h3', { class: 'ff__vitals-title' }, tx('card.vitalStats')),
    rows.length > 0 && h('div', { class: 'ff__stats' }, rows.map(r => h('div', { class: 'stat' }, statCells(card, r)))),
    facts.length > 0 && h('ol', { class: 'ff__facts' }, facts.slice(0, 3).map(f => h('li', null, bi(f)))));
}

// onMap: the map opens the globe (the viewer); without it the map is a picture.
export function factBack(card, { onMap } = {}) {
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
      !isTopic(card) && where(card, onMap),
      sections,
      soon));
}

// Bring a heading's section into view on the back (and mark it), or just clear the mark (null).
// smooth: glide there, unless motion is reduced.
export function showSection(back, id, { smooth = true } = {}) {
  const body = back.querySelector('.ff__body');
  let at = null;
  for (const sec of back.querySelectorAll('.ff__section')) {
    const on = sec.dataset.heading === id;
    sec.classList.toggle('is-lit', on);
    if (on) at = sec;
  }
  if (!at || !body) return false;
  const top = at.offsetTop - body.offsetTop - parseFloat(getComputedStyle(body).paddingTop || '0');
  body.scrollTo({ top: Math.max(0, top), behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' });
  return true;
}
