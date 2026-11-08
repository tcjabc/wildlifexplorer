// The card's front, for exploring: one large stage (js/stage-views.js) and the heading grid, a fixed
// grid of buttons (js/headings.js) with their names. Nothing to read on it: the words are all on the
// back (js/fact-back.js). Tapping a heading lights it and switches the stage to match; what the
// viewer does besides (scroll the back to it, or turn the card over to it) is onHeading. Headings are
// silent, unless the card has a recorded narration for one.
import { h } from './dom.js';
import { getMode, tx } from './i18n.js';
import { groupById } from './store.js';
import { groupChip, headerStrip, preview, relatedOf } from './cardparts.js';
import { headingsFor } from './headings.js';
import { lookalikesOf } from './lookalikes.js';
import { stageFor } from './stage-views.js';
import { playNarration, stopCall } from './card-call.js';

// onHeading(id, { again }): a heading was tapped; again when it was already lit (it goes back to the
// gallery).
export function openCard(card, { onCredit, onMap, onCall, onHeading } = {}) {
  const ctx = { preview: preview(), lookalikes: lookalikesOf(card).length, related: relatedOf(card).length };
  const grid = headingsFor(card, ctx);
  const stage = stageFor(card, { onCredit, onMap, onCall });
  let current = null;

  // quiet: coming back to a heading that was already lit, nothing to play.
  function select(id, { quiet = false } = {}) {
    const x = grid.find(g => g.id === id && g.enabled) ?? null;
    current = x?.id ?? null;
    buttons.forEach(b => {
      const on = b.dataset.heading === current;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    });
    stage.show(x?.view ?? 'gallery', x);
    if (quiet) return;
    stopCall();
    if (x) playNarration(card, x.id, getMode());
  }

  // A grey heading is still in the grid and still part of the card for a swipe that starts on it,
  // so it is marked rather than disabled.
  const buttons = grid.map(x => h('button', {
    class: 'hbtn', type: 'button', 'data-heading': x.id, 'data-slot': x.slot,
    'aria-pressed': 'false', 'aria-disabled': x.enabled ? null : 'true',
    onclick: () => {
      if (!x.enabled) return;
      const again = x.id === current;
      select(again ? null : x.id);
      onHeading?.(x.id, { again });
    },
  }, h('span', { class: 'hbtn__icon', 'aria-hidden': 'true' }, x.icon), h('span', { class: 'hbtn__label' }, tx(x.label))));

  const slot = h('div', { class: 'front__stage' }, stage.el);
  const front = h('div', { class: 'cpage cpage--front', 'data-group': card.group },
    headerStrip(card, groupChip(groupById(card.group))),
    slot, h('div', { class: 'hgrid' }, buttons));
  select(null, { quiet: true });

  return {
    el: front,
    layout: () => stage.layout(),
    select,
    selected: () => current,
    replay: () => stage.replay(),
    destroy: () => stage.destroy(),
  };
}
