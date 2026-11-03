// Parents' sign-in (Supabase Auth), with plain fetch: email a code, verify the code (or the
// link's token_hash), keep the session on the device, refresh it, sign out. Kids never sign
// in, and nothing here ever blocks the app: without a session it simply runs on its own.
//
// The session is kept with the device's own expiry time (now + expires_in), so a tablet
// whose clock is wrong still refreshes on time. Refresh tokens can be used only once, so
// every refresh runs under one lock shared by all tabs, and re-reads the stored session
// inside it (another tab may have refreshed already). Being offline never signs anyone
// out; only a refresh token the server rejects does ("Sign in again to sync").
//
// Stored record: { email, accessToken, refreshToken, expiresAt (ms, this device's clock),
// userId } when signed in; { email, needsSignIn: true } after the server ended the session;
// null when signed out.
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';
import { getMeta, setMeta } from '../db.js';

const REFRESH_MARGIN_MS = 60 * 1000; // refresh when less than a minute is left
const TIMEOUT_MS = 15 * 1000;
// Refresh answers that mean the session is over (anything else: try again later).
const SESSION_GONE = new Set(['refresh_token_not_found', 'refresh_token_already_used', 'session_not_found',
  'session_expired', 'invalid_grant', 'user_not_found', 'user_banned']);

// Why a call failed: 'offline', 'rate-limit', 'bad-code', 'bad-email', 'not-allowed' (new
// sign-ups switched off), 'signed-out', 'needs-sign-in' or 'unknown'.
export class AuthError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

// Where the email link should come back to: this page, without its query or hash, so the
// template can always add "?token_hash=…" (whatever path the app is served under).
export const redirectUrl = loc => loc.origin + loc.pathname;

function errorCode(status, body) {
  const code = body?.error_code ?? body?.error ?? '';
  if (status === 429 || /rate_limit/.test(code)) return 'rate-limit';
  if (/signup_disabled|email_address_not_authorized/.test(code)) return 'not-allowed';
  if (/email_address_invalid|validation_failed/.test(code)) return 'bad-email';
  if (/otp_expired/.test(code) || status === 403) return 'bad-code';
  return 'unknown';
}

