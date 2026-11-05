import { h, mount } from '../dom.js';
import { tx, t, label, getMode } from '../i18n.js';
import { state, updateProfile, progress, speechRate } from '../store.js';
import { speak, speechSupported } from '../speech.js';
import { offlineStatus } from '../offline.js';
import { avatar, profileForm } from '../profiles.js';

// A row of radio buttons that saves one of the profile's own settings.
function choice(key, options, labelKey) {
  const buttons = options.map(([value, textKey]) => h('button', {
    type: 'button', role: 'radio', class: 'seg__btn', 'aria-checked': String(state.profile[key] === value),
    onclick: async e => {
      buttons.forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget)));
      await updateProfile(state.profile.id, { [key]: value });
    },
  }, tx(textKey)));
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label(labelKey) }, buttons);
}

export function render(main) {
  const p = state.profile;

  const editMe = async () => {
    const fields = await profileForm({ profile: state.profile });
    if (!fields) return;
    await updateProfile(p.id, fields);
    render(main);
  };

  mount(main, h('section', { class: 'page more' },
    h('h1', { class: 'page__title' }, h('span', { 'aria-hidden': 'true' }, '⚙️'), tx('more.title')),

    h('div', { class: 'panel' },
      h('div', { class: 'me' },
        avatar(p, 'avatar--big'),
        h('div', { class: 'me__text' },
          h('p', { class: 'me__name' }, p.name),
          h('p', { class: 'muted' }, tx('more.collectedCount', progress())))),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn btn--soft', type: 'button', onclick: editMe },
          h('span', { 'aria-hidden': 'true' }, '✏️'), tx('profile.edit')),
        h('button', { class: 'btn btn--soft', type: 'button', 'data-profile-switch': true },
          h('span', { 'aria-hidden': 'true' }, '🔄'), tx('profile.switchButton')))),

    // How Chinese names first show on cards (a tap on a name switches it for this visit).
    h('div', { class: 'panel' },
      h('h2', { class: 'panel__title' }, tx('more.zhNames')),
      choice('zhuyin', [[false, 'more.zhPlain'], [true, 'more.zhZhuyin']], 'more.zhNames'),
      h('p', { class: 'muted' }, tx('more.zhNote'))),

    h('div', { class: 'panel' },
      h('h2', { class: 'panel__title' }, tx('more.speech')),
      speechSupported
        ? h('div', { class: 'row-actions' },
          choice('rate', [['slow', 'more.slow'], ['normal', 'more.normal']], 'more.speech'),
          h('button', {
            class: 'btn btn--soft', type: 'button',
            onclick: () => speak([t('more.testText')], { mode: getMode(), rate: speechRate() }),
          }, h('span', { 'aria-hidden': 'true' }, '🔊'), tx('more.test')))
        : h('p', null, tx('more.noSpeech'))),

    h('a', { class: 'panel panel--link', href: '#/credits' },
      h('span', { 'aria-hidden': 'true' }, '📷'), tx('more.credits'), h('span', { 'aria-hidden': 'true' }, '›')),

    h('div', { class: 'panel' },
      h('p', { 'data-offline': true }, offlineStatus()),
      h('p', { class: 'muted' }, tx('more.install'))),

    h('a', { class: 'panel panel--link', href: '#/parents' },
      h('span', { 'aria-hidden': 'true' }, '🔒'), tx('more.parents'), h('span', { 'aria-hidden': 'true' }, '›'))));
}
