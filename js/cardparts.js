// The parts of a Wildlife Explorer card. The cover is built at design size (--card-w × --card-h,
// 4:5) and scaled as a whole; the open card (js/card-open.js) is made of the rest. Every section is
// optional: if the data is missing it is left out.
import { h, safeUrl } from './dom.js';
import { bi, tx, t, label } from './i18n.js';
import { state, groupById, isVisible } from './store.js';
import { picture, statusBadge, taiwanBadge, cardNo } from './components.js';
import { worldMap } from './worldmap.js';
import { opensGlobe } from './card-return.js';
import { hasCall, hasMap } from './headings.js';
import { nameBi } from './zhuyin.js';
import { glossBi } from './glossary.js';
import { lengthText, weightText, imperial } from './units.js';

/**
 * The fields of a card (data/animals.json) the pages read. Pairs are { en, zh }.
 * The build moves older cards to this shape: scripts/lib/card-schema.mjs.
 * @typedef {{ en: string, zh: string }} Pair
 * @typedef {{ min: number, max?: number }} Range
 * @typedef {{ en: string, zh: string, todo?: string }} Paragraph  todo: not checked yet, grown-up preview only
 * @typedef {{ habitat: Paragraph[], breeding: Paragraph[], behaviour: Paragraph[],
 *   foodAndHunting: Paragraph[], conservation: Paragraph[], didYouKnow: Paragraph[] }} FactFile
 *   Text may mark glossary terms: [[id]] or [[id|shown text]] (js/glossary.js).
 * @typedef {{ kind: 'gestation' | 'incubation', days?: Range, en?: string, zh?: string, todo?: string }} Development
 * @typedef {{ x: number, y: number, r?: number, en: string, zh: string, detail?: Pair }} Callout
 * @typedef {string | { scientificName?: string, name: Pair }} Related  card id, or an animal with no card
 * @typedef {{ id: string, group: string, number: number, scientificName: string | null, name: Pair,
 *   facts: Pair[], factFile?: FactFile, status: string | null, taiwan: boolean,
 *   profile?: { image?: 'photo' | 'illustration', callouts: Callout[] },
 *   stats?: { development?: Development, youngCount?: Range, young?: Pair, [k: string]: any },
 *   related?: Related[], taxonomy?: Record<string, { sci: string, en: string, zh: string }>,
 *   stage?: Record<string, string>, factHeadings?: string[],
 *   compare?: { width?: number, height?: number, partners?: string[], silhouette?: object, counted?: object, noCount?: boolean },
 *   call?: { file: string, author: string, license: string, licenseUrl: string, sourceUrl: string },
 *   narration?: Record<string, { en?: string, zh?: string }> }} Card
 *   stage: a heading's stage view, where it isn't the usual one (js/headings.js).
 *   factHeadings: a topic card's heading for each of its facts, in order (js/headings.js).
 *   call: the animal's call, played by tapping its picture (js/card-call.js). None yet.
 *   compare: how the creature comparison draws it (README, "compare").
 *   narration: a recording to play when a heading is tapped (js/headings.js). None yet.
 */

const filled = p => p && (p.en || p.zh);
export const factsOf = card => (card.facts ?? []).filter(filled);

// Text marked "todo" hasn't been checked yet: only grown-ups see it (parent preview).
export const preview = () => Boolean(state.profile?.parent.preview);

export const relatedOf = c => (c.related ?? []).map(r => (typeof r === 'string'
  ? (state.byId.has(r) ? { card: state.byId.get(r) } : null) // cards not built yet are left out
  : (filled(r?.name) ? { entry: r } : null))).filter(Boolean);

export const comingSoonKey = c => (c.group === 'plants' ? 'ff.comingSoonPlant' : 'ff.comingSoon');

export const groupChip = g => h('span', { class: 'chip chip--group', 'data-group': g.id },
  h('span', { 'aria-hidden': 'true' }, g.emoji), bi(g.name));

const smallTitle = key => h('h2', { class: 'cpage__label' }, tx(key));

// Every text under a heading goes through here: glossary terms become buttons (js/glossary.js);
// a paragraph still to check is marked for the grown-up who sees it.
export const glossed = pair => h('p', { class: ['ff__text', pair.todo && 'is-todo'], 'data-glossary': '', title: pair.todo || null },
  glossBi(pair));

// The series the card arrives in (data/drops.json), or null.
export const seriesOf = card => state.drops.find(d => d.cards.some(c => c.id === card.id))?.series ?? null;

