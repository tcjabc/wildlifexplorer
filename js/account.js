// The family account, for grown-ups: the "Family account" panel in the Parents area (email
// a code, type it in, choose which explorers to add the first time, see whether everything
// is saved, sign out) and the sheet that asks before an email link signs this device in.
// Signing in is optional (see README, Family accounts).
import { h, mount } from './dom.js';
import { tx, label } from './i18n.js';
import { auth, AuthError } from './cloud/auth.js';
import { sync } from './cloud/sync.js';
import { avatar } from './profiles.js';
import { CODE_LENGTH } from './config.js';

const RESEND_MS = 60 * 1000; // the project lets a code be emailed once a minute
let pending = null; // { email, sentAt } while waiting for the code

const errorKey = err => `account.err.${err instanceof AuthError ? err.code : 'unknown'}`;
const field = (id, key, control, hint) => h('div', { class: 'field' },
  h('label', { class: 'field__label', for: id }, tx(key)), h('div', { class: 'field__control' }, control), hint);

// Run fn with the button busy and the error line cleared; show the error if it fails.
async function busy(btn, error, fn) {
  error.hidden = true;
  btn.disabled = true;
  try {
    await fn();
  } catch (err) {
    if (!(err instanceof AuthError)) console.error(err);
    mount(error, tx(errorKey(err)));
    error.hidden = false;
  } finally {
    btn.disabled = false;
  }
}

function emailStep(el, state, error) {
  const email = h('input', {
    id: 'acct-email', class: 'input input--wide', type: 'email', inputmode: 'email', autocomplete: 'email',
    autocapitalize: 'off', spellcheck: 'false', value: state.email ?? '',
  });
  const send = h('button', { class: 'btn btn--primary', type: 'submit' }, tx('account.send'));
  const form = h('form', { class: 'form', novalidate: true },
    field('acct-email', 'account.email', email), error, h('div', { class: 'sheet__actions' }, send));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const value = email.value.trim();
    if (!value.includes('@')) { mount(error, tx('account.emailNeeded')); error.hidden = false; email.focus(); return; }
    busy(send, error, async () => {
      await auth.sendCode(value);
      pending = { email: value, sentAt: Date.now() };
      render(el);
    });
  });
  return form;
}

function codeStep(el, error) {
  const code = h('input', {
    id: 'acct-code', class: 'input input--code', type: 'text', inputmode: 'numeric', pattern: '[0-9]*',
    autocomplete: 'one-time-code', spellcheck: 'false', // no maxlength, so a pasted "1234 5678" fits
  });
  const go = h('button', { class: 'btn btn--primary', type: 'submit' }, tx('account.verify'));
  const resend = h('button', { class: 'btn btn--soft', type: 'button' });
  const other = h('button', { class: 'btn btn--soft', type: 'button', onclick: () => { pending = null; render(el); } }, tx('account.otherEmail'));

  // "Send again" counts down until the project allows another email.
  const tick = () => {
    const left = Math.ceil((pending.sentAt + RESEND_MS - Date.now()) / 1000);
    resend.disabled = left > 0;
    mount(resend, left > 0 ? tx('account.resendIn', { s: left }) : tx('account.resend'));
    return left > 0;
  };
  if (tick()) {
    const timer = setInterval(() => { if (!resend.isConnected || !tick()) clearInterval(timer); }, 1000);
  }
  resend.addEventListener('click', () => busy(resend, error, async () => {
    await auth.sendCode(pending.email);
    pending = { ...pending, sentAt: Date.now() };
    render(el);
  }));

  const form = h('form', { class: 'form', novalidate: true },
    h('p', { role: 'status' }, tx('account.sentTo', { email: pending.email })),
    field('acct-code', 'account.code', code, h('p', { class: 'muted' }, tx('account.codeHint', { n: CODE_LENGTH }))),
    error,
    h('div', { class: 'sheet__actions' }, go, resend, other));
  form.addEventListener('submit', e => {
    e.preventDefault();
    const value = code.value.replace(/\D+/g, ''); // spaces or dashes copied from the email are fine
    if (!new RegExp(`^\\d{${CODE_LENGTH}}$`).test(value)) {
      mount(error, tx('account.codeNeeded', { n: CODE_LENGTH }));
      error.hidden = false;
      code.focus();
      return;
    }
    busy(go, error, async () => {
      await auth.verifyCode(pending.email, value);
      pending = null;
      render(el);
    });
  });
  requestAnimationFrame(() => code.focus());
  return form;
}

// The first time a parent signs in on this device: which explorers to add. All ticked;
// unticked ones stay on this device only. Asked once per device.
function chooseStep(el, list, error) {
  const boxes = list.map(p => h('input', { type: 'checkbox', checked: true, value: p.id }));
  const go = h('button', { class: 'btn btn--primary', type: 'submit' }, tx('sync.chooseGo'));
  const form = h('form', { class: 'form', novalidate: true },
    h('h3', { class: 'panel__title' }, tx('sync.chooseTitle')),
    list.map((p, i) => h('label', { class: 'switch' }, boxes[i], h('span', { class: 'switch__track', 'aria-hidden': 'true' }),
      avatar(p), h('span', null, p.name))),
    h('p', { class: 'muted' }, tx('sync.chooseNote')),
    error,
    h('div', { class: 'sheet__actions' }, go));
  form.addEventListener('submit', e => {
    e.preventDefault();
    busy(go, error, async () => {
      await sync.setUp(boxes.filter(b => b.checked).map(b => b.value));
      render(el);
    });
  });
  return form;
}

