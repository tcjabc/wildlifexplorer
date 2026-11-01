import { h, mount } from '../dom.js';
import { tx, t, label, getMode } from '../i18n.js';
import { state, saveSettings, resetProgress, progress, speechRate } from '../store.js';
import { speak, speechSupported } from '../speech.js';
import { langSwitch } from '../chrome.js';
import { offlineStatus } from '../offline.js';

let gateOpen = false;

// The grown-ups area: a sum to answer, then preview and reset.
function renderParentZone(zone) {
  if (!gateOpen) {
    const a = 3 + Math.floor(Math.random() * 7), b = 4 + Math.floor(Math.random() * 6);
    const input = h('input', { id: 'gate-input', class: 'input', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', required: true });
    const form = h('form', { class: 'gate' },
      h('label', { for: 'gate-input' }, tx('more.gate', { a, b })),
      h('div', { class: 'gate__row' }, input, h('button', { class: 'btn btn--primary', type: 'submit' }, tx('more.gateGo'))));
    form.addEventListener('submit', e => {
      e.preventDefault();
      gateOpen = input.value.trim() === String(a + b);
      renderParentZone(zone);
    });
    mount(zone, form);
    return;
  }
  const msg = h('p', { class: 'muted' });
  mount(zone, h('div', { class: 'parent' },
    h('label', { class: 'switch' },
      h('input', { type: 'checkbox', checked: state.settings.preview, onchange: e => saveSettings({ preview: e.target.checked }) }),
      h('span', { class: 'switch__track', 'aria-hidden': 'true' }),
      h('span', null, tx('more.preview'))),
    h('button', {
      class: 'btn btn--danger', type: 'button',
      onclick: async () => {
        if (!window.confirm(label('more.resetConfirm'))) return;
        await resetProgress();
        mount(msg, tx('more.resetDone'));
      },
    }, tx('more.reset')),
    msg));
}

export function render(main) {
  const rate = state.settings.rate;
  const rateButtons = ['slow', 'normal'].map(r => h('button', {
    type: 'button', role: 'radio', class: 'seg__btn', 'aria-checked': String(rate === r),
    onclick: async e => {
      await saveSettings({ rate: r });
      rateButtons.forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget)));
    },
  }, tx(`more.${r}`)));

  const parentZone = h('div');
  renderParentZone(parentZone);

  mount(main, h('section', { class: 'page more' },
    h('h1', { class: 'page__title' }, h('span', { 'aria-hidden': 'true' }, '⚙️'), tx('more.title')),
    h('p', { class: 'muted' }, tx('more.collectedCount', progress())),

    h('div', { class: 'panel' }, h('h2', { class: 'panel__title' }, tx('lang.label')), langSwitch()),

    h('div', { class: 'panel' },
      h('h2', { class: 'panel__title' }, tx('more.speech')),
      speechSupported
        ? h('div', { class: 'row-actions' },
          h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label('more.speech') }, rateButtons),
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

    h('div', { class: 'panel' }, h('h2', { class: 'panel__title' }, tx('more.parents')), parentZone)));

  return () => { gateOpen = false; };
}
