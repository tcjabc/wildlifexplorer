// The stage: the large picture side of an open card. It shows one view at a time. Every view is a
// builder here, under the name js/headings.js knows it by (see there for adding one):
//   build(card, ctx, heading) → { el, replay?, stop?, layout? }
//     ctx: { onCredit, onMap }. heading: the heading that asked for it, or null.
//     replay: run its animation again. stop: it is leaving, stop whatever it started.
//     layout(w, h): the stage has this size now, in card px (when shown, and whenever it changes).
import { h, mount, reducedMotion } from './dom.js';
import { bi, label, t, tx } from './i18n.js';
import { picture, statusBadge } from './components.js';
import { mapButton, relatedItem, relatedOf } from './cardparts.js';
import { comparePanel } from './compare.js';
import { countRow } from './count-row.js';
import { hasMap } from './headings.js';
import { magnifier, featureOf } from './magnifier.js';
import { placeMap, worldMap } from './worldmap.js';

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

// The interactive of the two cards that have one so far: numbered labels on the picture. Tap one to
// ring it, see it through the magnifier and read about it in the box underneath; tap it again, or
// the picture, to close.
function profile(card) {
  const kind = card.profile.image ?? 'photo';
  const callouts = card.profile.callouts;
  const filled = p => p && (p.en || p.zh);
  const pic = h('div', { class: 'profile__pic' }, picture(card, { kind }));
  const loupe = magnifier(pic, card[kind].file, callouts);

  const marks = callouts.map((c, i) => {
    const f = featureOf(c);
    const btn = h('button', {
      class: 'profile__mark', type: 'button', 'aria-pressed': 'false',
      'aria-label': `${label('card.feature', { n: i + 1 })}: ${[c.en, c.zh].filter(Boolean).join(' / ')}`,
      onclick: e => { e.stopPropagation(); pick(i); },
    }, String(i + 1));
    btn.style.setProperty('left', `${f.x * 100}%`);
    btn.style.setProperty('top', `${f.y * 100}%`);
    return btn;
  });
  pic.append(h('div', { class: 'profile__marks' }, marks));

  const detail = h('div', { class: 'profile__detail', 'aria-live': 'polite' });
  const showDetail = i => mount(detail, i == null
    ? h('p', { class: 'stat__hint' }, tx('card.profileHint'))
    : [h('p', { class: 'profile__detail-name' }, h('span', { class: 'callouts__no', 'aria-hidden': 'true' }, String(i + 1)), bi(callouts[i])),
      filled(callouts[i].detail) && h('p', { class: 'profile__detail-text' }, bi(callouts[i].detail))]);
  const pick = i => {
    loupe.show(i);
    const on = loupe.current();
    marks.forEach((m, n) => { m.classList.toggle('is-lit', n === on); m.setAttribute('aria-pressed', String(n === on)); });
    showDetail(on);
  };
  pic.addEventListener('click', () => pick(null));
  showDetail(null);
  return { el: h('div', { class: 'stage-profile' }, pic, detail) };
}

// What the animal eats, landing on a plate.
function diet(card) {
  const panel = comparePanel(card);
  const replay = () => panel.show('diet');
  replay();
  return { el: h('div', { class: 'stage-scene' }, panel.el), replay };
}

// How many babies it has at a time, to tap and count, under its picture.
function babies(card, ctx) {
  const { min, max } = card.stats.youngCount;
  const count = max ?? min;
  const egg = card.stats.development?.kind === 'incubation';
  const figure = () => (egg || !card.silhouette?.file
    ? h('span', { class: 'count__emoji', 'aria-hidden': 'true' }, egg ? '🥚' : '🍼')
    : h('img', { class: 'count__img', src: card.silhouette.file, alt: '' }));
  const done = t(count === 1 ? 'stage.oneBaby' : max != null && max !== min ? 'stage.upToBabies' : 'stage.babies', { n: count });
  return { el: h('div', { class: 'stage-babies' }, h('div', { class: 'stage-babies__pic' }, gallery(card, ctx).el), countRow({ count, figure, done })) };
}

// Where it lives, as big as the stage: its range, or its continent lit up, or a pin on its place.
function map(card, { onMap }) {
  const el = h('div', { class: 'stage-map' });
  let shape = 0;
  return {
    el,
    layout(w, height) {
      const aspect = w / height;
      if (Math.abs(aspect - shape) < 0.01) return;
      shape = aspect;
      const where = label('card.where');
      const drawn = hasMap(card) ? worldMap(card, { detail: true, aspect, label: where }) : placeMap(card, { aspect, label: where });
      mount(el, mapButton(card, drawn, onMap, 'stage-map__open') ?? drawn);
    },
  };
}

const STATUS_SCALE = ['LC', 'NT', 'VU', 'EN', 'CR', 'EW', 'EX'];

// How safe the animal is: the Red List as a row of steps, with a heart on this one. Data Deficient
// and Not Evaluated aren't on the scale: just the name.
function status(card) {
  const on = STATUS_SCALE.includes(card.status);
  return {
    el: h('div', { class: 'stage-status' },
      on && h('ol', { class: 'stage-status__scale' }, STATUS_SCALE.map(code => h('li', {
        class: ['stage-status__step', code === card.status && 'is-on'], 'data-status': code.toLowerCase(),
      }, code === card.status && h('span', { class: 'stage-status__heart', 'aria-hidden': 'true' }, '❤️'), code))),
      statusBadge(card.status)),
  };
}

// The animals a topic card is about.
function related(card) {
  return { el: h('div', { class: 'stage-related', 'data-scroll': '' }, h('ul', { class: 'related' }, relatedOf(card).map(relatedItem))) };
}

export const STAGE_VIEWS = {
  gallery,
  photo: gallery,
  profile,
  diet,
  babies,
  map,
  status,
  related,
};

// The stage of one card.
export function stageFor(card, ctx) {
  const el = h('div', { class: 'stage', 'data-group': card.group });
  let view = null, id = null;
  const layout = () => { if (el.offsetWidth && el.offsetHeight) view?.layout?.(el.offsetWidth, el.offsetHeight); };
  return {
    el,
    layout,
    show(next, heading) {
      const name = STAGE_VIEWS[next] ? next : 'gallery';
      // A picture stays put from one heading to the next.
      if (name === id || (STAGE_VIEWS[name] === STAGE_VIEWS[id] && STAGE_VIEWS[name] === gallery)) { id = name; return; }
      view?.stop?.();
      id = name;
      view = STAGE_VIEWS[name](card, ctx, heading);
      mount(el, view.el);
      layout();
      if (!reducedMotion()) view.el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' });
    },
    replay: () => view?.replay?.(),
    destroy: () => view?.stop?.(),
  };
}