// One line on whether everything is saved, and which explorers stay on this device only.
function statusLines(s) {
  if (s.stage === 'other-account') return h('p', { class: 'form__error' }, tx('sync.otherAccount', { email: s.email }));
  const key = s.busy ? 'sync.saving'
    : s.problem === 'offline' ? 'sync.offline'
      : s.problem === 'server' ? 'sync.retry'
        : s.waiting ? 'sync.waiting' : 'sync.saved';
  return [
    h('p', { role: 'status' }, tx(key)),
    s.held > 0 && h('p', { class: 'form__error' }, tx('sync.held')),
    s.localOnly.length > 0 && [h('p', { class: 'muted' }, tx('sync.localOnly')),
      h('div', { class: 'who' }, s.localOnly.map(p => h('span', { class: 'who__btn' }, avatar(p), h('span', { class: 'who__name' }, p.name))))],
  ];
}

// The status keeps itself up to date while it is on screen.
const statusBoxes = new Set();
sync.onChange(async () => {
  for (const box of statusBoxes) {
    if (!box.isConnected) { statusBoxes.delete(box); continue; }
    mount(box, statusLines(await sync.status()));
  }
});

async function signedInStep(el, state, error) {
  const out = h('button', { class: 'btn btn--soft', type: 'button' }, tx('account.signOut'));
  out.addEventListener('click', () => {
    if (!window.confirm(label('account.signOutConfirm'))) return;
    busy(out, error, async () => { await auth.signOut(); render(el); });
  });
  const who = h('p', { role: 'status' }, tx('account.signedInAs', { email: state.email }));
  const actions = h('div', { class: 'sheet__actions' }, out);
  if (await sync.stage() === 'choose') {
    const list = await sync.candidates();
    if (list.length) return [who, chooseStep(el, list, error), actions];
    await sync.setUp([]).catch(err => console.error(err)); // nothing to choose: new explorers just go up
  }
  const box = h('div', null, statusLines(await sync.status()));
  statusBoxes.add(box);
  return [who, box, error, actions];
}

async function render(el) {
  const state = await auth.state();
  const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
  const body = state.signedIn
    ? await signedInStep(el, state, error)
    : [
      state.needsSignIn && h('p', { class: 'form__error' }, tx('account.needsSignIn', { email: state.email })),
      pending ? codeStep(el, error) : emailStep(el, state, error),
    ];
  mount(el,
    h('h2', { class: 'panel__title' }, h('span', { 'aria-hidden': 'true' }, '☁️ '), tx('account.title')),
    !state.signedIn && h('p', null, tx('account.intro')),
    h('p', { class: 'muted' }, tx('account.syncs')),
    body);
}

// The Parents-area panel. It fills itself in (the session is read from IndexedDB).
export function accountPanel() {
  const el = h('div', { class: 'panel', 'data-section': 'account' });
  render(el);
  return el;
}

// Opened from the email link (?token_hash=…&type=email): take the token out of the address
// straight away, then ask before signing this device in. Resolves when the sheet is closed.
export async function handleSignInLink() {
  const params = new URLSearchParams(location.search);
  const tokenHash = params.get('token_hash');
  if (!tokenHash || params.get('type') !== 'email') return;
  history.replaceState(null, '', location.pathname + location.hash);

  const dialog = h('dialog', { class: 'sheet', 'aria-labelledby': 'link-title' });
  const close = resolve => () => { dialog.close(); dialog.remove(); resolve(); };
  await new Promise(resolve => {
    const finish = close(resolve);
    const show = (titleKey, textKey, vars, actions) => mount(dialog,
      h('h2', { class: 'sheet__title', id: 'link-title' }, tx(titleKey)),
      h('p', { role: 'status' }, tx(textKey, vars)),
      h('div', { class: 'sheet__actions' }, actions));
    const ok = () => h('button', { class: 'btn btn--primary', type: 'button', onclick: finish }, tx('link.ok'));
    const yes = h('button', {
      class: 'btn btn--primary', type: 'button',
      onclick: async () => {
        yes.disabled = true;
        try {
          const rec = await auth.verifyLink(tokenHash);
          show('link.doneTitle', 'link.done', { email: rec.email }, ok());
        } catch (err) {
          show('link.failedTitle', err instanceof AuthError && err.code === 'offline' ? 'account.err.offline' : 'link.failed', {}, ok());
        }
      },
    }, tx('link.yes'));
    show('link.title', 'link.text', {}, [h('button', { class: 'btn btn--soft', type: 'button', onclick: finish }, tx('link.no')), yes]);
    dialog.addEventListener('cancel', e => { e.preventDefault(); finish(); });
    document.body.append(dialog);
    dialog.showModal();
  });
}
