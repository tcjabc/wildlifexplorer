// The pages of a bi-fold Wildlife Explorer card, built at design size (--card-w × --card-h)
// and scaled as a whole. Every section is optional: if the data is missing it is left out.
import { h, safeUrl } from './dom.js';
import { bi, tx, t, label } from './i18n.js';
import { groupById } from './store.js';
import { picture, statusBadge, taiwanBadge, cardNo } from './components.js';
import { worldMap } from './worldmap.js';
import { comparePanel, modesFor } from './compare.js';
import { magnifier } from './magnifier.js';
import { track, haptic } from './gesture.js';

const filled = p => p && (p.en || p.zh);
export const factsOf = card => (card.facts ?? []).filter(filled);

export const hasProfile = c => Boolean(c.profile?.callouts?.length && c[c.profile.image ?? 'photo']?.file);
export const hasStats = c => Boolean(c.stats && Object.keys(c.stats).length);
export const hasCompare = c => Object.values(modesFor(c)).some(Boolean);
export const hasInside = c => hasProfile(c) || hasStats(c) || hasCompare(c);
const hasMap = c => Boolean(c.map?.areas?.length || c.range || c.mapBounds);
export const hasBack = c => Boolean(c.lifeCycle?.length || filled(c.habitat) || hasMap(c));

const groupChip = g => h('span', { class: 'chip chip--group', 'data-group': g.id },
  h('span', { 'aria-hidden': 'true' }, g.emoji), bi(g.name));

const pageTitle = (key, icon) => h('h2', { class: 'cpage__heading' }, h('span', { 'aria-hidden': 'true' }, icon), tx(key));

// An empty page still looks like card paper, with the group emoji as a watermark.
const blank = card => h('div', { class: 'cpage__blank', 'aria-hidden': 'true' }, groupById(card.group)?.emoji);

export function coverPage(card, { onCredit } = {}) {
  const g = groupById(card.group);
  const facts = factsOf(card);
  const img = card.photo ?? card.illustration;
  const kind = card.photo ? 'photo' : 'illustration';
  return h('div', { class: 'cpage cpage--cover', 'data-group': card.group },
    h('div', { class: 'cover__top' }, groupChip(g), h('span', { class: 'cover__no' }, cardNo(card.number))),
    h('div', { class: 'cover__photo' },
      picture(card, { kind: img ? kind : undefined }),
      img && h('button', {
        class: 'cover__credit', type: 'button', 'aria-label': label('card.credit'),
        onclick: () => onCredit?.(kind),
      }, kind === 'photo' ? '📷' : '🎨')),
    h('div', { class: 'cover__names' },
      h('h1', { class: 'cover__name' }, bi(card.name, 'bi--cover')),
      card.scientificName && h('p', { class: 'cover__sci', lang: 'la' }, card.scientificName)),
    h('div', { class: 'cover__bottom' },
      facts.length > 0 && h('ol', { class: 'cover__facts' }, facts.slice(0, 3).map(f => h('li', null, bi(f)))),
      h('div', { class: 'cover__side' },
        worldMap(card, { label: label('card.where') }),
        h('div', { class: 'cover__badges' }, statusBadge(card.status), card.taiwan && taiwanBadge()))));
}

// The photo stays clean. Tap a feature in the list to see it through a magnifier; tap it
// again, or the photo, to close; tap another to switch; swipe the list to step through.
export function profilePage(card) {
  if (!hasProfile(card)) return h('div', { class: 'cpage cpage--profile' }, blank(card));
  const kind = card.profile.image ?? 'photo';
  const callouts = card.profile.callouts;
  const pic = h('div', { class: 'profile__pic' }, picture(card, { kind }));
  const loupe = magnifier(pic, card[kind].file, callouts);

  const items = callouts.map((c, i) => h('li', null,
    h('button', { class: 'callouts__item', type: 'button', 'aria-pressed': 'false', onclick: () => pick(i) },
      h('span', { class: 'callouts__no', 'aria-hidden': 'true' }, String(i + 1)), bi(c))));
  const pick = i => {
    loupe.show(i);
    const on = loupe.current();
    items.forEach((li, n) => {
      li.classList.toggle('is-lit', n === on);
      li.firstChild.setAttribute('aria-pressed', String(n === on));
    });
  };
  pic.addEventListener('click', () => pick(null));

  // Swipe along the list (either way) to move to the next or previous feature.
  const list = h('ol', { class: 'callouts', 'data-swipe': true }, items);
  let axis = null;
  track(list, {
    lock: ({ axis: a }) => { axis = a; return true; },
    end: ({ dx, dy }) => {
      const d = axis === 'x' ? dx : dy;
      if (Math.abs(d) < 30) return;
      const cur = loupe.current();
      const step = d < 0 ? 1 : -1;
      const next = cur === null ? (step > 0 ? 0 : callouts.length - 1) : (cur + step + callouts.length) % callouts.length;
      haptic(6);
      pick(next);
    },
  });

  const tax = card.taxonomy;
  return h('div', { class: 'cpage cpage--profile', 'data-group': card.group },
    pageTitle('card.profile', '🔍'),
    pic,
    h('p', { class: 'stat__hint' }, tx('card.profileHint')),
    list,
    tax && h('p', { class: 'profile__tax' },
      ['class', 'order', 'family'].filter(r => tax[r]).map(r =>
        h('span', null, tx(`card.${r}`, {}, 'bi--inline'), ' ', h('i', { lang: 'la' }, tax[r].sci)))));
}

