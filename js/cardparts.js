// The pages of a Wildlife Explorer card, each built at design size (--card-w × --card-h,
// 4:5) and scaled as a whole. Every section is optional: if the data is missing it is left out.
//   front (Card)       – header, taxonomy, photo and name, Key Features, Where in the World
//   back (Fact File)   – Habitat, Breeding, Behaviour, Food & Hunting, Conservation, Did You Know?
//   open spread        – left: Profile (numbered labels on the picture); right: Vital
//                        Statistics, Creature Comparisons, Related Species
import { h, mount, safeUrl } from './dom.js';
import { bi, tx, t, label } from './i18n.js';
import { state, groupById, isVisible } from './store.js';
import { picture, statusBadge, taiwanBadge, cardNo } from './components.js';
import { worldMap } from './worldmap.js';
import { comparePanel, modesFor } from './compare.js';
import { lookalikesOf, lookalikePanel } from './lookalikes.js';
import { magnifier, featureOf } from './magnifier.js';
import { nameBi } from './zhuyin.js';
import { lengthText, weightText, imperial } from './units.js';

/**
 * The fields of a card (data/animals.json) the pages read. Pairs are { en, zh }.
 * The build moves older cards to this shape: scripts/lib/card-schema.mjs.
 * @typedef {{ en: string, zh: string }} Pair
 * @typedef {{ min: number, max?: number }} Range
 * @typedef {{ habitat: Pair[], breeding: Pair[], behaviour: Pair[], food: Pair[],
 *   conservation: Pair[], didYouKnow: Pair }} FactFile
 * @typedef {{ kind: 'gestation' | 'incubation', days?: Range, en?: string, zh?: string }} Development
 * @typedef {{ x: number, y: number, r?: number, en: string, zh: string, detail?: Pair }} Callout
 * @typedef {string | { scientificName?: string, name: Pair }} Related  card id, or an animal with no card
 * @typedef {{ id: string, group: string, number: number, scientificName: string | null, name: Pair,
 *   facts: Pair[], factFile?: FactFile, status: string | null, taiwan: boolean,
 *   profile?: { image?: 'photo' | 'illustration', callouts: Callout[] },
 *   stats?: { development?: Development, youngCount?: Range, young?: Pair, [k: string]: any },
 *   related?: Related[], taxonomy?: Record<string, { sci: string, en: string, zh: string }> }} Card
 */

const filled = p => p && (p.en || p.zh);
export const factsOf = card => (card.facts ?? []).filter(filled);

// The Fact File, in the order it is shown.
export const FACT_SECTIONS = [['habitat', '🌏'], ['breeding', '👪'], ['behaviour', '🐾'], ['food', '🍽️'], ['conservation', '🛡️']];
export const factParas = (card, key) => (card.factFile?.[key] ?? []).filter(filled);
const didYouKnow = card => (filled(card.factFile?.didYouKnow) ? card.factFile.didYouKnow : null);

const hasMap = c => Boolean(c.map?.areas?.length || c.range || c.mapBounds);
export const relatedOf = c => (c.related ?? []).map(r => (typeof r === 'string'
  ? (state.byId.has(r) ? { card: state.byId.get(r) } : null) // cards not built yet are left out
  : (filled(r?.name) ? { entry: r } : null))).filter(Boolean);

export const hasProfile = c => Boolean(c.profile?.callouts?.length && c[c.profile.image ?? 'photo']?.file);
export const hasStats = c => Boolean(c.stats && Object.keys(c.stats).length);
export const hasCompare = c => Object.values(modesFor(c)).some(Boolean) || lookalikesOf(c).length > 0;
export const hasInside = c => hasProfile(c) || hasStats(c) || hasCompare(c) || relatedOf(c).length > 0;
const hasFactText = c => FACT_SECTIONS.some(([k]) => factParas(c, k).length > 0) || Boolean(didYouKnow(c));
// Every card with a Fact File turns over (until it has text, it says more is coming);
// topic cards only when they have something to show.
export const hasBack = c => Boolean(c.factFile || hasFactText(c) || hasMap(c));
const comingSoonKey = c => (c.group === 'plants' ? 'ff.comingSoonPlant' : 'ff.comingSoon');

const groupChip = g => h('span', { class: 'chip chip--group', 'data-group': g.id },
  h('span', { 'aria-hidden': 'true' }, g.emoji), bi(g.name));

