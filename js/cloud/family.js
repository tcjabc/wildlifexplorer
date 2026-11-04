// The grown-ups of a family account: who is in it, inviting another grown-up, cancelling an
// invite, removing a parent (the owner), leaving (a parent), and accepting an invite. All
// of it goes through the functions of supabase/migrations/…_family_invites.sql, which check
// who is asking; nothing here decides who may do what.
// Every call throws an AuthError: 'offline', 'needs-sign-in' / 'signed-out', 'unknown', or
// the function's own reason: 'not-owner' · 'not-member' · 'bad-email' · 'already-member' ·
// 'family-full' · 'not-found' · 'expired' · 'not-alone' · 'has-explorers' · 'is-owner'.
import { auth as defaultAuth, AuthError } from './auth.js';

export const REASONS = new Set(['not-owner', 'not-member', 'bad-email', 'already-member', 'family-full',
  'not-found', 'expired', 'not-alone', 'has-explorers', 'is-owner']);

export function createFamily({ auth = defaultAuth } = {}) {
  async function rpc(name, args = {}) {
    const res = await auth.authFetch(`/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const text = await res.text().catch(() => '');
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (res.status >= 200 && res.status < 300) return body;
    if (res.status === 408 || res.status === 429 || res.status >= 500) throw new AuthError('offline', `${name} ${res.status}`);
    const reason = body?.message;
    throw new AuthError(REASONS.has(reason) ? reason : 'unknown', `${name} ${res.status} ${body?.code ?? ''}`.trim());
  }

  return {
    // { me: { userId, role }, members: [{ userId, email, role, joinedAt }],
    //   invites: [{ id, email, expiresAt, expired }] (the owner's only) }
    people: () => rpc('family_people'),
    // Invite an email (or the same one again, for another 7 days): { id, email, expiresAt }.
    invite: email => rpc('invite_parent', { email }),
    cancelInvite: id => rpc('cancel_invite', { invite_id: id }),
    removeParent: userId => rpc('remove_parent', { user_id: userId }),
    leave: () => rpc('leave_family'),
    // Open invites to the signed-in email: [{ id, ownerEmail, expiresAt }].
    myInvites: () => rpc('my_invites'),
    // Join the invite's family; resolves with its id.
    accept: id => rpc('accept_invite', { invite_id: id }),
    decline: id => rpc('decline_invite', { invite_id: id }),
  };
}

export const family = createFamily();
