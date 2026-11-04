// Tests for js/cloud/auth.js with a fake Supabase Auth server, clock, lock and store.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAuth, redirectUrl, AuthError } from '../js/cloud/auth.js';

const URL_ = 'https://example.supabase.co';
const HOUR = 3600;

// A fake server: routes by path, records every request. A route returns [status, body],
// or throws to act like the network is down.
function setup({ routes = {}, start = Date.UTC(2026, 10, 3, 12), locks = 'fake' } = {}) {
  let clock = start;
  const calls = [];
  let stored = null;
  let n = 0;
  const session = (extra = {}) => ({
    access_token: `access-${++n}`, refresh_token: `refresh-${n}`, expires_in: HOUR,
    expires_at: 0, user: { id: 'user-1', email: 'parent@example.test' }, ...extra,
  });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ path: u.pathname, search: u.search, url, body, headers: init.headers, method: init.method });
    const route = routes[u.pathname] ?? (() => [404, { error_code: 'not_found' }]);
    const [status, json] = await route({ body, url: u, headers: init.headers, session });
    return { status, text: async () => (json === undefined ? '' : JSON.stringify(json)) };
  };
  // Web Locks: one holder at a time, in order.
  let queue = Promise.resolve();
  const fakeLocks = {
    request: (_name, fn) => {
      const run = queue.then(() => fn());
      queue = run.catch(() => {});
      return run;
    },
  };
  const store = { get: async () => structuredClone(stored), set: async v => { stored = structuredClone(v); } };
  const auth = createAuth({
    url: URL_, key: 'sb_publishable_test', store, fetch,
    now: () => clock,
    locks: () => (locks === 'fake' ? fakeLocks : undefined),
    location: () => ({ origin: 'https://wildfile.app', pathname: '/', search: '?a=1', hash: '#/parents' }),
  });
  return {
    auth, calls, session,
    tick: ms => { clock += ms; },
    stored: () => stored,
    setStored: v => { stored = v; },
    count: path => calls.filter(c => c.path === path).length,
  };
}

const verifyOk = ({ session }) => [200, session()];
const refreshOk = ({ session }) => [200, session()];
const offline = () => { throw new TypeError('Failed to fetch'); };

async function signedIn(opts = {}) {
  const s = setup({ ...opts, routes: { '/auth/v1/verify': verifyOk, ...opts.routes } });
  await s.auth.verifyCode('parent@example.test', '12345678');
  return s;
}

test('redirect_to is always origin + pathname: no query, no hash (under a subpath too)', async () => {
  assert.equal(redirectUrl({ origin: 'https://wildfile.app', pathname: '/', search: '?x=1', hash: '#/parents' }), 'https://wildfile.app/');
  assert.equal(redirectUrl({ origin: 'https://wildfile.app', pathname: '/index.html', search: '?token_hash=old&type=email', hash: '#/binder' }),
    'https://wildfile.app/index.html');
  assert.equal(redirectUrl({ origin: 'http://localhost:8080', pathname: '/preview/', search: '?x=1', hash: '#/more' }), 'http://localhost:8080/preview/');
  assert.equal(redirectUrl({ origin: 'http://localhost:8080', pathname: '/', search: '', hash: '' }), 'http://localhost:8080/');
  assert.equal(redirectUrl({ origin: 'https://wildfile.app', pathname: '/', search: '', hash: '#/more' }), 'https://wildfile.app/');

  const s = setup({ routes: { '/auth/v1/otp': () => [200, {}] } });
  await s.auth.sendCode('parent@example.test');
  const call = s.calls.find(c => c.path === '/auth/v1/otp');
  const sent = call.url.match(/[?&]redirect_to=([^&]*)/);
  assert.ok(sent, 'sendCode must send redirect_to');
  const back = decodeURIComponent(sent[1]);
  assert.equal(back, 'https://wildfile.app/');
  assert.ok(!back.includes('?') && !back.includes('#'));
  // What the email template builds from it is a valid URL with the token in the query.
  const link = new URL(`${back}?token_hash=abc&type=email`);
  assert.equal(link.pathname, '/');
  assert.equal(link.searchParams.get('token_hash'), 'abc');
  assert.deepEqual(call.body, { email: 'parent@example.test', create_user: true });
  assert.equal(call.headers.apikey, 'sb_publishable_test');
  assert.equal(call.headers.Authorization, undefined, 'the publishable key is never sent as a bearer token');
});

