// The stage: the large picture side of an open card. It shows one view at a time. Every view is a
// builder here, under the name js/headings.js knows it by (see there for adding one):
//   build(card, ctx, heading) → { el, replay?, stop? }
//     ctx: { onCredit, onMap }. heading: the heading that asked for it, or null.
//     replay: run its animation again. stop: it is leaving, stop whatever it started.
import { h, mount, reducedMotion } from './dom.js';
import { label } from './i18n.js';
import { picture } from './components.js';

const KINDS = [['photo', '📷'], ['illustration', '🎨']];

// The card's pictures, photo first, kept as separate files. With both, two buttons swap them.
function gallery(card, { onCredit }) {
  const kinds = KINDS.filter(([k]) => card[k]?.file);
  const frame = h('div', { class: 'stage-pic' });
  let showing = kinds[0]?.[0];
  const pick = h('div', { class: 'stage-pic__kinds', role: 'radiogroup', 'aria-label': label('card.pictureKind') });
  function show(kind) {
    showing = kind;
    mount(frame, picture(card, { kind }),
      kind && h('button', {
        class: 'cover__credit', type: 'button', 'aria-label': label('card.credit'), onclick: () => onCredit?.(kind),
      }, kind === 'photo' ? '📷' : '🎨'),
      kinds.length > 1 && pick);
    pick.querySelectorAll('button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.kind === showing)));
  }
  if (kinds.length > 1) {
    pick.append(...kinds.map(([kind, icon]) => h('button', {
      class: 'stage-pic__kind', type: 'button', role: 'radio', 'data-kind': kind,
      'aria-label': label(`card.${kind}`), onclick: () => show(kind),
    }, icon)));
  }
  show(showing);
  return { el: frame };
}

export const STAGE_VIEWS = {
  gallery,
  photo: gallery,
};

// The stage of one card.
export function stageFor(card, ctx) {
  const el = h('div', { class: 'stage', 'data-group': card.group });
  let view = null, id = null;
  return {
    el,
    show(next, heading) {
      const name = STAGE_VIEWS[next] ? next : 'gallery';
      // A picture stays put from one heading to the next.
      if (name === id || (STAGE_VIEWS[name] === STAGE_VIEWS[id] && STAGE_VIEWS[name] === gallery)) { id = name; return; }
      view?.stop?.();
      id = name;
      view = STAGE_VIEWS[name](card, ctx, heading);
      mount(el, view.el);
      if (!reducedMotion()) view.el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    },
    replay: () => view?.replay?.(),
    destroy: () => view?.stop?.(),
  };
}
