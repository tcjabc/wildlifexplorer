// Who is exploring? The profile picker shown on every launch, the round letter avatars,
// and the Welcome form (new profile) that is also used to edit one later.
import { h, mount } from './dom.js';
import { tx, label, getMode, setMode } from './i18n.js';
import { state, parentTemplate, currentAge, onChange, watching } from './store.js';
import { countryOptions } from './countries.js';
import { restoreError } from './backup.js';
import { grownUpCheck } from './components.js';
import { cmFromFtIn, ftInFromCm, kgFromLb, lbFromKg } from './units.js';

export function initial(name) {
  const s = (name ?? '').trim();
  const first = typeof Intl.Segmenter === 'function'
    ? [...new Intl.Segmenter().segment(s)][0]?.segment
    : [...s][0];
  return (first ?? '?').toLocaleUpperCase();
}

export const avatar = (p, cls = '') =>
  h('span', { class: ['avatar', cls], 'data-avatar': p.avatar, 'aria-hidden': 'true' }, initial(p.name));

// Full-screen picker. Resolves with { pick: id } or { add: true }. Explorers coming in
// from the family account (or deleted there) while it is open show up straight away.
export function showPicker() {
  return new Promise(resolve => {
    const done = result => {
      stop();
      el.classList.remove('is-open');
      setTimeout(() => el.remove(), 250);
      resolve(result);
    };
    const items = () => [
      ...state.profiles.map(p => h('li', null,
        h('button', { class: 'picker__item', type: 'button', onclick: () => done({ pick: p.id }) },
          avatar(p, 'avatar--big'),
          h('span', { class: 'picker__name' }, p.name)))),
      h('li', null,
        // A new explorer starts a timeline and is given a pack: for grown-ups.
        h('button', {
          class: 'picker__item picker__item--add', type: 'button',
          onclick: async () => { if (await grownUpCheck()) done({ add: true }); },
        },
          h('span', { class: 'avatar avatar--big avatar--add', 'aria-hidden': 'true' }, '+'),
          h('span', { class: 'picker__name' }, tx('profile.add')))),
    ];
    const list = h('ul', { class: 'picker__list' }, items());
    const stop = onChange('profiles', () => mount(list, items()));
    const el = h('div', { class: 'picker', role: 'dialog', 'aria-modal': 'true', 'aria-label': label('profile.who') },
      h('img', { class: 'picker__logo', src: 'icons/icon-192.png', alt: '', width: 96, height: 96 }),
      h('h1', { class: 'picker__title' }, tx(watching() ? 'profile.whoWatch' : 'profile.who')),
      list);
    document.body.append(el);
    requestAnimationFrame(() => el.classList.add('is-open'));
    el.querySelector('.picker__item')?.focus();
  });
}

const LANGS = [['en', 'lang.en', 'lang.enName'], ['zh', 'lang.zh', 'lang.zhName'], ['both', 'lang.bothFace', 'lang.both']];
const RANGES = { age: [0, 120], heightCm: [40, 250], weightKg: [3, 300] };

