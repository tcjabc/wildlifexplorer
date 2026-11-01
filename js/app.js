// Wildlife Explorer / 野生動物探險家 — app start-up and hash router.
// <main> shows one view (binder, quiz, …). A card opens in the viewer layer on top of
// the binder, so the binder can zoom and blur behind it and is still there on close.
import { $, h, on, mount } from './dom.js';
import { loadStrings, setMode, getMode, stringsLoaded, tx } from './i18n.js';
import * as store from './store.js';
import { renderHeader, renderNav } from './chrome.js';
import { handleImageErrors } from './components.js';
import { runReveals } from './reveal.js';
import { registerOffline } from './offline.js';
import { stop } from './speech.js';
import * as viewer from './viewer.js';

import * as binder from './views/binder.js';
import * as quiz from './views/quiz.js';
import * as badges from './views/badges.js';
import * as more from './views/more.js';
import * as credits from './views/credits.js';

const VIEWS = { binder, quiz, badges, more, credits };
// Which bottom-nav item is highlighted for each view.
const NAV_FOR = { binder: 'binder', quiz: 'quiz', badges: 'badges', more: 'more', credits: 'more' };

const main = $('#main');
const header = $('#header');
const nav = $('#nav');
let cleanup = null;
let shown = { name: 'binder', args: [] }; // what <main> currently shows
let lastDay = store.today();

function parseHash() {
  const [name, ...args] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (name === 'card' && args[0]) return { name: 'card', args: [decodeURIComponent(args[0])] };
  return VIEWS[name] ? { name, args: args.map(decodeURIComponent) } : { name: 'binder', args: [] };
}

function renderMain(next, { keepScroll = false } = {}) {
  const y = window.scrollY;
  cleanup?.();
  stop();
  shown = next;
  renderNav(nav, NAV_FOR[next.name]);
  cleanup = VIEWS[next.name].render(main, next.args) ?? null;
  main.dataset.view = next.name;
  window.scrollTo(0, keepScroll ? y : 0);
}

const binderGroup = () => (shown.name === 'binder' ? binder.currentGroup() : null);
const tileFor = id => main.querySelector(`.tile[data-card="${CSS.escape(id)}"]`);

function route() {
  const next = parseHash();

  if (next.name === 'card') {
    const card = store.state.byId.get(next.args[0]);
    if (!card || !store.isVisible(card)) { location.replace('#/binder'); return; }
    if (binderGroup() !== card.group) renderMain({ name: 'binder', args: [card.group] });
    renderNav(nav, 'binder');
    if (viewer.isOpen()) viewer.show(card);
    else viewer.open(card, { main, fromEl: tileFor(card.id), onDismiss: () => { location.hash = `#/binder/${card.group}`; } });
    return;
  }

  const sameBinder = next.name === 'binder' && binderGroup() && (next.args[0] ?? binderGroup()) === binderGroup();
  if (viewer.isOpen()) {
    if (sameBinder) { viewer.close(); renderNav(nav, 'binder'); return; }
    viewer.close({ animate: false });
  }
  // Coming back from a card to the same binder page: keep it as it is (and its scroll).
  if (sameBinder) { shown = next; return; }
  renderMain(next);
}

const refresh = () => renderMain(shown, { keepScroll: true });

async function setLanguage(mode) {
  if (mode === getMode()) return;
  setMode(mode);
  await store.saveSettings({ lang: mode });
  renderHeader(header);
  refresh();
  const open = viewer.openCardId();
  if (open) viewer.show(store.state.byId.get(open));
}

function checkNewCards() {
  runReveals(() => { if (!viewer.isOpen()) refresh(); });
}

async function boot() {
  await Promise.all([loadStrings(), store.init()]);
  setMode(store.state.settings.lang);
  renderHeader(header);
  route();
  document.body.classList.remove('is-loading');
  main.removeAttribute('aria-busy');

  window.addEventListener('hashchange', () => {
    route();
    if (shown.name === 'binder' && !viewer.isOpen()) checkNewCards();
  });
  on(document, 'click', '[data-lang-set]', (e, btn) => setLanguage(btn.dataset.langSet));
  document.addEventListener('keydown', e => {
    if (viewer.isOpen()) viewer.onKey(e);
    else VIEWS[shown.name].onKey?.(e, shown.args);
  });
  handleImageErrors(main);

  // A new day may bring new cards while the app sits open or in the background.
  const onWake = () => {
    if (document.visibilityState !== 'visible') return;
    if (store.today() !== lastDay) { lastDay = store.today(); if (!viewer.isOpen()) refresh(); }
    if (!viewer.isOpen()) checkNewCards();
  };
  document.addEventListener('visibilitychange', onWake);
  setInterval(onWake, 60 * 1000);

  if (!viewer.isOpen()) checkNewCards();
  registerOffline();
}

boot().catch(err => {
  console.error(err);
  main.removeAttribute('aria-busy');
  // If even the language files failed to load there is no text to show, only the icon.
  mount(main, h('p', { class: 'empty' }, h('span', { 'aria-hidden': 'true' }, '⚠️ '), stringsLoaded() && tx('common.loadError')));
});