test('1. verifying a code saves the session with an expiry from expires_in', async () => {
  const s = await signedIn();
  const verify = s.calls.find(c => c.path === '/auth/v1/verify');
  assert.deepEqual(verify.body, { type: 'email', email: 'parent@example.test', token: '12345678' });
  const rec = s.stored();
  assert.equal(rec.accessToken, 'access-1');
  assert.equal(rec.refreshToken, 'refresh-1');
  assert.equal(rec.email, 'parent@example.test');
  assert.equal(rec.expiresAt, Date.UTC(2026, 10, 3, 12) + HOUR * 1000);
  assert.deepEqual(await s.auth.state(), { email: 'parent@example.test', userId: 'user-1', signedIn: true, needsSignIn: false });

  // The link's token_hash takes the same route.
  const l = setup({ routes: { '/auth/v1/verify': verifyOk } });
  await l.auth.verifyLink('hash-1');
  assert.deepEqual(l.calls[0].body, { type: 'email', token_hash: 'hash-1' });
  assert.equal((await l.auth.state()).signedIn, true);
});

test('wrong or expired code, too many emails, and offline give clear errors', async () => {
  const s = setup({ routes: {
    '/auth/v1/verify': () => [403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' }],
    '/auth/v1/otp': () => [429, { code: 429, error_code: 'over_email_send_rate_limit' }],
  } });
  await assert.rejects(s.auth.verifyCode('parent@example.test', '00000000'), e => e instanceof AuthError && e.code === 'bad-code');
  await assert.rejects(s.auth.sendCode('parent@example.test'), e => e.code === 'rate-limit');
  assert.equal(s.stored(), null);
  const o = setup({ routes: { '/auth/v1/otp': offline } });
  await assert.rejects(o.auth.sendCode('parent@example.test'), e => e.code === 'offline');
});

test('a new email nobody invited (the sign-up hook says no, with 403) is not-allowed, not a wrong code', async () => {
  const s = setup({ routes: {
    '/auth/v1/otp': () => [403, { code: 403, msg: 'invite-only: this email has no open invite to a family account' }],
  } });
  await assert.rejects(s.auth.sendCode('someone@example.test'), e => e instanceof AuthError && e.code === 'not-allowed');
  const d = setup({ routes: { '/auth/v1/otp': () => [422, { code: 422, error_code: 'signup_disabled', msg: 'Signups not allowed for otp' }] } });
  await assert.rejects(d.auth.sendCode('someone@example.test'), e => e.code === 'not-allowed');
});

test('2. a token that is not close to running out makes no network call', async () => {
  const s = await signedIn({ routes: { '/auth/v1/token': refreshOk } });
  s.tick(30 * 60 * 1000);
  assert.equal(await s.auth.accessToken(), 'access-1');
  assert.equal(s.count('/auth/v1/token'), 0);
});

test('3. within a minute of expiry: one refresh, and the new refresh token replaces the old', async () => {
  const s = await signedIn({ routes: { '/auth/v1/token': refreshOk } });
  s.tick(HOUR * 1000 - 30 * 1000);
  assert.equal(await s.auth.accessToken(), 'access-2');
  assert.equal(s.count('/auth/v1/token'), 1);
  const refresh = s.calls.find(c => c.path === '/auth/v1/token');
  assert.equal(refresh.search, '?grant_type=refresh_token');
  assert.deepEqual(refresh.body, { refresh_token: 'refresh-1' });
  assert.equal(s.stored().refreshToken, 'refresh-2');
  assert.equal(s.stored().expiresAt, Date.UTC(2026, 10, 3, 12) + (2 * HOUR - 30) * 1000);
  assert.equal(await s.auth.accessToken(), 'access-2');
  assert.equal(s.count('/auth/v1/token'), 1);
});

test('4. calls at the same time make one refresh request (with Web Locks, and without)', async () => {
  for (const locks of ['fake', 'none']) {
    let release;
    const gate = new Promise(r => { release = r; });
    const s = await signedIn({ locks, routes: { '/auth/v1/token': async ctx => { await gate; return refreshOk(ctx); } } });
    s.tick(HOUR * 1000);
    const all = Promise.all([s.auth.accessToken(), s.auth.accessToken(), s.auth.accessToken()]);
    await new Promise(r => setTimeout(r, 10));
    release();
    assert.deepEqual(await all, ['access-2', 'access-2', 'access-2'], `locks: ${locks}`);
    assert.equal(s.count('/auth/v1/token'), 1, `locks: ${locks}`);
  }
});

test('5. a rejected refresh token means "sign in again": tokens cleared, email kept', async () => {
  for (const body of [{ error_code: 'refresh_token_not_found' }, { error: 'invalid_grant', error_description: 'Invalid Refresh Token' }]) {
    const s = await signedIn({ routes: { '/auth/v1/token': () => [400, body] } });
    s.tick(HOUR * 1000);
    assert.equal(await s.auth.accessToken(), null);
    assert.deepEqual(s.stored(), { email: 'parent@example.test', needsSignIn: true });
    assert.deepEqual(await s.auth.state(), { email: 'parent@example.test', userId: null, signedIn: false, needsSignIn: true });
    await assert.rejects(s.auth.authFetch('/rest/v1/profiles'), e => e.code === 'needs-sign-in');
  }
});

test('6. a refresh that fails offline keeps the session and tries again next time', async () => {
  let down = true;
  const s = await signedIn({ routes: { '/auth/v1/token': ctx => (down ? offline() : refreshOk(ctx)) } });
  // Inside the margin but not expired yet: carry on with the old token.
  s.tick(HOUR * 1000 - 30 * 1000);
  assert.equal(await s.auth.accessToken(), 'access-1');
  // Expired and still offline: an 'offline' error, and nothing is forgotten.
  s.tick(60 * 1000);
  await assert.rejects(s.auth.accessToken(), e => e.code === 'offline');
  assert.equal(s.stored().refreshToken, 'refresh-1');
  assert.equal((await s.auth.state()).signedIn, true);
  // Back online: the next call refreshes.
  down = false;
  assert.equal(await s.auth.accessToken(), 'access-2');
  // A server error (5xx) is treated the same way: try again later, stay signed in.
  const e = await signedIn({ routes: { '/auth/v1/token': () => [503, {}] } });
  e.tick(HOUR * 1000);
  await assert.rejects(e.auth.accessToken(), err => err.code === 'offline');
  assert.equal((await e.auth.state()).signedIn, true);
});

test('7. a 401 refreshes once and retries; a second 401 means "sign in again"', async () => {
  let rest401 = 1;
  const s = await signedIn({ routes: {
    '/auth/v1/token': refreshOk,
    '/rest/v1/profiles': ({ headers }) => (rest401-- > 0 ? [401, {}] : [200, [{ bearer: headers.Authorization }]]),
  } });
  const res = await s.auth.authFetch('/rest/v1/profiles', { method: 'GET' });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(await res.text()), [{ bearer: 'Bearer access-2' }]);
  assert.equal(s.count('/auth/v1/token'), 1);
  const rest = s.calls.filter(c => c.path === '/rest/v1/profiles');
  assert.equal(rest[0].headers.Authorization, 'Bearer access-1');
  assert.equal(rest[0].headers.apikey, 'sb_publishable_test');

  const t = await signedIn({ routes: { '/auth/v1/token': refreshOk, '/rest/v1/profiles': () => [401, {}] } });
  await assert.rejects(t.auth.authFetch('/rest/v1/profiles'), e => e.code === 'needs-sign-in');
  assert.equal(t.count('/auth/v1/token'), 1);
  assert.deepEqual(await t.auth.state(), { email: 'parent@example.test', userId: null, signedIn: false, needsSignIn: true });
});

