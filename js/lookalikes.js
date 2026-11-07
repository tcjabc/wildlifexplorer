// "Animal" comparison: a card next to animals it is easily confused with, side by side at
// scale, with how to tell them apart (data/lookalikes.json). A group is defined once and
// shows on every member's card.
//   another card the profile has (or parent preview) → shown in full, tap to open it
//   another card not collected yet → a locked silhouette, as a teaser
//   a standalone entry (an animal with no card) → shown in full; tap it to see its photo
// Cards not built yet are left out, and draft groups only show in parent preview.
import { h, mount, safeUrl } from './dom.js';
import { bi, tx, label, plain } from './i18n.js';
import { state, isVisible, thumbOf } from './store.js';
import { lengthText } from './units.js';

const KEY = { length: 'lengthCm', height: 'heightCm', wingspan: 'wingspanCm' };
const mid = r => (r == null ? null : r.max == null ? r.min : (r.min + r.max) / 2);
const cssNum = (name, el = document.documentElement) => parseFloat(getComputedStyle(el).getPropertyValue(name));

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
    return { name: e.name, group: e.group, silhouette: e.silhouette?.file, size: e.size?.[key], photo: e.photo?.file ? e.photo : null };
  }
  const c = other.card;
  const open = isVisible(c);
  return {
    name: c.name, group: c.group, silhouette: c.silhouette?.file,
    size: c.stats?.[key], href: open ? `#/card/${encodeURIComponent(c.id)}` : null, locked: !open,
  };
}

// Silhouette against silhouette. An animal with no silhouette yet is a neutral outline with
// a "?", still drawn to scale (a group emoji could be a different animal, e.g. the mammals'
// elephant). Not collected yet: the silhouette (or outline) is dark.
function figure(m) {
  const pic = m.silhouette
    ? h('img', { class: ['cmp-look__pic', m.locked && 'is-locked'], src: m.silhouette, alt: '' })
    : h('span', { class: ['cmp-look__pic', 'cmp-look__box', m.locked && 'is-locked'], 'aria-hidden': 'true' }, '?');
  // A span, not a figcaption: the item is often a link or a button.
  const caption = h('span', { class: 'cmp-look__caption' },
    h('span', { class: 'cmp-look__name' },
      m.locked && h('span', { class: 'cmp-look__q', 'aria-hidden': 'true' }, '?'),
      bi(m.name),
      m.photo && h('span', { class: 'cmp-look__cam', 'aria-hidden': 'true' }, '📷')),
    m.size && h('span', { class: 'cmp__num' }, bi(lengthText(m.size.min, m.size.max))),
    m.locked && h('span', { class: 'cmp__num' }, tx('compare.notYet')));
  const attrs = { class: ['cmp-look__item', m.locked && 'is-locked'], 'data-group': m.group };
  const el = m.href ? h('a', { ...attrs, href: m.href }, pic, caption)
    : m.photo ? h('button', { ...attrs, type: 'button', 'aria-label': label('compare.seePhoto', { name: m.name }), onclick: () => photoCard(m) }, pic, caption)
      : h('figure', attrs, pic, caption);
  return { el, pic, m };
}

// A small card with a standalone lookalike's photo: name, picture and credit line.
function photoCard(m) {
  const p = m.photo;
  const lic = safeUrl(p.licenseUrl), src = safeUrl(p.sourceUrl);
  const close = () => { dialog.close(); dialog.remove(); };
  const dialog = h('dialog', { class: 'sheet look-card', 'aria-label': plain(m.name), 'data-group': m.group },
    h('h2', { class: 'sheet__title' }, bi(m.name)),
    h('img', {
      class: 'look-card__img', src: p.file, srcset: `${thumbOf(p.file)} 480w, ${p.file} 1200w`, sizes: '(min-width: 700px) 520px, 92vw',
      alt: plain(m.name),
    }),
    h('p', { class: 'look-card__credit' },
      h('span', { 'aria-hidden': 'true' }, '📷 '), p.author, ' · ',
      lic ? h('a', { href: lic, target: '_blank', rel: 'noopener' }, p.license) : p.license,
      src && ' · ', src && h('a', { href: src, target: '_blank', rel: 'noopener' }, tx('card.source'))),
    h('div', { class: 'sheet__actions' }, h('button', { class: 'btn btn--primary', type: 'button', onclick: close }, tx('card.close'))));
  // Escape closes only this card, not the card behind it; a tap outside closes it too.
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  document.body.append(dialog);
  dialog.showModal();
}

// Size the two figures so 1 cm is the same on both (once the silhouettes have loaded).
function layout(figs, measure, run) {
  if (!run.alive) return;
  const avail = cssNum('--compare-look-h', figs[0].pic); // taller on the stage
  const colW = cssNum('--card-w') * 0.4; // each animal has half the panel
  const dims = figs.map(({ pic, m }) => {
    // Outlines are drawn 4:3; silhouettes keep their own shape.
    const ratio = pic.classList.contains('cmp-look__box') ? 0.75 : (pic.naturalHeight / pic.naturalWidth || 0.6);
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

