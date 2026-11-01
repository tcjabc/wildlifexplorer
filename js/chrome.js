// The header around every view: logo, the main nav and the language switch.
import { h, mount } from './dom.js';
import { tx, label, getMode } from './i18n.js';

const NAV = [
  { view: 'binder', icon: '📒', key: 'nav.binder' },
  { view: 'quiz', icon: '🎯', key: 'nav.quiz' },
  { view: 'badges', icon: '🏅', key: 'nav.badges' },
  { view: 'more', icon: '⚙️', key: 'nav.more' },
];
const MODES = [['en', 'lang.en', 'lang.enName'], ['zh', 'lang.zh', 'lang.zhName'], ['both', 'lang.bothFace', 'lang.both']];

// Button faces (EN / 中 / EN+中) look the same in every mode so children can always find them.
export function langSwitch() {
  const mode = getMode();
  return h('div', { class: 'seg seg--lang', role: 'radiogroup', 'aria-label': label('lang.label') },
    MODES.map(([m, face, name]) => h('button', {
      type: 'button', role: 'radio', class: 'seg__btn', 'data-lang-set': m,
      'aria-checked': String(mode === m), 'aria-label': label(name),
    }, tx(face))));
}

// Narrow screens: one button that steps EN → 中 → EN+中.
function langCycle() {
  const i = MODES.findIndex(([m]) => m === getMode());
  const [, face] = MODES[i];
  const next = MODES[(i + 1) % MODES.length][0];
  return h('button', {
    type: 'button', class: 'btn btn--soft lang-cycle', 'data-lang-set': next, 'aria-label': label('lang.label'),
  }, tx(face));
}

export function renderHeader(el, active) {
  mount(el,
    h('a', { class: 'brand', href: '#/binder', 'aria-label': label('app.title') },
      h('img', { class: 'brand__icon', src: 'icons/icon-192.png', alt: '', width: 44, height: 44 }),
      h('span', { class: 'brand__name' }, tx('app.title', {}, 'bi--brand'))),
    h('nav', { class: 'nav', 'aria-label': label('nav.main') },
      NAV.map(n => h('a', {
        class: ['nav__item', n.view === active && 'is-active'],
        href: `#/${n.view}`,
        'aria-current': n.view === active ? 'page' : null,
        'aria-label': label(n.key),
      },
      h('span', { class: 'nav__icon', 'aria-hidden': 'true' }, n.icon),
      h('span', { class: 'nav__label' }, tx(n.key))))),
    langSwitch(),
    langCycle());
}
