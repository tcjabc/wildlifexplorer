// The header around every view: logo, the main nav, the language switch and who is exploring.
import { h, mount } from './dom.js';
import { t, tx, label, getMode } from './i18n.js';
import { state, watching } from './store.js';
import { avatar } from './profiles.js';

const NAV = [
  { view: 'binder', icon: '📒', key: 'nav.binder' },
  { view: 'packs', icon: '🎁', key: 'nav.packs', badge: true },
  { view: 'globe', icon: '🌏', key: 'nav.globe' },
  { view: 'notes', icon: '📓', key: 'nav.notes', device: true },
  { view: 'quiz', icon: '🎯', key: 'nav.quiz', device: true },
  { view: 'badges', icon: '🏅', key: 'nav.badges' },
  { view: 'parents', icon: '🔒', key: 'parents.title' },
];
// device: kept on each device only (Field Notes, quiz scores), so not on a grown-up's device.
const MODES = [['en', 'lang.en', 'lang.enName'], ['zh', 'lang.zh', 'lang.zhName'], ['both', 'lang.bothFace', 'lang.both']];

// The language after this one: EN → 中 → EN+中 → EN.
export const nextLang = mode => MODES[(MODES.findIndex(([m]) => m === mode) + 1) % MODES.length][0];

// One button showing the active language; a tap steps to the next. The header is drawn again
// when the language changes, so the new button flips in as it appears.
let drawnMode = null;
function langButton() {
  const mode = getMode();
  const [, face, name] = MODES.find(([m]) => m === mode);
  const changed = drawnMode !== null && drawnMode !== mode;
  drawnMode = mode;
  return h('button', {
    type: 'button', class: ['btn btn--soft lang-cycle', changed && 'is-flipping'], 'data-lang-cycle': true,
    'aria-label': label('lang.current', { name: t(name) }),
  }, tx(face));
}

// The avatar of whoever is exploring; tap it to switch.
const profileButton = p => p && h('button', {
  type: 'button', class: 'avatar-btn', 'data-profile-switch': true, 'aria-label': label('profile.switch', { name: p.name }),
}, avatar(p));

export function renderHeader(el, active) {
  mount(el,
    h('a', { class: 'brand', href: '#/binder', 'aria-label': label('app.title') },
      h('img', { class: 'brand__icon', src: 'icons/icon-192.png', alt: '', width: 44, height: 44 }),
      h('span', { class: 'brand__name' }, tx('app.title', {}, 'bi--brand'),
        // The name is the same in both languages; Chinese adds a subtitle.
        t('app.subtitle').zh && h('span', { class: 'brand__sub t-zh', lang: 'zh-Hant-TW' }, t('app.subtitle').zh))),
    h('nav', { class: 'nav', 'aria-label': label('nav.main') },
      NAV.filter(n => !(n.device && watching())).map(n => h('a', {
        class: ['nav__item', n.view === active && 'is-active'],
        href: `#/${n.view}`,
        'aria-current': n.view === active ? 'page' : null,
        'aria-label': label(n.key),
      },
      h('span', { class: 'nav__icon', 'aria-hidden': 'true' }, n.icon,
        n.badge && h('span', { class: 'nav__badge', hidden: true })),
      h('span', { class: 'nav__label' }, tx(n.key))))),
    langButton(),
    // A grown-up's device, so it is clear why packs can't be opened here.
    watching() && h('span', { class: 'watch-chip' }, h('span', { 'aria-hidden': 'true' }, '👀'), tx('watch.chip')),
    profileButton(state.profile));
}
