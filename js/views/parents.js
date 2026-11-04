// For grown-ups: settings behind a simple sum. Settings are per profile; pick whose at
// the top. Each panel is one entry in SECTIONS, so adding a setting means adding a section:
//   { id, icon, title: string key, render: (profile, redraw) => node }
import { $, h, mount } from '../dom.js';
import { bi, tx, label, plain, dateText } from '../i18n.js';
import { state, updateProfile, createProfile, deleteProfile, resetProfile, reload } from '../store.js';
import { avatar, profileForm } from '../profiles.js';
import { nextDropText, checkDrops } from '../packs.js';
import { accountPanel } from '../account.js';
import { sumGate } from '../components.js';
import { backupProgress, restoreProgress, restoreText, restoreError } from '../backup.js';

let gateOpen = false;
let selectedId = null;

// Radio buttons for one of the profile's parent settings.
function seg(p, key, options, labelKey, redraw) {
  return h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label(labelKey) },
    options.map(([value, textKey]) => h('button', {
      type: 'button', role: 'radio', class: 'seg__btn', 'aria-checked': String(p.parent[key] === value),
      onclick: async () => { await updateProfile(p.id, { parent: { [key]: value } }); redraw(); },
    }, tx(textKey))));
}

const field = (id, key, control) => h('div', { class: 'field' },
  h('label', { class: 'field__label', for: id }, tx(key)), h('div', { class: 'field__control' }, control));

// ---------- Sections ----------

function scheduleSection(p, redraw) {
  // 1 Nov 2026 is a Sunday, so day d of that week has getDay() === d.
  const day = h('select', {
    id: 'pa-day', class: 'input input--wide',
    onchange: async e => { await updateProfile(p.id, { parent: { dropDay: Number(e.target.value) } }); await checkDrops(); redraw(); },
  }, [0, 1, 2, 3, 4, 5, 6].map(d => h('option', { value: d, selected: d === p.parent.dropDay },
    plain(dateText(new Date(2026, 10, 1 + d), { weekday: 'long' })))));
  const time = h('input', {
    id: 'pa-time', class: 'input', type: 'time', value: p.parent.dropTime, required: true,
    onchange: async e => { if (e.target.value) { await updateProfile(p.id, { parent: { dropTime: e.target.value } }); await checkDrops(); redraw(); } },
  });
  return [
    h('div', { class: 'field-row' }, field('pa-day', 'parents.dropDay', day), field('pa-time', 'parents.dropTime', time)),
    h('p', { class: 'muted' }, tx('parents.dropNote')),
    p.id === state.profile?.id && h('p', null, bi(nextDropText())),
  ];
}

function unitsSection(p, redraw) {
  return [
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, tx('parents.length')),
      seg(p, 'length', [['metric', 'parents.metric'], ['imperial', 'parents.imperial']], 'parents.length', redraw)),
    h('div', { class: 'field' }, h('span', { class: 'field__label' }, tx('parents.temp')),
      seg(p, 'temp', [['C', 'parents.celsius'], ['F', 'parents.fahrenheit']], 'parents.temp', redraw)),
  ];
}

function previewSection(p) {
  return h('label', { class: 'switch' },
    // Preview also lets packs arrive before their cards are ready, to try them out.
    h('input', { type: 'checkbox', checked: p.parent.preview, onchange: async e => { await updateProfile(p.id, { parent: { preview: e.target.checked } }); await checkDrops(); } }),
    h('span', { class: 'switch__track', 'aria-hidden': 'true' }),
    h('span', null, tx('parents.previewOn')));
}

function profileSection(p, redraw) {
  const msg = h('p', { class: 'muted', role: 'status' });
  return h('div', { class: 'parent' },
    h('button', {
      class: 'btn btn--soft', type: 'button',
      onclick: async () => {
        const fields = await profileForm({ profile: p });
        if (fields) { await updateProfile(p.id, fields); redraw(); }
      },
    }, h('span', { 'aria-hidden': 'true' }, '✏️'), tx('profile.edit')),
    h('button', {
      class: 'btn btn--danger', type: 'button',
      onclick: async () => {
        if (!window.confirm(label('parents.resetConfirm', { name: p.name }))) return;
        await resetProfile(p.id);
        mount(msg, tx('parents.resetDone', { name: p.name }));
      },
    }, tx('parents.reset')),
    h('button', {
      class: 'btn btn--danger', type: 'button',
      onclick: async () => {
        if (!window.confirm(label('parents.deleteConfirm', { name: p.name }))) return;
        selectedId = null;
        await deleteProfile(p.id);
        if (state.profile) redraw();
      },
    }, tx('parents.delete')),
    msg);
}