// One lock for all tabs (Web Locks), or a queue within this page where there are none.
function makeLock(locks) {
  let queue = Promise.resolve();
  return fn => {
    const l = locks();
    if (l?.request) return l.request('wildfile-auth', fn);
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
}

export function createAuth({
  url, key, store,
  fetch = (...a) => globalThis.fetch(...a),
  now = Date.now,
  locks = () => globalThis.navigator?.locks,
  location = () => globalThis.location,
}) {
  const events = new EventTarget();
  const changed = () => events.dispatchEvent(new Event('change'));
  const withLock = makeLock(locks);

  // fetch to the Auth API. Returns { status, body }; throws AuthError('offline') when the
  // request doesn't get an answer.
  async function call(path, { method = 'POST', body, token } = {}) {
    const headers = { apikey: key, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    let res;
    try {
      res = await fetch(`${url}/auth/v1/${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        signal: globalThis.AbortSignal?.timeout?.(TIMEOUT_MS),
      });
    } catch (err) {
      throw new AuthError('offline', err?.message);
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, body: json };
  }

  async function save(record) {
    await store.set(record);
    changed();
    return record;
  }

  const fromSession = (s, email) => ({
    email: s.user?.email ?? email ?? null,
    userId: s.user?.id ?? null,
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAt: now() + Number(s.expires_in) * 1000, // the server's expires_at is ignored on purpose
  });

  async function verify(body, email) {
    const { status, body: res } = await call('verify', { body: { type: 'email', ...body } });
    if (status !== 200 || !res?.access_token) throw new AuthError(errorCode(status, res), res?.error_code);
    return save(fromSession(res, email));
  }

  // Refresh under the lock. force: refresh even if the stored token looks fine (after a 401
  // for the token in `used`). Returns the stored record afterwards.
  function refresh({ force = false, used = null } = {}) {
    return withLock(async () => {
      const rec = await store.get();
      if (!rec?.refreshToken) return rec;
      const fresh = rec.expiresAt - now() > REFRESH_MARGIN_MS;
      if (fresh && (!force || rec.accessToken !== used)) return rec; // fine, or another tab refreshed it
      const { status, body } = await call('token?grant_type=refresh_token', { body: { refresh_token: rec.refreshToken } });
      if (status === 200 && body?.access_token) return save(fromSession(body, rec.email));
      if ((status === 400 || status === 401 || status === 403) && SESSION_GONE.has(body?.error_code ?? body?.error)) {
        return save({ email: rec.email, needsSignIn: true });
      }
      throw new AuthError(status === 429 ? 'rate-limit' : 'offline', `refresh ${status}`);
    });
  }

  // A valid access token, refreshing first if it is about to run out. null when signed out
  // or when the server ended the session. Throws AuthError('offline') when the token has run
  // out and can't be refreshed right now (the session is kept for later).
  async function accessToken() {
    let rec = await store.get();
    if (!rec?.accessToken) return null;
    if (rec.expiresAt - now() > REFRESH_MARGIN_MS) return rec.accessToken;
    try {
      rec = await refresh();
    } catch (err) {
      if (err instanceof AuthError && err.code === 'offline' && rec.expiresAt > now()) return rec.accessToken;
      throw err;
    }
    return rec?.accessToken ?? null;
  }

  return {
    onChange: fn => events.addEventListener('change', fn),

    // For the screens and sync: { email, userId, signedIn, needsSignIn }. No network.
    async state() {
      const rec = await store.get();
      return {
        email: rec?.email ?? null, userId: rec?.userId ?? null,
        signedIn: Boolean(rec?.accessToken), needsSignIn: Boolean(rec?.needsSignIn),
      };
    },

    // Email a sign-in code (and link). A new address gets an account (and a family).
    async sendCode(email) {
      const back = encodeURIComponent(redirectUrl(location()));
      const { status, body } = await call(`otp?redirect_to=${back}`, { body: { email, create_user: true } });
      if (status !== 200) throw new AuthError(errorCode(status, body), body?.error_code);
    },

    verifyCode: (email, code) => verify({ email, token: code }, email),
    verifyLink: tokenHash => verify({ token_hash: tokenHash }),
    accessToken,

    // fetch with the parent's session, for the Data API (sync). One refresh and retry on 401.
    async authFetch(path, init = {}) {
      const send = token => fetch(`${url}${path}`, {
        ...init,
        headers: { ...init.headers, apikey: key, Authorization: `Bearer ${token}` },
        signal: init.signal ?? globalThis.AbortSignal?.timeout?.(TIMEOUT_MS),
      }).catch(err => { throw new AuthError('offline', err?.message); });
      const token = await accessToken();
      if (!token) throw new AuthError((await store.get())?.needsSignIn ? 'needs-sign-in' : 'signed-out');
      let res = await send(token);
      if (res.status !== 401) return res;
      const rec = await refresh({ force: true, used: token });
      if (!rec?.accessToken) throw new AuthError('needs-sign-in');
      res = await send(rec.accessToken);
      if (res.status === 401) {
        await save({ email: rec.email, needsSignIn: true });
        throw new AuthError('needs-sign-in');
      }
      return res;
    },

    // Sign out on this device. Tells the server too when it can; offline, the device forgets
    // the session anyway.
    async signOut() {
      const rec = await store.get();
      if (rec?.accessToken) await call('logout?scope=local', { token: rec.accessToken }).catch(() => {});
      await save(null);
    },
  };
}

export const auth = createAuth({
  url: SUPABASE_URL,
  key: SUPABASE_KEY,
  store: { get: () => getMeta('auth', null), set: v => setMeta('auth', v) },
});
