// WildFile — app start-up and hash router.
// Every launch starts at the profile picker (or the Welcome form on the very first run).
// <main> shows one view (binder, quiz, …). A card opens in the viewer layer on top of
// the binder, so the binder can zoom and blur behind it and is still there on close.
// Packs are never opened for the child: a sheet says when one arrives, and they wait in
// Packs until the child opens them.
import { $, h, on, mount } from './dom.js';
import { loadStrings, setMode, getMode, stringsLoaded, tx } from './i18n.js';
import * as store from './store.js';
import { events as dbEvents } from './db.js';
import { renderHeader } from './chrome.js';
import { handleImageErrors } from './components.js';
import { registerOffline } from './offline.js';
import { stop } from './speech.js';
import * as viewer from './viewer.js';
import { setZhuyin } from './zhuyin.js';
import { showPicker, profileForm } from './profiles.js';
import { initPacks, checkDrops, updateBadge, hideArrival } from './packs.js';
import { revealing } from './reveal.js';
import { celebrate } from './celebrate.js';
import { handleSignInLink, familySignIn } from './account.js';
import { sync } from './cloud/sync.js';
import { restoreProgress } from './backup.js';

import * as binder from './views/binder.js';
import * as packs from './views/packs.js';
import * as globe from './views/globe.js';
import * as notesView from './views/notes.js';
import { loadIndex as loadNotesIndex } from './notes-store.js';
import * as cardReturn from './card-return.js';
import * as quiz from './views/quiz.js';
import * as badges from './views/badges.js';
import * as more from './views/more.js';
import * as parents from './views/parents.js';
import * as credits from './views/credits.js';

const VIEWS = { binder, packs, globe, notes: notesView, quiz, badges, more, parents, credits };
// Which nav item is highlighted for each view.
const NAV_FOR = { binder: 'binder', packs: 'packs', globe: 'globe', notes: 'notes', quiz: 'quiz', badges: 'badges', more: 'more', parents: 'more', credits: 'more' };

const main = $('#main');
const header = $('#header');
let cleanup = null;
let shown = { name: null, args: [] }; // what <main> currently shows
let activeNav = null;
let choosing = false;

// The header is redrawn only when the highlighted nav item, the language or the profile changes.
function setNav(active, force = false) {
  if (active === activeNav && !force) return;
  activeNav = active;
  renderHeader(header, active);
  updateBadge();
}

function parseHash() {
  const [name, ...args] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (name === 'card' && args[0]) return { name: 'card', args: [decodeURIComponent(args[0]), args[1]] };
  // Field Notes and the quiz stay on each device: not on a grown-up's device.
  if (store.watching() && ['notes', 'quiz'].includes(name)) return { name: 'binder', args: [] };
  return VIEWS[name] ? { name, args: args.map(decodeURIComponent) } : { name: 'binder', args: [] };
}

function renderMain(next, { keepScroll = false } = {}) {
  const y = main.scrollTop;
  cleanup?.();
  stop();
  shown = next;
  setNav(NAV_FOR[next.name]);
  cleanup = VIEWS[next.name].render(main, next.args) ?? null;
  main.dataset.view = next.name;
  main.scrollTop = keepScroll ? y : 0;
}

const binderGroup = () => (shown.name === 'binder' ? binder.currentGroup() : null);
const tileFor = id => main.querySelector(`.tile[data-card="${CSS.escape(id)}"]`);