const pageTitle = (key, icon) => h('h2', { class: 'cpage__heading' }, h('span', { 'aria-hidden': 'true' }, icon), tx(key));
const smallTitle = key => h('h2', { class: 'cpage__label' }, tx(key));

// An empty page still looks like card paper, with the group emoji as a watermark.
const blank = card => h('div', { class: 'cpage__blank', 'aria-hidden': 'true' }, groupById(card.group)?.emoji);

// Glossary hook: every Fact File text goes through here. Today it is the plain pair; the
// glossary will mark its terms inside [data-glossary] paragraphs.
export const glossed = pair => h('p', { class: 'ff__text', 'data-glossary': '' }, bi(pair));

// The series the card arrives in (data/drops.json), or null.
export const seriesOf = card => state.drops.find(d => d.cards.some(c => c.id === card.id))?.series ?? null;

function headerStrip(card, start) {
  const series = seriesOf(card);
  return h('div', { class: 'cover__top' },
    start,
    h('span', { class: 'cover__meta' },
      series != null && h('span', { class: 'series-badge', role: 'img', 'aria-label': label('card.series', { n: series }) },
        t('card.seriesShort', { n: series }).en),
      h('span', { class: 'cover__no' }, cardNo(card.number))));
}

// Order · Family · Genus species (Chinese names beside them in Chinese modes).
function taxStrip(card) {
  const tax = card.taxonomy ?? {};
  const part = (key, sci, zh) => h('span', { class: 'tax__item', title: label(key) },
    h('i', { lang: 'la' }, sci), zh && h('span', { class: 't-zh tax__zh', lang: 'zh-Hant-TW' }, zh));
  const items = [
    tax.order?.sci && part('card.order', tax.order.sci, tax.order.zh),
    tax.family?.sci && part('card.family', tax.family.sci, tax.family.zh),
    card.scientificName && part('card.genusSpecies', card.scientificName),
  ].filter(Boolean);
  return items.length ? h('p', { class: 'cover__tax', 'aria-label': label('card.taxonomy') }, items) : null;
}

export function coverPage(card, { onCredit } = {}) {
  const g = groupById(card.group);
  const facts = factsOf(card);
  const img = card.photo ?? card.illustration;
  const kind = card.photo ? 'photo' : 'illustration';
  return h('div', { class: 'cpage cpage--cover', 'data-group': card.group },
    headerStrip(card, groupChip(g)),
    taxStrip(card),
    h('div', { class: 'cover__photo' },
      picture(card, { kind: img ? kind : undefined }),
      img && h('button', {
        class: 'cover__credit', type: 'button', 'aria-label': label('card.credit'),
        onclick: () => onCredit?.(kind),
      }, kind === 'photo' ? '📷' : '🎨')),
    h('div', { class: 'cover__names' }, h('h1', { class: 'cover__name' }, nameBi(card.name, 'bi--cover'))),
    h('div', { class: 'cover__bottom' },
      facts.length > 0 && h('section', { class: 'cover__features' },
        smallTitle(card.scientificName ? 'card.keyFeatures' : 'card.about'),
        h('ol', { class: 'cover__facts' }, facts.slice(0, 3).map(f => h('li', null, bi(f))))),
      h('section', { class: 'cover__side' },
        smallTitle('card.where'),
        // The corner slot is kept free for the map's expand button (next prompt).
        h('div', { class: 'cover__map' }, worldMap(card, { label: label('card.where') }),
          h('span', { class: 'cover__map-slot', 'aria-hidden': 'true' })),
        h('div', { class: 'cover__badges' }, statusBadge(card.status), card.taiwan && taiwanBadge()))));
}

// Left page of the open spread. Numbered labels sit on the picture; tap one to ring it,
// see it through the magnifier and read about it in the box underneath. Tap it again, or the
// picture, to close. (A sideways drag anywhere on the page closes the card: viewer.js.)
export function profilePage(card) {
  if (!hasProfile(card)) return h('div', { class: 'cpage cpage--profile' }, blank(card));
  const kind = card.profile.image ?? 'photo';
  const callouts = card.profile.callouts;
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

  return h('div', { class: 'cpage cpage--profile', 'data-group': card.group },
    pageTitle('card.profile', '🔍'), pic, detail);
}

const range = r => (r.max == null || r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);

