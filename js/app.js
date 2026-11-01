// Wildlife Explorer / 野生動物探險家 — app start-up and hash router.
import { $, h, on, mount } from './dom.js';
import { loadStrings, setMode, getMode, stringsLoaded, tx } from './i18n.js';
import * as store from './store.js';
import { renderHeader, renderNav } from './chrome.js';
import { handleImageErrors } from './components.js';
import { runReveals } from './reveal.js';
import { registerOffline } from './offline.js';
import { stop } from './speech.js';

import * as binder from './views/binder.js';
import * as card from './views/card.js';
import * as quiz from './views/quiz.js';
import * as badges from './views/badges.js';
import * as more from './views/more.js';
import * as credits from './views/credits.js';

const VIEWS = { binder, card, quiz, badges, more, credits };
// Which bottom-nav item is highlighted for each view.
const NAV_FOR = { binder: 'binder', card: 'binder', quiz: 'quiz', badges: 'badges', more: 'more', credits: 'more' };

const main = $('#main');
const header = $('#header');
const nav = $('#nav');
let cleanup = null;
let current = { name: 'binder', args: [] };
let lastDay = store.today();

function parseHash() {
  const [name, ...args] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return VIEWS[name] ? { name, args: args.map(decodeURIComponent) } : { name: 'binder', args: [] };
}

function render({ keepScroll = false } = {}) {
  const y = window.scrollY;
  cleanup?.();
  stop();
  current = parseHash();
  renderNav(nav, NAV_FOR[current.name]);
  cleanup = VIEWS[current.name].render(main, current.args) ?? null;
  main.dataset.view = current.name;
  window.scrollTo(0, keepScroll ? y : 0);
}

const refresh = () => render({ keepScroll: true });

async function setLanguage(mode) {
  if (mode === getMode()) return;
  setMode(mode);
  await store.saveSettings({ lang: mode });
  renderHeader(header);
  refresh();
}

function checkNewCards() {
  runReveals(() => { if (current.name !== 'card') refresh(); });
}

async function boot() {
  await Promise.all([loadStrings(), store.init()]);
  setMode(store.state.settings.lang);
  renderHeader(header);
  render();
  document.body.classList.remove('is-loading');
  main.removeAttribute('aria-busy');

  window.addEventListener('hashchange', () => {
    render();
    if (current.name === 'binder') checkNewCards();
  });
  on(document, 'click', '[data-lang-set]', (e, btn) => setLanguage(btn.dataset.langSet));
  document.addEventListener('keydown', e => VIEWS[current.name].onKey?.(e, current.args));
  handleImageErrors(main);

  // A new day may bring new cards while the app sits open or in the background.
  const onWake = () => {
    if (document.visibilityState !== 'visible') return;
    if (store.today() !== lastDay) { lastDay = store.today(); refresh(); }
    checkNewCards();
  };
  document.addEventListener('visibilitychange', onWake);
  setInterval(onWake, 60 * 1000);

  checkNewCards();
  registerOffline();
}

boot().catch(err => {
  console.error(err);
  main.removeAttribute('aria-busy');
  // If even the language files failed to load there is no text to show, only the icon.
  mount(main, h('p', { class: 'empty' }, h('span', { 'aria-hidden': 'true' }, '⚠️ '), stringsLoaded() && tx('common.loadError')));
});
