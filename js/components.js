// Shared UI pieces used by several views. Group and status colours come from
// data-group / data-status attributes (see app.css), never inline styles.
import { h, mount } from './dom.js';
import { bi, tx, t, label, getMode } from './i18n.js';
import { isVisible, inUnopenedPack, thumbOf, mainImage, speechRate, groupById } from './store.js';
import { speak, stop, isSpeaking, speechSupported } from './speech.js';
import { notesCount } from './notes-store.js';

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
    // Full-size pictures offer both sizes; the iPad's high-density screen picks the big one.
    // (The build makes full images up to 1200 px and thumbnails up to 480 px.)
    srcset: thumb ? null : `${thumbOf(img.file)} 480w, ${img.file} 1200w`,
    sizes: thumb ? null : '(min-width: 700px) 600px, 100vw',
    alt: [card.name.en, card.name.zh].filter(Boolean).join(' '),
    decoding: 'async',
    loading: thumb ? 'lazy' : null,
    // Full-size images fall back to the thumbnail if missing.
    'data-fallback': thumb ? null : thumbOf(img.file),
  });
}

// 📓 n on a tile when Field Notes pages are linked to the card; tapping it opens the card
// with those pages beside it.
function notesBadge(card) {
  const n = notesCount(card.id);
  if (!n) return null;
  return h('span', {
    class: 'tile__notes', role: 'link', tabindex: '0', 'aria-label': label(n === 1 ? 'notes.openCount.one' : 'notes.openCount.many', { n }),
    onclick: e => { e.preventDefault(); e.stopPropagation(); location.hash = `#/card/${encodeURIComponent(card.id)}/notes`; },
  }, h('span', { 'aria-hidden': 'true' }, '📓'), String(n));
}

export function cardTile(card) {
  const g = groupById(card.group);
  if (isVisible(card)) {
    return h('a', { class: 'tile', href: `#/card/${encodeURIComponent(card.id)}`, 'data-group': card.group, 'data-card': card.id },
      h('span', { class: 'tile__no' }, cardNo(card.number)),
      h('span', { class: 'tile__pic' }, picture(card, { thumb: true })),
      h('span', { class: 'tile__name' }, bi(card.name)),
      // On the photo's corner: dark or light text from card.labelTone (set by the build; white
      // with a dark halo until a card has one).
      card.taiwan && h('span', { class: 'tile__tw', 'data-tone': card.labelTone ?? null, title: label('card.taiwan'), 'aria-hidden': 'true' }, '🇹🇼'),
      notesBadge(card));
  }
  const when = t(inUnopenedPack(card.id) ? 'binder.inPack' : 'binder.mystery');
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
    if (fb) { img.dataset.fallback = ''; img.removeAttribute('srcset'); img.src = fb; } else img.classList.add('pic--broken');
  }, true);
}

export const groupTitle = g =>
  h('span', { class: 'group-title', 'data-group': g.id },
    h('span', { 'aria-hidden': 'true' }, g.emoji),
    bi(g.name));

// "Grown-ups only: what is 5 + 7?" in front of grown-up things, answered on a number pad of
// its own: the system keyboard never opens (in fullscreen it can cover the page). A wrong
// answer asks a new sum; onPass() once it is right. Keys on a real keyboard work too.
const MAX_DIGITS = 2; // the biggest sum is 18
export function sumGate(onPass) {
  const question = h('p', { class: 'gate__sum', 'aria-live': 'polite' });
  const entry = h('output', { class: 'input gate__entry' });
  let sum = 0, typed = '';
  const show = value => { typed = value; entry.textContent = value; };
  const press = digit => { if (typed.length < MAX_DIGITS) show(typed + digit); };
  const erase = () => show(typed.slice(0, -1));
  const ask = () => {
    const a = 3 + Math.floor(Math.random() * 7), b = 4 + Math.floor(Math.random() * 6);
    sum = a + b;
    show('');
    mount(question, tx('parents.gate', { a, b }));
  };
  const key = digit => h('button', { class: 'btn btn--soft gate__key', type: 'button', onclick: () => press(digit) }, digit);

  const form = h('form', { class: 'gate', tabindex: -1 },
    question, entry,
    h('div', { class: 'gate__pad' },
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(key),
      h('button', { class: 'btn btn--soft gate__key', type: 'button', 'aria-label': label('parents.gateErase'), onclick: erase }, '←'),
      key('0'),
      h('button', { class: 'btn btn--primary gate__key gate__key--go', type: 'submit' }, tx('parents.gateGo'))));

  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!typed) return;
    if (typed === String(sum)) { onPass(); return; }
    ask();
    entry.classList.add('is-wrong');
  });
  entry.addEventListener('animationend', () => entry.classList.remove('is-wrong'));
  form.addEventListener('keydown', e => {
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === 'Backspace') erase();
    else if (e.key === 'Enter') { e.preventDefault(); form.requestSubmit(); }
  });
  ask();
  return form;
}

// The sum in a sheet of its own, in front of something a grown-up should do. Resolves true
// once it is right, false if the sheet was closed.
export function grownUpCheck() {
  return new Promise(resolve => {
    const finish = passed => { dialog.close(); dialog.remove(); resolve(passed); };
    const gate = sumGate(() => finish(true));
    const dialog = h('dialog', { class: 'sheet sheet--form', 'aria-label': label('parents.title') }, gate,
      h('div', { class: 'sheet__actions' },
        h('button', { class: 'btn btn--soft', type: 'button', onclick: () => finish(false) }, tx('profile.cancel'))));
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(false); });
    document.body.append(dialog);
    dialog.showModal();
    gate.focus();
  });
}