test('8. a device clock hours away from the server\'s still refreshes on time', async () => {
  for (const offsetHours of [+7, -9]) {
    // The server stamps expires_at by its own clock; the device's clock is hours off.
    const serverNow = Date.UTC(2026, 10, 3, 12) / 1000;
    const s = setup({
      start: Date.UTC(2026, 10, 3, 12) + offsetHours * HOUR * 1000,
      routes: {
        '/auth/v1/verify': ({ session }) => [200, session({ expires_at: serverNow + HOUR })],
        '/auth/v1/token': ({ session }) => [200, session({ expires_at: serverNow + 2 * HOUR })],
      },
    });
    await s.auth.verifyCode('parent@example.test', '12345678');
    assert.equal(await s.auth.accessToken(), 'access-1', `offset ${offsetHours}h: fresh token used as is`);
    assert.equal(s.count('/auth/v1/token'), 0);
    s.tick(50 * 60 * 1000);
    assert.equal(await s.auth.accessToken(), 'access-1');
    s.tick(9.5 * 60 * 1000);
    assert.equal(await s.auth.accessToken(), 'access-2', `offset ${offsetHours}h: refreshed a minute before expiry`);
  }
});

test('9. signing out tells the server when it can, and forgets the session even offline', async () => {
  const s = await signedIn({ routes: { '/auth/v1/logout': () => [204, undefined] } });
  await s.auth.signOut();
  const logout = s.calls.find(c => c.path === '/auth/v1/logout');
  assert.equal(logout.search, '?scope=local');
  assert.equal(logout.headers.Authorization, 'Bearer access-1');
  assert.equal(s.stored(), null);

  const o = await signedIn({ routes: { '/auth/v1/logout': offline } });
  await o.auth.signOut();
  assert.equal(o.stored(), null);
  assert.deepEqual(await o.auth.state(), { email: null, userId: null, signedIn: false, needsSignIn: false });
  assert.equal(await o.auth.accessToken(), null);
});