const SECTIONS = [
  { id: 'packs', icon: '🎁', title: 'parents.packs', render: scheduleSection },
  { id: 'units', icon: '📏', title: 'parents.units', render: unitsSection },
  { id: 'preview', icon: '👀', title: 'parents.preview', render: previewSection },
  { id: 'profile', icon: '🧒', title: 'parents.profile', render: profileSection },
];

// Everything on this device, every explorer: a panel of its own, not a section.
function backupPanel(redraw) {
  const msg = h('p', { class: 'muted', role: 'status' });
  const file = h('input', {
    type: 'file', accept: '.json,application/json', hidden: true,
    onchange: async e => {
      const f = e.target.files?.[0];
      file.value = '';
      if (!f) return;
      try {
        const n = await restoreProgress(await f.text());
        await reload();
        redraw();
        mount($('[data-section="backup"] [role="status"]') ?? msg, restoreText(n));
      } catch (err) {
        mount(msg, restoreError(err));
      }
    },
  });
  const btn = h('button', {
    class: 'btn btn--soft', type: 'button',
    onclick: async () => {
      btn.disabled = true;
      mount(msg);
      try {
        const how = await backupProgress();
        if (how !== 'cancelled') mount(msg, tx(how === 'shared' ? 'parents.backupDone' : 'parents.backupDownloaded'));
      } catch (err) {
        console.error(err);
        mount(msg, tx('parents.backupFailed'));
      } finally {
        btn.disabled = false;
      }
    },
  }, h('span', { 'aria-hidden': 'true' }, '💾'), tx('parents.backupSave'));
  return h('div', { class: 'panel', 'data-section': 'backup' },
    h('h2', { class: 'panel__title' }, h('span', { 'aria-hidden': 'true' }, '💾 '), tx('parents.backup')),
    h('p', { class: 'muted' }, tx('parents.backupNote')),
    h('p', { class: 'muted' }, tx('parents.restoreNote')),
    h('div', { class: 'row-actions' }, btn,
      h('button', { class: 'btn btn--soft', type: 'button', onclick: () => file.click() },
        h('span', { 'aria-hidden': 'true' }, '📥'), tx('parents.restore')),
      file),
    msg);
}

// ---------- Page ----------

function renderGate(main) {
  const gate = sumGate(() => { gateOpen = true; draw(main); });
  mount(main, h('section', { class: 'page parents' }, title(), h('div', { class: 'panel' }, gate)));
  gate.querySelector('input').focus();
}

const title = () => h('h1', { class: 'page__title' }, h('span', { 'aria-hidden': 'true' }, '🔒'), tx('parents.title'));

function draw(main) {
  const p = state.profiles.find(x => x.id === selectedId) ?? state.profile ?? state.profiles[0];
  if (!p) return;
  selectedId = p.id;
  const redraw = () => draw(main);

  const addProfile = async () => {
    const fields = await profileForm();
    if (!fields) return;
    selectedId = (await createProfile(fields)).id;
    redraw();
  };
  const who = h('div', { class: 'who', role: 'radiogroup', 'aria-label': label('parents.who') },
    state.profiles.map(x => h('button', {
      type: 'button', role: 'radio', class: 'who__btn', 'aria-checked': String(x.id === p.id),
      onclick: () => { selectedId = x.id; redraw(); },
    }, avatar(x), h('span', { class: 'who__name' }, x.name))),
    h('button', { type: 'button', class: 'who__btn', onclick: addProfile },
      h('span', { class: 'avatar avatar--add', 'aria-hidden': 'true' }, '+'), h('span', { class: 'who__name' }, tx('profile.add'))));

  mount(main, h('section', { class: 'page parents' },
    title(),
    accountPanel(),
    h('div', { class: 'panel' }, h('h2', { class: 'panel__title' }, tx('parents.who')), who),
    SECTIONS.map(s => h('div', { class: 'panel', 'data-section': s.id },
      h('h2', { class: 'panel__title' }, h('span', { 'aria-hidden': 'true' }, `${s.icon} `), tx(s.title, { name: p.name })),
      s.render(p, redraw))),
    backupPanel(redraw)));
}

export function render(main) {
  selectedId = state.profile?.id ?? null;
  if (gateOpen) draw(main); else renderGate(main);
  return () => { gateOpen = false; };
}