function route() {
  if (!store.state.profile) return;
  const next = parseHash();

  if (next.name === 'card') {
    const card = store.state.byId.get(next.args[0]);
    if (!card || !store.isVisible(card)) { location.replace('#/binder'); return; }
    // Straight back from the globe: the same side and notebook as when the card was left.
    // (Asked before the binder is drawn behind the card, which changes what is shown.)
    const restore = shown.name === 'globe' ? cardReturn.take(card.id) : null;
    if (binderGroup() !== card.group) renderMain({ name: 'binder', args: [card.group] });
    setNav('binder');
    if (viewer.isOpen()) viewer.show(card);
    else viewer.open(card, { main, fromEl: tileFor(card.id), onDismiss: () => { location.hash = `#/binder/${card.group}`; }, restore });
    if (next.args[1] === 'notes') viewer.openNotes();
    return;
  }

  const sameBinder = next.name === 'binder' && binderGroup() && (next.args[0] ?? binderGroup()) === binderGroup();
  if (viewer.isOpen()) {
    if (sameBinder) { viewer.close(); setNav('binder'); return; }
    cardReturn.remember(viewer.snapshot()); // e.g. off to the globe from the card's map
    viewer.close({ animate: false });
  }
  // Coming back from a card to the same binder page: keep it as it is (and its scroll).
  if (sameBinder) { shown = next; return; }
  renderMain(next);
}

const refresh = () => { if (shown.name) renderMain(shown, { keepScroll: true }); };

async function setLanguage(mode) {
  if (!store.state.profile || mode === getMode()) return;
  await store.updateProfile(store.state.profile.id, { lang: mode });
  refresh();
  const open = viewer.openCardId();
  if (open) viewer.show(store.state.byId.get(open));
}

// The active profile's own settings: language, zhuyin, and the header with its avatar.
function applyProfile() {
  const p = store.state.profile;
  if (!p) return;
  setMode(p.lang);
  setZhuyin(p.zhuyin);
  setNav(activeNav, true);
}

async function enterProfile(id) {
  await store.selectProfile(id);
  await loadNotesIndex(); // which cards have Field Notes
  shown = { name: null, args: [] }; // draw the view again for this profile
  route();
  await checkDrops();
  // Badges earned without opening a pack (e.g. after the tier counts change).
  const fresh = await store.awardBadges();
  if (fresh.length) await celebrate(fresh);
}

// The picker (or, with no profiles yet, the Welcome form). Shown on launch and from the avatar.
// join: this device just signed in from the email link, so with no explorers yet the
// family's come down first (no sum: the grown-up is there).
async function chooseProfile({ join = false } = {}) {
  if (choosing || revealing()) return;
  choosing = true;
  hideArrival();
  if (viewer.isOpen()) viewer.close({ animate: false });
  try {
    for (;;) {
      if (!store.state.profiles.length) {
        if (join) {
          join = false;
          if (await familySignIn({ explorers: familyExplorers, gate: false })) continue;
        }
        const fields = await profileForm({
          prefill: store.legacyPrefill(), cancellable: false, onRestore: restoreFile,
          onSignIn: () => familySignIn({ explorers: familyExplorers }),
        });
        // The picker shows the explorers that came back (backup) or down (family account).
        if (fields.restored || fields.signedIn) continue;
        await enterProfile((await store.createProfile(fields)).id);
        return;
      }
      const choice = await showPicker();
      if (choice.pick && !store.state.profiles.some(p => p.id === choice.pick)) continue; // deleted meanwhile
      if (choice.pick) { await enterProfile(choice.pick); return; }
      const fields = await profileForm();
      if (fields) { await enterProfile((await store.createProfile(fields)).id); return; }
    }
  } finally {
    choosing = false;
  }
}

// The saved progress can't be used from this window for now (db.js events). 'updated': a
// newer WildFile upgraded it, so only a reload carries on. 'blocked': this window's update
// waits for older WildFile windows to close. Covers everything, above any open dialog.
let stringsReady = null;
async function dbNotice(kind) {
  await Promise.resolve(stringsReady).catch(() => {});
  $('.picker--db')?.remove();
  if (kind === 'unblocked') return;
  const updated = kind === 'updated';
  const el = h('dialog', { class: 'picker picker--db is-open', 'aria-labelledby': 'db-notice' },
    h('img', { class: 'picker__logo', src: 'icons/icon-192.png', alt: '', width: 96, height: 96 }),
    h('h1', { class: 'picker__title', id: 'db-notice' }, stringsLoaded() && tx(updated ? 'db.updated' : 'db.blocked')),
    updated && h('button', { class: 'btn btn--primary btn--big', type: 'button', onclick: () => location.reload() },
      h('span', { 'aria-hidden': 'true' }, '↻'), stringsLoaded() && tx('db.reload')));
  el.addEventListener('cancel', e => e.preventDefault()); // Escape doesn't close it
  document.body.append(el);
  el.showModal();
}
for (const kind of ['updated', 'blocked', 'unblocked']) dbEvents.addEventListener(kind, () => dbNotice(kind));

