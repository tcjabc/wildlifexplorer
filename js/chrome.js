// The parts around every view: header with the language switch, and the bottom nav.
import { h, mount } from './dom.js';
import { tx, label, getMode } from './i18n.js';

const NAV = [
  { view: 'binder', icon: '📒', key: 'nav.binder' },
  { view: 'quiz', icon: '🎯', key: 'nav.quiz' },
  { view: 'badges', icon: '🏅', key: 'nav.badges' },
  { view: 'more', icon: '⚙️', key: 'nav.more' },
];

// Button faces (EN / 中 / EN+中) look the same in every mode so children can always find them.
export function langSwitch() {
  const mode = getMode();
  const opts = [['en', 'lang.en', 'lang.enName'], ['zh', 'lang.zh', 'lang.zhName'], ['both', 'lang.bothFace', 'lang.both']];
  return h('div', { class: 'seg seg--lang', role: 'radiogroup', 'aria-label': label('lang.label') },
    opts.map(([m, face, name]) => h('button', {
      type: 'button', role: 'radio', class: 'seg__btn', 'data-lang-set': m,
      'aria-checked': String(mode === m), 'aria-label': label(name),
    }, tx(face))));
}

export function renderHeader(el) {
  mount(el,
    h('a', { class: 'brand', href: '#/binder' },
      h('img', { class: 'brand__icon', src: 'icons/icon-192.png', alt: '', width: 44, height: 44 }),
      h('span', { class: 'brand__name' }, tx('app.title', {}, 'bi--brand'))),
    langSwitch());
}

export function renderNav(el, active) {
  el.setAttribute('aria-label', label('nav.main'));
  mount(el, NAV.map(n => h('a', {
    class: ['nav__item', n.view === active && 'is-active'],
    href: `#/${n.view}`,
    'aria-current': n.view === active ? 'page' : null,
  },
  h('span', { class: 'nav__icon', 'aria-hidden': 'true' }, n.icon),
  h('span', { class: 'nav__label' }, tx(n.key)))));
}
