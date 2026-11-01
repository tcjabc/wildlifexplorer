// The pages of a bi-fold Wildlife Explorer card, built at design size (--card-w × --card-h)
// and scaled as a whole. Every section is optional: if the data is missing it is left out.
import { h, safeUrl } from './dom.js';
import { bi, tx, t, label } from './i18n.js';
import { groupById } from './store.js';
import { picture, statusBadge, taiwanBadge, cardNo } from './components.js';
import { worldMap } from './worldmap.js';

const filled = p => p && (p.en || p.zh);
export const factsOf = card => (card.facts ?? []).filter(filled);

export const hasProfile = c => Boolean(c.profile?.callouts?.length && c[c.profile.image ?? 'photo']?.file);
export const hasStats = c => Boolean(c.stats && Object.keys(c.stats).length);
export const hasCompare = c => Boolean(c.silhouette?.file && (c.compare?.width || c.compare?.height));
export const hasInside = c => hasProfile(c) || hasStats(c) || hasCompare(c);
export const hasBack = c => Boolean(c.lifeCycle?.length || filled(c.habitat) || c.map?.areas?.length);

const groupChip = g => h('span', { class: 'chip chip--group', 'data-group': g.id },
  h('span', { 'aria-hidden': 'true' }, g.emoji), bi(g.name));

const pageTitle = (key, icon) => h('h2', { class: 'page__heading' }, h('span', { 'aria-hidden': 'true' }, icon), tx(key));

// An empty page still looks like card paper, with the group emoji as a watermark.
const blank = card => h('div', { class: 'page__blank', 'aria-hidden': 'true' }, groupById(card.group)?.emoji);

export function coverPage(card, { onCredit } = {}) {
  const g = groupById(card.group);
  const facts = factsOf(card);
  const img = card.photo ?? card.illustration;
  const kind = card.photo ? 'photo' : 'illustration';
  return h('div', { class: 'page page--cover', 'data-group': card.group },
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
        worldMap(card.map, { label: label('card.where') }),
        h('div', { class: 'cover__badges' }, statusBadge(card.status), card.taiwan && taiwanBadge()))));
}

export function profilePage(card) {
  if (!hasProfile(card)) return h('div', { class: 'page page--profile' }, blank(card));
  const kind = card.profile.image ?? 'photo';
  const callouts = card.profile.callouts;
  const legend = h('ol', { class: 'callouts' }, callouts.map((c, i) => h('li', { 'data-i': i }, bi(c))));
  const highlight = i => legend.querySelectorAll('li').forEach(li => li.classList.toggle('is-lit', li.dataset.i === String(i)));
  const tax = card.taxonomy;
  return h('div', { class: 'page page--profile', 'data-group': card.group },
    pageTitle('card.profile', '🔍'),
    h('div', { class: 'profile__pic' },
      picture(card, { kind }),
      callouts.map((c, i) => h('button', {
        class: 'callout', type: 'button', 'aria-label': [c.en, c.zh].filter(Boolean).join(' / '),
        style: { left: `${c.x * 100}%`, top: `${c.y * 100}%` },
        onclick: () => highlight(i),
      }, String(i + 1)))),
    legend,
    tax && h('p', { class: 'profile__tax' },
      ['class', 'order', 'family'].filter(r => tax[r]).map(r =>
        h('span', null, tx(`card.${r}`, {}, 'bi--inline'), ' ', h('i', { lang: 'la' }, tax[r].sci)))));
}

const range = s => (s.min === s.max || s.max == null ? `${s.min}` : `${s.min}–${s.max}`);
function statRow(icon, key, stat) {
  if (!stat) return null;
  const value = stat.unit ? t(`unit.${stat.unit}`) : null;
  const text = stat.min != null
    ? { en: `${range(stat)} ${value?.en ?? ''}`.trim(), zh: `${range(stat)} ${value?.zh ?? ''}`.trim() }
    : stat;
  return h('div', { class: 'stat' },
    h('span', { class: 'stat__icon', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'stat__label' }, tx(key)),
    h('span', { class: 'stat__value' }, bi(text), stat.note && h('span', { class: 'stat__note' }, bi(stat.note))));
}

export function statsSection(card) {
  if (!hasStats(card)) return null;
  const s = card.stats;
  return h('section', { class: 'section section--stats' },
    pageTitle('card.stats', '📏'),
    statRow('📏', 'card.length', s.length),
    statRow('⚖️', 'card.weight', s.weight),
    statRow('⏳', 'card.lifespan', s.lifespan),
    statRow('🍽️', 'card.diet', s.diet));
}

// The animal's silhouette next to a 120 cm child, drawn to the same scale.
export function compareSection(card) {
  if (!hasCompare(card)) return null;
  const CHILD_CM = 120;
  const scene = h('div', { class: 'compare' });
  const child = h('figure', { class: 'compare__item compare__item--child' },
    h('img', { class: 'compare__img', src: 'assets/child.svg', alt: '' }),
    h('figcaption', null, tx('card.you'), h('span', { class: 'compare__cm' }, `${CHILD_CM} cm`)));
  const animalImg = h('img', { class: 'compare__img', src: card.silhouette.file, alt: '' });
  const size = card.compare.width ?? card.compare.height;
  const animal = h('figure', { class: 'compare__item' }, animalImg,
    h('figcaption', null, bi(card.name), h('span', { class: 'compare__cm' }, `${size} cm`)));
  scene.append(child, animal);

  // Once the silhouette's shape is known, size both so that 1 cm is the same on each.
  const layout = () => {
    const ratio = animalImg.naturalHeight / animalImg.naturalWidth || 0.6;
    const animalW = card.compare.width ?? card.compare.height / ratio;
    const animalH = animalW * ratio;
    const tallest = Math.max(CHILD_CM, animalH);
    const avail = scene.clientHeight || parseFloat(getComputedStyle(scene).height) || 150;
    const availW = (scene.clientWidth || 300) * 0.9;
    const pxPerCm = Math.min(avail / tallest, availW / (animalW + CHILD_CM * 0.4 + 10));
    child.firstChild.style.setProperty('height', `${CHILD_CM * pxPerCm}px`);
    animalImg.style.setProperty('width', `${animalW * pxPerCm}px`);
  };
  animalImg.addEventListener('load', () => requestAnimationFrame(layout));
  requestAnimationFrame(() => { if (animalImg.complete) layout(); });
  return h('section', { class: 'section section--compare' }, pageTitle('card.compare', '🧒'), scene);
}

export function backPage(card) {
  if (!hasBack(card)) return h('div', { class: 'page page--back' }, blank(card));
  return h('div', { class: 'page page--back', 'data-group': card.group },
    card.lifeCycle?.length > 0 && h('section', { class: 'section' },
      pageTitle('card.lifeCycle', '🔄'),
      h('ol', { class: 'cycle' }, card.lifeCycle.map(step => h('li', null, bi(step))))),
    (filled(card.habitat) || card.map) && h('section', { class: 'section' },
      pageTitle('card.habitat', '🌏'),
      worldMap(card.map, { zoomed: true, label: label('card.where') }),
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
  return h('ul', { class: 'card-credits' }, rows, card.map && h('li', null, tx('credits.map')));
}
