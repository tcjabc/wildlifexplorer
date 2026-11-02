// "Animal" comparison: a card next to animals it is easily confused with, side by side at
// scale, with how to tell them apart (data/lookalikes.json). A group is defined once and
// shows on every member's card.
//   another card the profile has (or parent preview) → shown in full, tap to open it
//   another card not collected yet → a locked silhouette, as a teaser
//   a standalone entry (an animal with no card) → shown in full
// Cards not built yet are left out, and draft groups only show in parent preview.
import { h, mount } from './dom.js';
import { bi, tx } from './i18n.js';
import { state, isVisible, thumbOf } from './store.js';
import { lengthText } from './units.js';

const KEY = { length: 'lengthCm', height: 'heightCm', wingspan: 'wingspanCm' };
const mid = r => (r == null ? null : r.max == null ? r.min : (r.min + r.max) / 2);
const cssNum = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));

// [{ group, other }] for a card; other is { card } or { entry }.
export function lookalikesOf(card) {
  const preview = Boolean(state.profile?.parent.preview);
  const out = [];
  for (const group of state.lookalikes.groups ?? []) {
    if (!group.members.includes(card.id) || (group.draft && !preview)) continue;
    for (const m of group.members) {
      if (m === card.id) continue;
      if (m.startsWith('entry:')) {
        const entry = state.lookalikes.entries?.[m.slice(6)];
        if (entry) out.push({ group, other: { entry } });
      } else if (state.byId.has(m)) out.push({ group, other: { card: state.byId.get(m) } });
    }
  }
  return out;
}

// What to draw for one animal.
function memberOf(other, key) {
  if (other.entry) {
    const e = other.entry;
    return { name: e.name, group: e.group, silhouette: e.silhouette?.file, photo: e.photo?.file, size: e.size?.[key] };
  }
  const c = other.card;
  const open = isVisible(c);
  return {
    name: c.name, group: c.group, silhouette: c.silhouette?.file, photo: open ? (c.photo ?? c.illustration)?.file : null,
    size: c.stats?.[key], href: open ? `#/card/${encodeURIComponent(c.id)}` : null, locked: !open,
  };
}

// The silhouette; without one, the photo in a frame (a group emoji could be a different
// animal, e.g. the mammals' elephant); locked or with neither, a dark frame with a "?".
function figure(m) {
  const pic = m.silhouette
    ? h('img', { class: ['cmp-look__pic', m.locked && 'is-locked'], src: m.silhouette, alt: '' })
    : m.photo
      ? h('img', { class: 'cmp-look__pic cmp-look__photo', src: thumbOf(m.photo), alt: '' })
      : h('span', { class: 'cmp-look__pic cmp-look__box', 'aria-hidden': 'true' }, '?');
  const caption = h('figcaption', null,
    h('span', { class: 'cmp-look__name' },
      m.photo && h('img', { class: 'cmp-look__thumb', src: thumbOf(m.photo), alt: '' }),
      m.locked && h('span', { class: 'cmp-look__q', 'aria-hidden': 'true' }, '?'),
      bi(m.name)),
    m.size && h('span', { class: 'cmp__num' }, bi(lengthText(m.size.min, m.size.max))),
    m.locked && h('span', { class: 'cmp__num' }, tx('compare.notYet')));
  const el = h(m.href ? 'a' : 'figure', { class: ['cmp-look__item', m.locked && 'is-locked'], href: m.href, 'data-group': m.group }, pic, caption);
  return { el, pic, m };
}

// Size the two figures so 1 cm is the same on both (once the silhouettes have loaded).
function layout(figs, measure, run) {
  if (!run.alive) return;
  const avail = cssNum('--compare-look-h');
  const colW = cssNum('--card-w') * 0.4; // each animal has half the panel
  const dims = figs.map(({ pic, m }) => {
    // Photos and "?" frames are drawn 4:3; silhouettes keep their own shape.
    const framed = pic.classList.contains('cmp-look__photo') || pic.classList.contains('cmp-look__box');
    const ratio = framed ? 0.75 : (pic.naturalHeight / pic.naturalWidth || 0.6);
    const size = mid(m.size);
    // Length and wingspan are measured across, height up and down.
    return measure === 'height' ? { w: size / ratio, h: size } : { w: size, h: size * ratio };
  });
  const known = dims.every(d => d.w > 0 && d.h > 0);
  const px = known ? Math.min(avail / Math.max(...dims.map(d => d.h)), colW / Math.max(...dims.map(d => d.w))) : null;
  figs.forEach(({ pic }, i) => {
    const w = known ? dims[i].w * px : colW * 0.6;
    pic.style.setProperty('width', `${w}px`);
    pic.animate?.([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 600, delay: i * 180, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  });
}

// The panel: pick a lookalike (if there are several), see both, and how to tell them apart.
export function lookalikePanel(card, options) {
  const el = h('div', { class: 'cmp cmp-look' });
  let run = { alive: false };
  let i = 0;
  function show(index = i) {
    i = index;
    run.alive = false;
    run = { alive: true };
    const { group, other } = options[i];
    const key = KEY[group.measure];
    const self = { ...memberOf({ card }, key), href: null }; // this card is the one open
    const figs = [figure(self), figure(memberOf(other, key))];
    const ground = h('div', { class: 'cmp-look__ground' }, figs.map(f => f.el));
    const picker = options.length > 1 && h('div', { class: 'cmp-look__pick', role: 'radiogroup' },
      options.map((o, n) => h('button', {
        type: 'button', role: 'radio', class: 'cmp-look__chip', 'aria-checked': String(n === i), onclick: () => show(n),
      }, bi(o.other.entry ? o.other.entry.name : o.other.card.name))));
    mount(el,
      picker,
      h('p', { class: 'cmp-look__group' }, bi(group.title), ' · ', tx(`compare.measure.${group.measure}`)),
      ground,
      h('div', { class: 'cmp-look__diff' },
        h('p', { class: 'cmp-look__title' }, tx('compare.tellApart')),
        h('ul', null, group.differences.map(d => h('li', null, bi(d))))));
    const r = run;
    const pending = figs.filter(f => f.pic.tagName === 'IMG' && !f.pic.complete);
    if (!pending.length) requestAnimationFrame(() => layout(figs, group.measure, r));
    else Promise.all(pending.map(f => new Promise(res => { f.pic.onload = f.pic.onerror = res; })))
      .then(() => requestAnimationFrame(() => layout(figs, group.measure, r)));
  }
  return { el, show, stop: () => { run.alive = false; } };
}

