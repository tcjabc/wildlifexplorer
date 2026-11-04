// js/cloud/family.js: each call goes to its function (supabase/migrations/…_family_invites.sql)
// with the right arguments, and the function's reasons come back as AuthError codes. Who may
// do what is checked by the database itself: supabase/tests/rls_check.sql.
// Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFamily } from '../js/cloud/family.js';
import { AuthError } from '../js/cloud/auth.js';

// A fake authFetch: answers with reply(name, args), records every call.
function setup(reply) {
  const calls = [];
  const auth = {
    authFetch: async (path, init = {}) => {
      const name = path.replace('/rest/v1/rpc/', '');
      const args = JSON.parse(init.body);
      calls.push({ path, name, args, method: init.method, type: init.headers?.['Content-Type'] });
      const [status, body] = reply(name, args);
      return { status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
    },
  };
  return { family: createFamily({ auth }), calls };
}

test('each call goes to its function, as a POST with JSON arguments', async () => {
  const { family, calls } = setup(name => [200, name === 'accept_invite' ? 'family-2' : name === 'my_invites' ? [] : null]);
  await family.people();
  await family.invite('Gran@Example.test');
  await family.cancelInvite('inv-1');
  await family.removeParent('user-2');
  await family.leave();
  assert.deepEqual(await family.myInvites(), []);
  assert.equal(await family.accept('inv-2'), 'family-2');
  await family.decline('inv-3');
  assert.deepEqual(calls.map(c => [c.name, c.args]), [
    ['family_people', {}],
    ['invite_parent', { email: 'Gran@Example.test' }],
    ['cancel_invite', { invite_id: 'inv-1' }],
    ['remove_parent', { user_id: 'user-2' }],
    ['leave_family', {}],
    ['my_invites', {}],
    ['accept_invite', { invite_id: 'inv-2' }],
    ['decline_invite', { invite_id: 'inv-3' }],
  ]);
  assert.ok(calls.every(c => c.method === 'POST' && c.type === 'application/json' && c.path.startsWith('/rest/v1/rpc/')));
});

test("the function's reason becomes the error code; anything else is unknown, a busy server is offline", async () => {
  const { family } = setup(name => ({
    invite_parent: [400, { code: 'P0001', message: 'not-owner' }],
    accept_invite: [400, { code: 'P0001', message: 'has-explorers' }],
    leave_family: [400, { code: 'P0001', message: 'is-owner' }],
    remove_parent: [400, { code: '42883', message: 'function public.remove_parent does not exist' }],
    cancel_invite: [403, { code: '42501', message: 'permission denied for function cancel_invite' }],
    family_people: [503, { message: 'busy' }],
  }[name]));
  const code = c => e => e instanceof AuthError && e.code === c;
  await assert.rejects(family.invite('x@example.test'), code('not-owner'));
  await assert.rejects(family.accept('inv-1'), code('has-explorers'));
  await assert.rejects(family.leave(), code('is-owner'));
  await assert.rejects(family.removeParent('user-2'), code('unknown'));
  await assert.rejects(family.cancelInvite('inv-1'), code('unknown'));
  await assert.rejects(family.people(), code('offline'));
});

test('offline (authFetch throws) stays offline', async () => {
  const family = createFamily({ auth: { authFetch: async () => { throw new AuthError('offline'); } } });
  await assert.rejects(family.people(), e => e.code === 'offline');
});
