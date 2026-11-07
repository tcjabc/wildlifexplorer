// The open card, two sides: one large stage (js/stage-views.js) and the menu, a fixed grid of heading
// buttons (js/headings.js) with the text of the one that is lit under it. Tapping a heading lights
// it, shows its text and switches the stage to match; tapping it again goes back to the gallery.
//
// Which side goes where is up to the viewer (js/card-layout.js openLayout): beside the menu the stage
// is the page on the left, on the back of the cover; above it, it sits in the menu page's own slot.
// place() moves it, so what is on the stage carries on.
import { h, mount } from './dom.js';
import { bi, t, tx } from './i18n.js';
import { state } from './store.js';
import { statusBadge, taiwanBadge } from './components.js';
import { comingSoonKey, glossed, preview, readOrder, relatedItem, relatedOf, statCells, statRows } from './cardparts.js';
import { headingsFor } from './headings.js';
import { plainPair } from './glossary.js';
import { lookalikesOf } from './lookalikes.js';
import { nameBi } from './zhuyin.js';
import { stageFor } from './stage-views.js';

// The statistics that go with a heading, by their mode in statRows.
const ROWS = { size: ['length', 'height', 'wingspan', 'weight', 'lifespan'], babies: ['development', 'young'], food: ['diet'] };

const continentsOf = card => (card.continents ?? [])
  .map(id => state.regions.continents.find(r => r.id === id)?.name).filter(Boolean);

export function openCard(card, { onCredit, onMap } = {}) {
  const ctx = { preview: preview(), lookalikes: lookalikesOf(card).length, related: relatedOf(card).length };
  const grid = headingsFor(card, ctx);
  const stage = stageFor(card, { onCredit, onMap });
  const rows = statRows(card);
  const rowsOf = x => rows.filter(r => ROWS[x.id]?.includes(r.mode));
  let current = null;

  const statList = x => {
    const list = rowsOf(x);
    return list.length > 0 && h('div', { class: 'open__stats' }, list.map(r => h('div', { class: 'stat' }, statCells(card, r))));
  };

  // What goes between the heading's title and its text.
  const extras = x => {
    if (x.id === 'where') {
      return [h('p', { class: 'ff__text' }, continentsOf(card).map(n => bi(n))), card.taiwan && taiwanBadge()];
    }
    return [x.id === 'status' && statusBadge(card.status), statList(x)];
  };

  const panel = x => [
    h('h2', { class: 'cpage__heading' }, h('span', { 'aria-hidden': 'true' }, x.icon), tx(x.label)),
    extras(x),
    x.text.map(glossed),
  ];

  // Nothing lit: the card's name, and its relations if it has any.
  const home = () => {
    const related = relatedOf(card);
    const empty = grid.every(x => !x.enabled);
    return [
      h('h2', { class: 'open__name' }, nameBi(card.name)),
      h('p', { class: 'stat__hint' }, tx(empty ? comingSoonKey(card) : 'card.pickHeading')),
      related.length > 0 && h('section', { class: 'open__related' },
        h('h3', { class: 'cpage__label' }, tx('card.related')),
        h('ul', { class: 'related' }, related.map(relatedItem))),
    ];
  };

  const slot = h('div', { class: 'open__slot' });
  const text = h('div', { class: 'open__text', 'data-scroll': '', tabindex: '0', 'aria-live': 'polite' });

  function select(id) {
    const x = grid.find(g => g.id === id && g.enabled) ?? null;
    current = x?.id ?? null;
    buttons.forEach(b => {
      const on = b.dataset.heading === current;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    stage.show(x?.view ?? 'gallery', x);
    mount(text, x ? panel(x) : home());
    text.scrollTop = 0;
  }

  // A grey heading is still in the grid and still part of the card for a swipe that starts on it,
  // so it is marked rather than disabled.
  const buttons = grid.map(x => h('button', {
    class: 'hbtn', type: 'button', 'data-heading': x.id, 'data-slot': x.slot,
    'aria-pressed': 'false', 'aria-disabled': x.enabled ? null : 'true',
    onclick: () => { if (x.enabled) select(x.id === current ? null : x.id); },
  }, h('span', { class: 'hbtn__icon', 'aria-hidden': 'true' }, x.icon), h('span', { class: 'hbtn__label' }, tx(x.label))));

  const menu = h('div', { class: 'cpage cpage--menu', 'data-group': card.group },
    slot, h('div', { class: 'hgrid' }, buttons), text);
  select(null);

  // What read-aloud says now: the heading's name, then its text.
  function spoken() {
    const x = grid.find(g => g.id === current);
    if (!x) return readOrder(card);
    const stats = rowsOf(x).flatMap(r => [t(r.key), r.text]);
    const where = x.id === 'where' ? continentsOf(card) : [];
    const status = x.id === 'status' && card.status ? [t(`status.${card.status}`)] : [];
    return [t(x.label), ...where, ...status, ...stats, ...x.text.map(plainPair)];
  }

  return {
    menu,
    // host: the page beside the menu, or nothing to use the menu page's own slot.
    place(host) {
      const to = host ?? slot;
      if (stage.el.parentElement !== to) to.append(stage.el);
      stage.layout();
    },
    select,
    selected: () => current,
    spoken,
    replay: () => stage.replay(),
    destroy: () => stage.destroy(),
  };
}