// The Welcome form. profile: the one to edit, or null for a new one. prefill: starting
// values for a new one. onRestore(file): offered on the very first run, for grown-ups who
// have a backup (backup.js). onSignIn(): offered then too, for a family account that
// already has explorers; resolves true once they are on this device. Resolves with the
// fields ({ name, lang, age, heightCm, weightKg, homeCountry }, metric), { restored: true },
// { signedIn: true }, or null if cancelled.
export function profileForm({ profile = null, prefill = null, cancellable = true, onRestore = null, onSignIn = null } = {}) {
  const start = profile ?? { lang: getMode(), ...prefill };
  const units = profile?.parent ?? parentTemplate();
  const imperial = units.length === 'imperial';
  const modeBefore = getMode();
  let lang = start.lang ?? 'both';

  const num = (id, value, attrs = {}) => h('input', {
    id, class: 'input', type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: value ?? '', ...attrs,
  });
  const name = h('input', { id: 'pf-name', class: 'input input--wide', type: 'text', maxlength: 24, autocomplete: 'off', value: start.name ?? '' });
  const langBtns = LANGS.map(([m, face, nameKey]) => h('button', {
    type: 'button', role: 'radio', class: 'seg__btn', 'aria-checked': String(lang === m), 'aria-label': label(nameKey),
    onclick: e => {
      lang = m;
      setMode(m); // show the form in the chosen language straight away
      langBtns.forEach(b => b.setAttribute('aria-checked', String(b === e.currentTarget)));
    },
  }, tx(face)));

  const age = num('pf-age', profile ? currentAge(profile) : start.age, { inputmode: 'numeric', step: 1 });
  const ftIn = start.heightCm != null ? ftInFromCm(start.heightCm) : null;
  const heightFields = imperial
    ? [num('pf-ft', ftIn?.ft, { inputmode: 'numeric', step: 1, 'aria-label': label('profile.feet') }),
      h('span', { class: 'field__unit' }, tx('unit.ft')),
      num('pf-in', ftIn?.inch, { inputmode: 'numeric', step: 1, max: 11, 'aria-label': label('profile.inches') }),
      h('span', { class: 'field__unit' }, tx('unit.in'))]
    : [num('pf-height', start.heightCm != null ? Math.round(start.heightCm) : null), h('span', { class: 'field__unit' }, tx('unit.cm'))];
  const weight = num('pf-weight', start.weightKg == null ? null : imperial ? lbFromKg(start.weightKg) : Math.round(start.weightKg));
  const country = h('select', { id: 'pf-country', class: 'input input--wide' },
    h('option', { value: '' }, label('profile.noCountry')),
    countryOptions().map(o => h('option', { value: o.code, selected: o.code === start.homeCountry }, o.text)));
  const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
  const restoreFile = onRestore && h('input', {
    type: 'file', accept: '.json,application/json', hidden: true,
    onchange: async e => {
      const file = e.target.files?.[0];
      restoreFile.value = '';
      if (!file) return;
      try {
        await onRestore(file);
        finish({ restored: true });
      } catch (err) {
        mount(error, restoreError(err));
        error.hidden = false;
      }
    },
  });

  const field = (forId, key, ...control) => h('div', { class: 'field' },
    h('label', { class: 'field__label', for: forId }, tx(key)), h('div', { class: 'field__control' }, control));

  const dialog = h('dialog', { class: 'sheet sheet--form', 'aria-labelledby': 'pf-title' });
  const form = h('form', { class: 'form', novalidate: true },
    h('h2', { class: 'sheet__title', id: 'pf-title' },
      h('span', { 'aria-hidden': 'true' }, profile ? '✏️' : '👋'), tx(profile ? 'profile.editTitle' : 'profile.welcome')),
    field('pf-name', 'profile.name', name),
    h('div', { class: 'field' },
      h('span', { class: 'field__label', id: 'pf-lang' }, tx('lang.label')),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-labelledby': 'pf-lang' }, langBtns)),
    h('div', { class: 'field-row' },
      field('pf-age', 'profile.age', age),
      field(imperial ? 'pf-ft' : 'pf-height', 'profile.height', heightFields),
      field('pf-weight', 'profile.weight', weight, h('span', { class: 'field__unit' }, tx(imperial ? 'unit.lb' : 'unit.kg')))),
    h('p', { class: 'muted' }, tx('profile.sizeNote')),
    field('pf-country', 'profile.country', country),
    error,
    h('div', { class: 'sheet__actions' },
      cancellable && h('button', { class: 'btn btn--soft', type: 'button', value: 'cancel', onclick: () => finish(null) }, tx('profile.cancel')),
      restoreFile && h('button', { class: 'btn btn--soft', type: 'button', onclick: () => restoreFile.click() },
        h('span', { 'aria-hidden': 'true' }, '📥'), tx('profile.restore')),
      restoreFile,
      onSignIn && h('button', {
        class: 'btn btn--soft', type: 'button',
        onclick: async () => { if (await onSignIn()) finish({ signedIn: true }); },
      }, h('span', { 'aria-hidden': 'true' }, '☁️'), tx('welcome.signIn')),
      h('button', { class: 'btn btn--primary btn--big', type: 'submit' }, tx(profile ? 'profile.save' : 'profile.start'))));
  dialog.append(form);

  let resolveForm;
  function finish(result) {
    if (!result) setMode(modeBefore);
    dialog.close();
    dialog.remove();
    resolveForm(result);
  }
  // Escape closes the form only when it may be cancelled.
  dialog.addEventListener('cancel', e => { e.preventDefault(); if (cancellable) finish(null); });

  const read = el => (el.value.trim() === '' ? null : Number(el.value));
  const fail = (el, key) => {
    mount(error, tx(key));
    error.hidden = false;
    el.setAttribute('aria-invalid', 'true');
    el.focus();
    return null;
  };
  function collect() {
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    error.hidden = true;
    if (!name.value.trim()) return fail(name, 'profile.nameNeeded');
    let heightCm;
    if (imperial) {
      const [ft, inch] = [read(form.querySelector('#pf-ft')), read(form.querySelector('#pf-in'))];
      heightCm = ft == null && inch == null ? null : cmFromFtIn(ft, inch);
    } else heightCm = read(form.querySelector('#pf-height'));
    const w = read(weight);
    const out = {
      name: name.value.trim(),
      lang,
      age: read(age),
      heightCm: heightCm == null ? null : Math.round(heightCm * 10) / 10,
      weightKg: w == null ? null : Math.round((imperial ? kgFromLb(w) : w) * 10) / 10,
      homeCountry: country.value || null,
    };
    for (const [k, [lo, hi]] of Object.entries(RANGES)) {
      const v = out[k];
      if (v != null && (!Number.isFinite(v) || v < lo || v > hi)) {
        const el = k === 'age' ? age : k === 'weightKg' ? weight : form.querySelector(imperial ? '#pf-ft' : '#pf-height');
        return fail(el, `profile.check.${k}`);
      }
    }
    if (out.age != null) out.age = Math.round(out.age);
    return out;
  }
  form.addEventListener('submit', e => {
    e.preventDefault();
    const out = collect();
    if (out) finish(out);
  });

  document.body.append(dialog);
  dialog.showModal();
  if (!profile) name.focus();
  return new Promise(r => { resolveForm = r; });
}
