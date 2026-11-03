// The family account, for grown-ups: the "Family account" panel in the Parents area (email
// a code, type it in, sign out) and the sheet that asks before an email link signs this
// device in. Signing in is optional; nothing syncs yet (see README, Family accounts).
import { h, mount } from './dom.js';
import { tx, label } from './i18n.js';
import { auth, AuthError } from './cloud/auth.js';
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

function signedInStep(el, state, error) {
  const out = h('button', { class: 'btn btn--soft', type: 'button' }, tx('account.signOut'));
  out.addEventListener('click', () => {
    if (!window.confirm(label('account.signOutConfirm'))) return;
    busy(out, error, async () => { await auth.signOut(); render(el); });
  });
  return [h('p', { role: 'status' }, tx('account.signedInAs', { email: state.email })), error,
    h('div', { class: 'sheet__actions' }, out)];
}

async function render(el) {
  const state = await auth.state();
  const error = h('p', { class: 'form__error', role: 'alert', hidden: true });
  const body = state.signedIn
    ? signedInStep(el, state, error)
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
