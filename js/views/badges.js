// Badges: group badges, continent and habitat badges with their tiers, and secret badges
// (only the ones found; the rest stay hidden).
import { h, mount } from '../dom.js';
import { bi, tx, dateText } from '../i18n.js';
import { state, progress, badgeList, isCollected } from '../store.js';
import { regionProgress, REGION_KINDS } from '../badges.js';
import { medal } from '../celebrate.js';

const item = (m, name, sub, href) => h('li', { class: 'medal-item' },
  href ? h('a', { class: 'medal-item__link', href }, m) : m,
  h('span', { class: 'medal-item__name' }, bi(name)),
  h('span', { class: 'medal-item__sub' }, sub));

const section = (titleKey, icon, items) => h('section', { class: 'medal-section' },
  h('h2', { class: 'panel__title' }, h('span', { 'aria-hidden': 'true' }, `${icon} `), tx(titleKey)),
  h('ul', { class: 'medals' }, items));

// A medal that isn't earned yet: grey, with the emoji faded.
const greyMedal = b => h('div', { class: 'medal' }, h('span', { 'aria-hidden': 'true' }, b.emoji));

export function render(main) {
  const all = badgeList();
  const ctx = { cards: state.cards, isCollected, byId: state.byId };

  const groups = all.filter(b => b.kind === 'group').map(b => {
    const earned = state.badges[b.id];
    return item(earned ? medal(b) : greyMedal(b), b.name,
      earned ? tx('badge.earnedOn', { date: dateText(earned) }) : tx('badge.progress', progress(b.ref)), `#/binder/${b.ref}`);
  });

  const regions = kind => state.regions[REGION_KINDS.find(([k]) => k === kind)[1]].map(r => {
    const p = regionProgress(all, kind, r.id, ctx);
    const b = { kind, ref: r.id, emoji: r.emoji };
    const m = p.current ? medal(b, { tier: p.current.tier }) : greyMedal(b);
    const sub = p.next
      ? tx('badge.tierNext', { tier: p.next.tierName, n: p.n, need: p.next.need })
      : tx('badge.tierTop', { tier: p.current.tierName });
    return item(m, r.name, h('span', null, p.current && h('span', { class: 'medal-item__tier' }, bi(p.current.tierName)), sub));
  });

  const found = all.filter(b => b.kind === 'secret' && state.badges[b.id])
    .map(b => item(medal(b), b.title, tx('badge.earnedOn', { date: dateText(state.badges[b.id]) })));
  const secrets = [...found, h('li', { class: 'medal-item' },
    h('div', { class: 'medal medal--secret' }, h('span', { 'aria-hidden': 'true' }, '?')),
    h('span', { class: 'medal-item__sub' }, tx('badge.secretHint')))];

  mount(main, h('section', { class: 'page badges' },
    h('h1', { class: 'page__title' }, h('span', { 'aria-hidden': 'true' }, '🏅'), tx('badge.title')),
    h('p', { class: 'muted' }, tx('badge.hint')),
    section('badge.groups', '📒', groups),
    section('badge.continents', '🌏', regions('continent')),
    section('badge.biomes', '🌲', regions('biome')),
    section('badge.secrets', '🤫', secrets)));
}
