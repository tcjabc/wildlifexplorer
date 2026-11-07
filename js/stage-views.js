// The stage: the large picture side of an open card. It shows one view at a time. Every view is a
// builder here, under the name js/headings.js knows it by (see there for adding one):
//   build(card, ctx, heading) → { el, replay?, stop?, layout? }
//     ctx: { onCredit, onMap, onCall }. heading: the heading that asked for it, or null.
//     replay: run its animation again. stop: it is leaving, stop whatever it started.
//     layout(w, h): the stage has this size now, in card px (when shown, and whenever it changes).
import { h, mount, reducedMotion } from './dom.js';
import { bi, label, t, tx } from './i18n.js';
import { state } from './store.js';
import { picture, statusBadge } from './components.js';
import { callable, mapButton, relatedItem, relatedOf } from './cardparts.js';
import { animalImg, comparePanel, partner, whoImg } from './compare.js';
import { PARTNERS, countFor, modesFor, startWith } from './compare-data.js';
import { lookalikePanel, lookalikesOf } from './lookalikes.js';
import { countRow } from './count-row.js';
import { hasMap } from './headings.js';
import { magnifier, featureOf } from './magnifier.js';
import { placeMap, worldMap } from './worldmap.js';

const KINDS = [['photo', '📷'], ['illustration', '🎨']];

// The card's pictures, photo first, kept as separate files. With both, two buttons swap them.
function gallery(card, { onCredit, onCall }) {
  const kinds = KINDS.filter(([k]) => card[k]?.file);
  const frame = callable(card, h('div', { class: 'stage-pic' }), onCall);
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

const MODES = [['length', '📏', 'card.length'], ['weight', '⚖️', 'card.weight'], ['lifespan', '⏳', 'card.lifespan']];
const WHO = [['you', '🧒', 'compare.you'], ...Object.values(PARTNERS).map(p => [p.id, p.icon, `compare.partner.${p.id}`])];

// A row of choices, one of them on. onPick(value). items: [value, icon, label key].
function chooser(items, on, onPick, { cls, words = true, name }) {
  const el = h('div', { class: ['cmp-toggle', cls], role: 'radiogroup', 'aria-label': label(name) },
    items.map(([value, icon, key]) => h('button', {
      type: 'button', role: 'radio', class: 'cmp-toggle__btn', 'data-value': value,
      'aria-checked': String(value === on), 'aria-label': words ? null : label(key),
      onclick: () => { set(value); onPick(value); },
    }, h('span', { 'aria-hidden': 'true' }, icon), words && tx(key))));
  const set = value => el.querySelectorAll('[data-value]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.value === value)));
  return el;
}

// The creature comparison, on the whole stage. You: the animal beside the child, or a grown-up, a
// cat or a car, with a row of figures to count how many make the other. Animal (with lookalikes):
// the animal beside its lookalikes.
function compare(card) {
  const modes = MODES.filter(([m]) => modesFor(card)[m]);
  const looks = lookalikesOf(card);
  const others = looks.length ? lookalikePanel(card, looks) : null;
  const panel = comparePanel(card);
  let mode = modes[0]?.[0] ?? null;
  let who = startWith(mode, state.profile);
  let view = mode ? 'you' : 'animal';

  const count = h('div', { class: 'stage-cmp__count' });
  function drawCount() {
    const c = mode === 'lifespan' ? null : countFor(card, mode, partner(who));
    if (!c) { mount(count); return; }
    const figure = () => (c.side === 'who' ? whoImg(partner(who), 'count__img') : animalImg(card, 'count__img'));
    const done = c.side === 'who' ? t(`compare.count.${who}`, { n: c.n }) : t('compare.count.animal', { n: c.n, name: card.name });
    mount(count, countRow({ count: c.n, figure, done }));
  }

  const whoRow = chooser(WHO, who, value => { who = value; draw(); }, { cls: 'stage-cmp__who', name: 'compare.with' });
  function draw() {
    if (view === 'animal') { others.show(); return; }
    whoRow.hidden = mode === 'lifespan'; // a car has no birthdays: lifespans are the child's
    panel.show(mode, partner(mode === 'lifespan' ? 'you' : who));
    drawCount();
  }

  const you = mode && h('div', { class: 'stage-cmp__body' },
    whoRow, panel.el, count);
  const animal = others && h('div', { class: 'stage-cmp__body' }, others.el);
  const setView = value => {
    view = value;
    if (you) you.hidden = view !== 'you';
    if (animal) animal.hidden = view !== 'animal';
    if (view !== 'animal') others?.stop();
    draw();
  };
  const top = h('div', { class: 'stage-cmp__top' },
    you && animal && chooser([['you', '🧒', 'compare.you'], ['animal', '🐾', 'compare.animal']], view, setView, { name: 'compare.with' }),
    modes.length > 1 && chooser(modes, mode, value => { mode = value; draw(); }, { words: false, name: 'heading.size' }));
  if (you && animal) animal.hidden = true;

  let drawn = '';
  return {
    el: h('div', { class: 'stage-cmp' }, top.childElementCount > 0 && top, you, animal),
    // The scenes are measured from the stage, so they are drawn once it is there.
    layout(w, height) { if (drawn !== `${w}x${height}`) { drawn = `${w}x${height}`; draw(); } },
    replay: draw,
    stop() { panel.stop(); others?.stop(); },
  };
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
  compare,
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
