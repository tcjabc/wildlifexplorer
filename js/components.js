// Shared UI pieces used by several views. Group and status colours come from
// data-group / data-status attributes (see app.css), never inline styles.
import { h } from './dom.js';
import { bi, tx, t, label, getMode } from './i18n.js';
import { isVisible, hasArrived, daysUntil, thumbOf, mainImage, speechRate, groupById } from './store.js';
import { speak, stop, isSpeaking, speechSupported } from './speech.js';

export const cardNo = n => String(n).padStart(3, '0');

export function statusBadge(code) {
  if (!code) return null;
  return h('span', { class: 'badge badge--iucn', 'data-status': code.toLowerCase() },
    h('span', { class: 'badge__code' }, code),
    tx(`status.${code}`));
}

export const taiwanBadge = () =>
  h('span', { class: 'badge badge--taiwan' },
    h('span', { class: 'badge__icon', 'aria-hidden': 'true' }, '🇹🇼'),
    tx('card.taiwan'));

export function picture(card, { thumb = false, kind } = {}) {
  const img = kind ? card[kind] : mainImage(card);
  if (!img?.file) {
    return h('div', { class: 'pic pic--empty', 'data-group': card.group },
      h('span', { class: 'pic__emoji', 'aria-hidden': 'true' }, groupById(card.group)?.emoji));
  }
  return h('img', {
    class: 'pic',
    src: thumb ? thumbOf(img.file) : img.file,
    alt: [card.name.en, card.name.zh].filter(Boolean).join(' '),
    decoding: 'async',
    loading: thumb ? 'lazy' : null,
    // Full-size images fall back to the thumbnail if missing.
    'data-fallback': thumb ? null : thumbOf(img.file),
  });
}

export function cardTile(card) {
  const g = groupById(card.group);
  if (isVisible(card)) {
    return h('a', { class: 'tile', href: `#/card/${encodeURIComponent(card.id)}`, 'data-group': card.group },
      h('span', { class: 'tile__no' }, cardNo(card.number)),
      h('span', { class: 'tile__pic' }, picture(card, { thumb: true })),
      h('span', { class: 'tile__name' }, bi(card.name)),
      card.taiwan && h('span', { class: 'tile__tw', title: label('card.taiwan'), 'aria-hidden': 'true' }, '🇹🇼'));
  }
  let when = t('binder.mystery');
  if (card.unlockDate && !hasArrived(card)) {
    const d = daysUntil(card.unlockDate);
    when = d <= 0 ? t('binder.arrivesToday') : d === 1 ? t('binder.arrivesTomorrow') : t('binder.arrivesIn', { n: d });
  }
  return h('div', { class: 'tile tile--locked', 'data-group': card.group, 'aria-label': label('binder.mystery') },
    h('span', { class: 'tile__no' }, cardNo(card.number)),
    h('span', { class: 'tile__pic' },
      h('span', { class: 'silhouette', 'aria-hidden': 'true' }, g?.emoji),
      h('span', { class: 'tile__q', 'aria-hidden': 'true' }, '?')),
    h('span', { class: 'tile__name tile__when' }, bi(when)));
}

// A read-aloud button. getPairs() returns the [{ en, zh }] to read when tapped.
export function readButton(getPairs, { big = false } = {}) {
  if (!speechSupported) return null;
  const icon = h('span', { 'aria-hidden': 'true' }, '🔊');
  const btn = h('button', { class: ['btn btn--icon btn--read', big && 'btn--big'], type: 'button', 'aria-label': label('card.readAloud') }, icon);
  const setIdle = () => {
    btn.classList.remove('is-speaking');
    icon.textContent = '🔊';
    btn.setAttribute('aria-label', label('card.readAloud'));
  };
  btn.addEventListener('click', () => {
    if (btn.classList.contains('is-speaking') && isSpeaking()) { stop(); return; }
    btn.classList.add('is-speaking');
    icon.textContent = '⏹';
    btn.setAttribute('aria-label', label('card.stop'));
    speak(getPairs(), { mode: getMode(), rate: speechRate(), onend: setIdle });
  });
  return btn;
}

// Swap broken full-size images to their thumbnail, and hide broken thumbnails.
export function handleImageErrors(root) {
  root.addEventListener('error', e => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const fb = img.dataset.fallback;
    if (fb) { img.dataset.fallback = ''; img.src = fb; } else img.classList.add('pic--broken');
  }, true);
}

export const groupTitle = g =>
  h('span', { class: 'group-title', 'data-group': g.id },
    h('span', { 'aria-hidden': 'true' }, g.emoji),
    bi(g.name));