// Text for a statistic: written text ({ en, zh }), or made from the numbers. In imperial
// units, lengths and weights are always made from the numbers (the text is metric).
function statText(stat, nums, unit) {
  const r = nums ?? (stat?.min != null ? stat : null);
  const convert = imperial() && r && (unit === 'cm' || unit === 'kg');
  if (filled(stat) && !convert) return stat;
  if (!r) return null;
  if (unit === 'cm') return lengthText(r.min, r.max);
  if (unit === 'kg') return weightText(r.min, r.max);
  if (!unit) return { en: range(r), zh: range(r) };
  const u = t(`unit.${unit}`);
  return { en: `${range(r)} ${u.en}`, zh: `${range(r)} ${u.zh}` };
}

// Gestation or incubation: the label comes from its kind.
const DEV = { gestation: ['card.gestation', '🍼'], incubation: ['card.incubation', '🥚'] };
function devRow(s) {
  const d = s.development;
  if (!DEV[d?.kind]) return null;
  const text = filled(d) ? { en: d.en ?? '', zh: d.zh ?? '' } : statText(null, d.days, 'days');
  return text && { mode: 'development', icon: DEV[d.kind][1], key: DEV[d.kind][0], text };
}

const STAT_ROWS = [
  ['length', '📏', 'card.length', 'lengthCm', 'cm'],
  ['weight', '⚖️', 'card.weight', 'weightKg', 'kg'],
  ['lifespan', '⏳', 'card.lifespan', 'lifespanYears', 'years'],
  ['diet', '🍽️', 'card.diet'],
];

function statRows(s) {
  const rows = STAT_ROWS.map(([mode, icon, key, numKey, unit]) => {
    const text = mode === 'diet' ? (filled(s.diet) ? s.diet : null) : statText(s[mode], s[numKey], unit);
    return text && { mode, icon, key, text, note: s[mode]?.note };
  });
  const young = statText(s.young, s.youngCount, null);
  return [...rows, devRow(s), young && { mode: 'young', icon: '🐣', key: 'card.young', text: young }].filter(Boolean);
}

// Related species: a card you have (tap to open), a card not collected yet (a locked
// silhouette), or an animal with no card (a small entry with its names).
function relatedItem(r) {
  if (r.entry) {
    return h('li', { class: 'related__item related__item--entry' },
      h('span', { class: 'related__pic related__pic--entry', 'aria-hidden': 'true' }, '📖'),
      h('span', { class: 'related__name' }, bi(r.entry.name),
        r.entry.scientificName && h('i', { class: 'related__sci', lang: 'la' }, r.entry.scientificName)));
  }
  const c = r.card;
  if (isVisible(c)) {
    return h('li', null, h('a', { class: 'related__item', href: `#/card/${encodeURIComponent(c.id)}`, 'data-group': c.group },
      h('span', { class: 'related__pic' }, picture(c, { thumb: true })),
      h('span', { class: 'related__name' }, bi(c.name))));
  }
  return h('li', { class: 'related__item is-locked', 'data-group': c.group, 'aria-label': label('compare.notYet') },
    h('span', { class: 'related__pic', 'aria-hidden': 'true' },
      c.silhouette?.file ? h('img', { class: 'related__shape', src: c.silhouette.file, alt: '' }) : groupById(c.group)?.emoji,
      h('span', { class: 'related__q' }, '?')),
    h('span', { class: 'related__name' }, tx('compare.notYet')));
}