export function headerStrip(card, start) {
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

// A card's map, as a button that opens the globe at its range (onMap): the whole map is the
// button, with a small globe in its top corner. Only for cards with a range file, and only
// where the card is open in the viewer (not in a pack reveal). It is a plain button inside
// the card, so the card's gestures still win a drag that starts on it (js/gesture.js lets the
// click through only for a tap).
export function mapButton(card, map, onMap, cls) {
  if (!map || !opensGlobe(card, onMap)) return null;
  return h('button', { class: ['map-open', cls], type: 'button', 'aria-label': label('card.mapToGlobe'), onclick: () => onMap(card) },
    map, h('span', { class: 'map-open__icon', 'aria-hidden': 'true' }, '🌏'));
}

// A picture that plays the animal's call when tapped, if it has one and the viewer is listening.
// Its own buttons (the credit, the photo or illustration) stay theirs.
export function callable(card, el, onCall) {
  if (!onCall || !hasCall(card)) return el;
  el.classList.add('has-call');
  el.addEventListener('click', e => { if (!e.target.closest('button')) onCall(card); });
  return el;
}

export function coverPage(card, { onCredit, onMap, onCall } = {}) {
  const g = groupById(card.group);
  const facts = factsOf(card);
  const img = card.photo ?? card.illustration;
  const kind = card.photo ? 'photo' : 'illustration';
  return h('div', { class: 'cpage cpage--cover', 'data-group': card.group },
    headerStrip(card, groupChip(g)),
    taxStrip(card),
    callable(card, h('div', { class: 'cover__photo' },
      picture(card, { kind: img ? kind : undefined }),
      img && h('button', {
        class: 'cover__credit', type: 'button', 'aria-label': label('card.credit'),
        onclick: () => onCredit?.(kind),
      }, kind === 'photo' ? '📷' : '🎨')), onCall),
    h('div', { class: 'cover__names' }, h('h1', { class: 'cover__name' }, nameBi(card.name, 'bi--cover'))),
    h('div', { class: 'cover__bottom' },
      facts.length > 0 && h('section', { class: 'cover__features' },
        smallTitle(card.scientificName ? 'card.keyFeatures' : 'card.about'),
        h('ol', { class: 'cover__facts' }, facts.slice(0, 3).map(f => h('li', null, bi(f))))),
      h('section', { class: 'cover__side' },
        smallTitle('card.where'),
        // The corner slot holds the small globe when the map opens the globe.
        mapButton(card, worldMap(card, { label: label('card.where') }), onMap, 'cover__map')
          ?? h('div', { class: 'cover__map' }, worldMap(card, { label: label('card.where') }),
            h('span', { class: 'cover__map-slot', 'aria-hidden': 'true' })),
        h('div', { class: 'cover__badges' }, statusBadge(card.status), card.taiwan && taiwanBadge()))));
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
  if (!DEV[d?.kind] || (d.todo && !preview())) return null;
  const text = filled(d) ? { en: d.en ?? '', zh: d.zh ?? '' } : statText(null, d.days, 'days');
  return text && { mode: 'development', icon: DEV[d.kind][1], key: DEV[d.kind][0], text };
}

// "Gestation" / "Incubation" as a glossary term when the glossary has it.
const glossLabel = (key, id) => { const l = t(key); return state.glossary?.[id] ? { en: `[[${id}|${l.en}]]`, zh: `[[${id}|${l.zh}]]` } : l; };

const STAT_ROWS = [
  ['length', '📏', 'card.length', 'lengthCm', 'cm'],
  ['height', '📏', 'card.height', 'heightCm', 'cm'],
  ['wingspan', '📏', 'card.wingspan', 'wingspanCm', 'cm'],
  ['weight', '⚖️', 'card.weight', 'weightKg', 'kg'],
  ['lifespan', '⏳', 'card.lifespan', 'lifespanYears', 'years'],
  ['diet', '🍽️', 'card.diet'],
];

// The statistics a card has: [{ mode, icon, key, text, note }].
export function statRows(card) {
  const s = card.stats ?? {};
  const rows = STAT_ROWS.map(([mode, icon, key, numKey, unit]) => {
    const text = mode === 'diet' ? (filled(s.diet) ? s.diet : null) : statText(s[mode], s[numKey], unit);
    // A tree's height has its own word in Chinese.
    const name = mode === 'height' && card.group === 'plants' ? 'card.treeHeight' : key;
    return text && { mode, icon, key: name, text, note: s[mode]?.note };
  });
  const young = s.youngCount?.todo && !preview() ? null : statText(s.young, s.youngCount, null);
  return [...rows, devRow(s), young && { mode: 'young', icon: '🐣', key: 'card.young', text: young }].filter(Boolean);
}

// A statistic's three columns.
export const statCells = (card, { mode, icon, key, text, note }) => [
  h('span', { class: 'stat__icon', 'aria-hidden': 'true' }, icon),
  h('span', { class: 'stat__label' }, mode === 'development' ? glossBi(glossLabel(key, card.stats.development.kind)) : tx(key)),
  h('span', { class: 'stat__value' }, bi(text), note && h('span', { class: 'stat__note' }, bi(note))),
];

// Related species: a card you have (tap to open), a card not collected yet (a locked
// silhouette), or an animal with no card (a small entry with its names).
export function relatedItem(r) {
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

// Every picture used on this card, for the credit sheet.
export function cardCredits(card) {
  const rows = [
    ['photo', 'card.photo'], ['illustration', 'card.illustration'], ['silhouette', 'credits.silhouette'], ['call', 'credits.call'], ['compare', 'credits.silhouette'],
  ].filter(([k]) => (k === 'compare' ? card.compare?.silhouette : card[k])?.file).map(([k, key]) => {
    const img = k === 'compare' ? card.compare.silhouette : card[k];
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