const range = r => (r.max == null || r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);

// Text for a statistic: written text ({ en, zh }), or made from the numbers.
function statText(stat, nums, unit) {
  if (filled(stat)) return stat;
  const r = nums ?? (stat?.min != null ? stat : null);
  if (!r) return null;
  const u = t(`unit.${unit}`);
  return { en: `${range(r)} ${u.en}`, zh: `${range(r)} ${u.zh}` };
}

const STAT_ROWS = [
  ['length', '📏', 'card.length', 'lengthCm', 'cm'],
  ['weight', '⚖️', 'card.weight', 'weightKg', 'kg'],
  ['lifespan', '⏳', 'card.lifespan', 'lifespanYears', 'years'],
  ['diet', '🍽️', 'card.diet'],
];

// The inside right page: vital statistics, and a comparison that follows whichever
// statistic was tapped last. replay() runs the current comparison's animation again.
export function insidePage(card) {
  const s = card.stats ?? {};
  const modes = modesFor(card);
  const panel = comparePanel(card);
  let current = STAT_ROWS.map(r => r[0]).find(m => modes[m]) ?? null;

  const rows = STAT_ROWS.map(([mode, icon, key, numKey, unit]) => {
    const text = mode === 'diet' ? (filled(s.diet) ? s.diet : null) : statText(s[mode], s[numKey], unit);
    if (!text) return null;
    const note = s[mode]?.note;
    const content = [
      h('span', { class: 'stat__icon', 'aria-hidden': 'true' }, icon),
      h('span', { class: 'stat__label' }, tx(key)),
      h('span', { class: 'stat__value' }, bi(text), note && h('span', { class: 'stat__note' }, bi(note))),
    ];
    if (!modes[mode]) return h('div', { class: 'stat' }, content);
    return h('button', {
      class: ['stat', 'stat--pick', mode === current && 'is-on'], type: 'button', 'data-mode': mode,
      'aria-pressed': String(mode === current),
      onclick: () => select(mode),
    }, content, h('span', { class: 'stat__go', 'aria-hidden': 'true' }, '›'));
  }).filter(Boolean);

  const select = mode => {
    current = mode;
    rows.forEach(r => {
      if (!r.dataset.mode) return;
      const on = r.dataset.mode === mode;
      r.classList.toggle('is-on', on);
      r.setAttribute('aria-pressed', String(on));
    });
    panel.show(mode);
  };

  const el = h('div', { class: 'cpage cpage--inside', 'data-group': card.group },
    rows.length > 0 && h('section', { class: 'csection csection--stats' },
      pageTitle('card.stats', '📏'),
      current && h('p', { class: 'stat__hint' }, tx('compare.tapHint')),
      rows),
    current && h('section', { class: 'csection csection--compare' }, pageTitle('card.compare', '🧒'), panel.el),
    !rows.length && !current && blank(card));
  if (current) panel.show(current);
  return { el, replay: () => { if (current) panel.show(current); } };
}

export function backPage(card) {
  if (!hasBack(card)) return h('div', { class: 'cpage cpage--back' }, blank(card));
  return h('div', { class: 'cpage cpage--back', 'data-group': card.group },
    card.lifeCycle?.length > 0 && h('section', { class: 'csection' },
      pageTitle('card.lifeCycle', '🔄'),
      h('ol', { class: 'cycle' }, card.lifeCycle.map(step => h('li', null, bi(step))))),
    (filled(card.habitat) || hasMap(card)) && h('section', { class: 'csection' },
      pageTitle('card.habitat', '🌏'),
      worldMap(card, { detail: true, label: label('card.where') }),
      filled(card.habitat) && h('p', { class: 'back__habitat' }, bi(card.habitat))),
    h('div', { class: 'back__badges' }, statusBadge(card.status), card.taiwan && taiwanBadge()));
}

// Every picture used on this card, for the credit sheet.
export function cardCredits(card) {
  const rows = [
    ['photo', 'card.photo'], ['illustration', 'card.illustration'], ['silhouette', 'credits.silhouette'],
  ].filter(([k]) => card[k]?.file).map(([k, key]) => {
    const img = card[k];
    const href = safeUrl(img.sourceUrl);
    const lic = safeUrl(img.licenseUrl);
    return h('li', null,
      h('strong', null, tx(key)), ' ',
      img.author, ' · ',
      lic ? h('a', { href: lic, target: '_blank', rel: 'noopener' }, img.license) : img.license,
      href && ' · ',
      href && h('a', { href, target: '_blank', rel: 'noopener' }, tx('card.source')));
  });
  return h('ul', { class: 'card-credits' }, rows,
    hasMap(card) && h('li', null, tx('credits.map')),
    card.range && h('li', null, tx('credits.gbif')));
}