// The inside right page: Vital Statistics, then Creature Comparisons. "You" compares with
// whichever statistic was tapped last; "Animal" (only when the card has lookalikes) shows
// the animal next to its lookalikes. Then Related Species. replay() runs the animation again.
export function insidePage(card) {
  const s = card.stats ?? {};
  const modes = modesFor(card);
  const panel = comparePanel(card);
  let current = STAT_ROWS.map(r => r[0]).find(m => modes[m]) ?? null;

  const rows = statRows(s).map(({ mode, icon, key, text, note }) => {
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
  });

  const looks = lookalikesOf(card);
  const animal = looks.length ? lookalikePanel(card, looks) : null;
  const you = current && h('div', { class: 'cview' }, panel.el);
  const others = animal && h('div', { class: 'cview' }, animal.el);
  let view = you ? 'you' : others ? 'animal' : null;
  const toggle = !(you && others) ? null : h('div', { class: 'cmp-toggle', role: 'radiogroup', 'aria-label': label('compare.with') },
    [['you', 'compare.you', '🧒'], ['animal', 'compare.animal', '🐾']].map(([v, key, icon]) => h('button', {
      type: 'button', role: 'radio', class: 'cmp-toggle__btn', 'data-view': v, 'aria-checked': String(view === v),
      onclick: () => setView(v),
    }, h('span', { 'aria-hidden': 'true' }, icon), tx(key))));

  function select(mode) {
    current = mode;
    rows.forEach(r => {
      if (!r.dataset.mode) return;
      const on = r.dataset.mode === mode;
      r.classList.toggle('is-on', on);
      r.setAttribute('aria-pressed', String(on));
    });
    if (view !== 'you') setView('you'); else panel.show(mode);
  }

  function setView(v) {
    view = v;
    toggle?.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.view === v)));
    if (you) you.hidden = v !== 'you';
    if (others) others.hidden = v !== 'animal';
    if (v === 'animal') animal.show(); else { animal?.stop(); if (current) panel.show(current); }
  }

  const related = relatedOf(card);
  const empty = !rows.length && !view && !related.length;
  const body = !empty && h('div', { class: 'cpage__scroll', 'data-scroll': '' },
    rows.length > 0 && h('section', { class: 'csection csection--stats' },
      pageTitle('card.stats', '📏'),
      current && h('p', { class: 'stat__hint' }, tx('compare.tapHint')),
      rows),
    view && h('section', { class: 'csection csection--compare' }, pageTitle('card.compare', '🧒'), toggle, you, others),
    related.length > 0 && h('section', { class: 'csection csection--related' },
      pageTitle('card.related', '🧬'),
      h('ul', { class: 'related' }, related.map(relatedItem))));
  const el = h('div', { class: 'cpage cpage--inside', 'data-group': card.group }, empty ? blank(card) : body);
  if (view) setView(view);
  return { el, replay: () => { if (view) setView(view); } };
}

// The Fact File. Its body scrolls inside the card; the frame never grows. With no text yet:
// the Habitat heading and the range map (if there is one), and a line saying more is coming.
export function backPage(card) {
  if (!hasBack(card)) return h('div', { class: 'cpage cpage--back' }, blank(card));
  const soon = !hasFactText(card) && h('p', { class: 'ff__soon' },
    h('span', { class: 'ff__soon-icon', 'aria-hidden': 'true' }, groupById(card.group)?.emoji), tx(comingSoonKey(card)));
  const sections = FACT_SECTIONS.map(([key, icon]) => {
    const paras = factParas(card, key);
    const map = key === 'habitat' && hasMap(card);
    if (!paras.length && !map) return null;
    return h('section', { class: 'csection ff__section', 'data-section': key },
      pageTitle(`ff.${key}`, icon),
      map && worldMap(card, { detail: true, label: label('card.where') }),
      paras.map(glossed));
  });
  const dyk = didYouKnow(card);
  return h('div', { class: 'cpage cpage--back', 'data-group': card.group },
    headerStrip(card, h('span', { class: 'ff__title' }, h('span', { 'aria-hidden': 'true' }, '📁'), tx('card.factFile'))),
    h('div', { class: 'cpage__scroll ff__body', 'data-scroll': '', tabindex: '0', 'aria-label': label('card.factFile') },
      sections,
      soon,
      dyk && h('aside', { class: 'ff__dyk' },
        h('p', { class: 'ff__dyk-title' }, h('span', { 'aria-hidden': 'true' }, '💡'), tx('ff.didYouKnow')),
        glossed(dyk))));
}

// What read-aloud says on each view ('front', 'open', 'back'), in reading order.
export function readOrder(card, view) {
  if (view === 'back') {
    if (!hasBack(card)) return [];
    if (!hasFactText(card)) return [t(comingSoonKey(card))];
    const out = [];
    for (const [key] of FACT_SECTIONS) {
      const paras = factParas(card, key);
      if (paras.length) out.push(t(`ff.${key}`), ...paras);
    }
    const dyk = didYouKnow(card);
    if (dyk) out.push(t('ff.didYouKnow'), dyk);
    return out;
  }
  if (view === 'open') {
    // Every Profile feature in order, with its detail; then the diet.
    const out = [];
    (card.profile?.callouts ?? []).forEach(c => { out.push(c); if (filled(c.detail)) out.push(c.detail); });
    const diet = card.stats?.diet;
    if (filled(diet)) out.push(t('card.diet'), diet);
    return out;
  }
  return [card.name, ...factsOf(card)];
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
