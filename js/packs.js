// Packs around the app: checking for drops that are due, the "New pack arrived!" sheet
// (shown once per pack, never in the way), the count on the Packs button, and a sealed
// pack drawn for the Packs page.
import { h } from './dom.js';
import { tx, t, label, dateText } from './i18n.js';
import { state, grantDue, unopenedPacks, markNotified, nextDrop, dropById, watching } from './store.js';
import { openPacks, revealing } from './reveal.js';

let afterOpen = () => {};
let sheet = null;

export function initPacks({ onClosed }) { afterOpen = onClosed; }

// Open the oldest pack (and more, if the child asks), then let the app redraw.
export function openNow() {
  if (watching()) return; // packs are opened on the explorers' device
  hideArrival();
  openPacks(afterOpen);
}

// Grant whatever is due, and tell the child about packs they haven't heard about yet.
export async function checkDrops() {
  if (!state.profile) return;
  await grantDue();
  updateBadge();
  if (revealing() || watching()) return;
  const unheard = unopenedPacks().filter(p => !p.notifiedAt);
  if (!unheard.length) return;
  await markNotified(unheard);
  showArrival(unheard.length);
}

export function updateBadge() {
  const n = state.profile ? unopenedPacks().length : 0;
  const badge = document.querySelector('.nav__badge');
  if (!badge) return;
  badge.textContent = String(n);
  badge.hidden = n === 0;
  badge.closest('.nav__item')?.setAttribute('aria-label', label(n ? 'nav.packsWaiting' : 'nav.packs', { n }));
}

// A bottom sheet that doesn't block anything: "Open now" or "Later".
function showArrival(n) {
  hideArrival();
  const later = h('button', { class: 'btn btn--soft', type: 'button', onclick: hideArrival }, tx('arrival.later'));
  const open = h('button', { class: 'btn btn--accent', type: 'button', onclick: openNow }, tx('arrival.open'));
  sheet = h('aside', { class: 'notice', 'aria-live': 'polite', 'aria-label': label('arrival.label') },
    h('span', { class: 'notice__icon', 'aria-hidden': 'true' }, '🎁'),
    h('p', { class: 'notice__text' }, tx(n === 1 ? 'arrival.one' : 'arrival.many', { n })),
    h('div', { class: 'notice__actions' }, later, open));
  document.body.append(sheet);
  requestAnimationFrame(() => sheet?.classList.add('is-open'));
}

export function hideArrival() {
  if (!sheet) return;
  const el = sheet;
  sheet = null;
  el.classList.remove('is-open');
  setTimeout(() => el.remove(), 300);
}

// "Next pack: Saturday 7 November, 9:00", or why there isn't one.
export function nextDropText() {
  const next = nextDrop();
  if (!next) return t('packs.allArrived');
  if (next.waiting) return t('packs.waiting');
  return t('packs.next', { when: dateText(next.due, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) });
}

// A sealed pack, drawn the same as the one you cut open.
export function packFace(record) {
  const drop = dropById(record.dropId);
  const emojis = record.cardIds.map(id => state.groups.find(g => g.id === state.byId.get(id)?.group)?.emoji).join('');
  return h('div', { class: 'pack pack--drop pack--still', 'aria-hidden': 'true' },
    h('div', { class: 'pack__body' },
      h('span', { class: 'pack__emojis' }, emojis),
      h('span', { class: 'pack__brand' }, tx('app.title')),
      drop && h('span', { class: 'pack__group' }, tx('pack.label', { series: drop.series, week: drop.week }))),
    h('div', { class: 'pack__strip' }, h('span', { class: 'pack__cutline' })));
}