// First run on a new device, signed in to the family account: how many explorers came down.
async function familyExplorers() {
  await store.reload();
  return store.state.profiles.length;
}

// First run on a new device: bring back a backup instead of starting from scratch.
async function restoreFile(file) {
  await restoreProgress(await file.text());
  await store.reload();
}

async function boot() {
  stringsReady = loadStrings();
  await Promise.all([stringsReady, store.init()]);
  const lastId = await store.lastProfileId();
  setMode(store.state.profiles.find(p => p.id === lastId)?.lang ?? store.legacyPrefill()?.lang ?? 'both');
  document.body.classList.remove('is-loading');
  main.removeAttribute('aria-busy');

  store.onChange('profile', applyProfile);
  // This device became a grown-up's device, or the explorers' device again.
  store.onChange('role', () => {
    hideArrival();
    setNav(activeNav, true);
    if (!store.state.profile || choosing) return;
    if (['notes', 'quiz'].includes(shown.name)) location.replace('#/binder');
    else if (shown.name !== 'parents' && !viewer.isOpen()) refresh(); // Parents redraws itself, still open
    checkDrops();
  });
  // The active profile was deleted (Parents area): pick another.
  store.onChange('profiles', () => { if (!store.state.profile) chooseProfile(); });
  // Packs and the binder's "In a pack" tiles show what has arrived.
  store.onChange('badges', () => { if (shown.name === 'badges' && !revealing()) refresh(); });
  store.onChange('packs', () => {
    updateBadge();
    if (['packs', 'binder'].includes(shown.name) && !revealing() && !viewer.isOpen()) refresh();
  });
  initPacks({ onClosed: () => { updateBadge(); if (!viewer.isOpen()) refresh(); } });

  window.addEventListener('hashchange', route);
  on(document, 'click', '[data-lang-set]', (e, btn) => setLanguage(btn.dataset.langSet));
  on(document, 'click', '[data-profile-switch]', () => chooseProfile());
  document.addEventListener('keydown', e => {
    if (!store.state.profile || choosing) return;
    if (viewer.isOpen()) viewer.onKey(e);
    else VIEWS[shown.name]?.onKey?.(e, shown.args);
  });
  handleImageErrors(main);

  // A pack may come due while the app sits open or in the background.
  const onWake = () => { if (document.visibilityState === 'visible' && !choosing) checkDrops(); };
  document.addEventListener('visibilitychange', onWake);
  setInterval(onWake, 60 * 1000);

  registerOffline();
  // Changes from the family account's other devices: show them, and say if a pack arrived.
  // (The header, picker and Parents page follow the store's events themselves; the More page
  // shows the active explorer's name and avatar.)
  sync.onPulled(ids => store.applyPulled(ids)
    .then(() => {
      const p = store.state.profile;
      if (!p || choosing) return undefined;
      if (shown.name === 'more' && ids.includes(p.id) && !viewer.isOpen()) refresh();
      return checkDrops();
    })
    .catch(err => console.error(err)));
  sync.start(); // only does anything once a parent has signed in and chosen explorers
  await chooseProfile({ join: await handleSignInLink() }); // opened from the sign-in email's link?
}

boot().catch(err => {
  console.error(err);
  main.removeAttribute('aria-busy');
  // If even the language files failed to load there is no text to show, only the icon.
  mount(main, h('p', { class: 'empty' }, h('span', { 'aria-hidden': 'true' }, '⚠️ '), stringsLoaded() && tx('common.loadError')));
});
