-- Inviting another grown-up into the family.
-- The owner invites an email address. That grown-up signs in with it (sign-ups are open
-- only to invited addresses: the before-user-created hook below), gets an empty family of
-- their own as every new user does, and is then asked in the app whether to join. Joining
-- moves them into the owner's family as 'parent'; their empty family is deleted
-- (migration 4). Nothing here sends email: the owner tells them to sign in.
--   owner   invites, cancels invites, removes parents
--   parent  sees the family's grown-ups, can leave the family
-- Every grown-up is in exactly one family at all times: removing or leaving gives them a
-- new empty family of their own. When the owner's account is deleted, the parent who has
-- been in the family longest becomes the owner.
-- Clients reach invites and memberships only through the functions below (no table
-- grants). Each one checks who the caller is and raises an exception whose message is a
-- short code the app translates: not-owner · not-member · bad-email · already-member ·
-- family-full · not-found · expired · not-alone · has-explorers · is-owner.

-- ---------- One family per grown-up ----------

create unique index family_members_one_family_idx on public.family_members (user_id);
drop index public.family_members_user_id_idx; -- covered by the unique index

-- ---------- Invites ----------

create table public.family_invites (
  id         uuid primary key default gen_random_uuid(),
  family_id  uuid not null references public.families (id) on delete cascade,
  email      text not null check (email = lower(email) and char_length(email) between 3 and 254),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint family_invites_family_email unique (family_id, email)
);
create index family_invites_email_idx on public.family_invites (email);

-- Nobody reaches this table through the Data API. The auth server reads it (the hook).
revoke all on table public.family_invites from anon, authenticated;
alter table public.family_invites enable row level security;

grant usage on schema public to supabase_auth_admin;
grant select (email, expires_at) on table public.family_invites to supabase_auth_admin;
create policy "The auth server reads invites"
  on public.family_invites for select to supabase_auth_admin
  using (true);

-- ---------- Helpers (not exposed) ----------

-- The caller's membership: family and role, or nothing.
create function private.my_membership(out family_id uuid, out role text)
language sql
stable
security definer
set search_path = ''
as $$
  select m.family_id, m.role from public.family_members m where m.user_id = (select auth.uid())
$$;
revoke all on function private.my_membership() from public;

-- The caller's own email, as the auth server has it (proved by the sign-in code).
create function private.my_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u where u.id = (select auth.uid())
$$;
revoke all on function private.my_email() from public;

-- Give a grown-up who has just left a family a new empty one of their own.
create function private.new_family_for(uid uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  fid uuid;
begin
  insert into public.families (created_by) values (uid) returning id into fid;
  insert into public.family_members (family_id, user_id, role) values (fid, uid, 'owner');
  return fid;
end;
$$;
revoke all on function private.new_family_for(uuid) from public;

-- ---------- For the owner ----------

-- Invite an email address, or invite it again (a new 7 days). At most 4 grown-ups per
-- family, counting open invites.
create function public.invite_parent(email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me record;
  addr text := lower(trim(email));
  inv public.family_invites;
begin
  select * into me from private.my_membership();
  if me.role is distinct from 'owner' then raise exception 'not-owner'; end if;
  if addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(addr) > 254 then raise exception 'bad-email'; end if;
  if exists (select 1 from public.family_members m join auth.users u on u.id = m.user_id
             where m.family_id = me.family_id and lower(u.email) = addr) then
    raise exception 'already-member';
  end if;
  if (select count(*) from public.family_members m where m.family_id = me.family_id)
     + (select count(*) from public.family_invites i
        where i.family_id = me.family_id and i.expires_at > now() and i.email <> addr) >= 4 then
    raise exception 'family-full';
  end if;

  insert into public.family_invites (family_id, email, invited_by, expires_at)
  values (me.family_id, addr, (select auth.uid()), now() + interval '7 days')
  on conflict on constraint family_invites_family_email do update -- (not a column list: `email` is also the argument)
    set invited_by = excluded.invited_by, created_at = now(), expires_at = excluded.expires_at
  returning * into inv;
  return jsonb_build_object('id', inv.id, 'email', inv.email, 'expiresAt', inv.expires_at);
end;
$$;

-- Cancel an invite of the caller's family (open or expired).
create function public.cancel_invite(invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me record;
begin
  select * into me from private.my_membership();
  if me.role is distinct from 'owner' then raise exception 'not-owner'; end if;
  delete from public.family_invites i where i.id = invite_id and i.family_id = me.family_id;
  if not found then raise exception 'not-found'; end if;
end;
$$;

-- Remove a parent from the caller's family. The owner can't be removed.
create function public.remove_parent(user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me record;
begin
  select * into me from private.my_membership();
  if me.role is distinct from 'owner' then raise exception 'not-owner'; end if;
  delete from public.family_members m
  where m.family_id = me.family_id and m.user_id = remove_parent.user_id and m.role = 'parent';
  if not found then raise exception 'not-found'; end if;
  perform private.new_family_for(remove_parent.user_id);
end;
$$;

-- ---------- For every grown-up ----------

-- The caller's family: its grown-ups (email, role, when they joined) and, for the owner,
-- its invites (open and expired).
create function public.family_people()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me record;
begin
  select * into me from private.my_membership();
  if me.family_id is null then raise exception 'not-member'; end if;
  return jsonb_build_object(
    'me', jsonb_build_object('userId', (select auth.uid()), 'role', me.role),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('userId', m.user_id, 'email', lower(u.email), 'role', m.role,
                                          'joinedAt', m.created_at) order by m.created_at)
      from public.family_members m join auth.users u on u.id = m.user_id
      where m.family_id = me.family_id), '[]'::jsonb),
    'invites', case when me.role = 'owner' then coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'expiresAt', i.expires_at,
                                          'expired', i.expires_at <= now()) order by i.created_at)
      from public.family_invites i
      where i.family_id = me.family_id), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

-- Leave the family (a parent only; the owner can't leave).
create function public.leave_family()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me record;
begin
  select * into me from private.my_membership();
  if me.family_id is null then raise exception 'not-member'; end if;
  if me.role = 'owner' then raise exception 'is-owner'; end if;
  delete from public.family_members m where m.user_id = (select auth.uid());
  perform private.new_family_for((select auth.uid()));
end;
$$;

-- ---------- For the invited grown-up ----------

-- Open invites to the caller's own email, with the email of the family's owner.
create function public.my_invites()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'ownerEmail', lower(u.email), 'expiresAt', i.expires_at)
                            order by i.created_at), '[]'::jsonb)
  from public.family_invites i
  left join public.family_members m on m.family_id = i.family_id and m.role = 'owner'
  left join auth.users u on u.id = m.user_id
  where i.email = private.my_email() and i.expires_at > now()
    and not exists (select 1 from public.family_members x
                    where x.family_id = i.family_id and x.user_id = (select auth.uid()))
$$;

-- Join the family of an invite to the caller's email. Only from a family the caller is
-- alone in and that has no explorers on the server, so nothing is left behind; that
-- family is then deleted (migration 4). Returns the family joined.
create function public.accept_invite(invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me record;
  inv public.family_invites;
  uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'not-member'; end if;
  select * into inv from public.family_invites i
  where i.id = invite_id and i.email = private.my_email()
  for update;
  if inv.id is null then raise exception 'not-found'; end if;
  if inv.expires_at <= now() then raise exception 'expired'; end if;

  select * into me from private.my_membership();
  if me.family_id = inv.family_id then
    delete from public.family_invites i where i.id = inv.id;
    raise exception 'already-member';
  end if;
  if me.family_id is not null then
    if exists (select 1 from public.family_members m where m.family_id = me.family_id and m.user_id <> uid) then
      raise exception 'not-alone';
    end if;
    if exists (select 1 from public.profiles p where p.family_id = me.family_id) then
      raise exception 'has-explorers';
    end if;
    delete from public.family_members m where m.user_id = uid; -- its empty family goes too
  end if;

  insert into public.family_members (family_id, user_id, role) values (inv.family_id, uid, 'parent');
  delete from public.family_invites i where i.id = inv.id;
  return inv.family_id;
end;
$$;

-- Turn an invite to the caller's email down.
create function public.decline_invite(invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.family_invites i where i.id = invite_id and i.email = private.my_email();
  if not found then raise exception 'not-found'; end if;
end;
$$;

-- Supabase grants new public functions to anon and authenticated by default: only
-- signed-in grown-ups may call these.
revoke all on function public.invite_parent(text), public.cancel_invite(uuid), public.remove_parent(uuid),
  public.family_people(), public.leave_family(), public.my_invites(), public.accept_invite(uuid),
  public.decline_invite(uuid) from public, anon;
grant execute on function public.invite_parent(text), public.cancel_invite(uuid), public.remove_parent(uuid),
  public.family_people(), public.leave_family(), public.my_invites(), public.accept_invite(uuid),
  public.decline_invite(uuid) to authenticated;

-- ---------- When the owner's account is deleted ----------

-- The parent who has been in the family longest becomes the owner. (When the family
-- itself is being deleted it is already gone, and this finds nothing to do.)
create function private.promote_new_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'owner'
     and exists (select 1 from public.families f where f.id = old.family_id)
     and not exists (select 1 from public.family_members m where m.family_id = old.family_id and m.role = 'owner') then
    update public.family_members m set role = 'owner'
    where m.family_id = old.family_id
      and m.user_id = (select x.user_id from public.family_members x
                       where x.family_id = old.family_id order by x.created_at, x.user_id limit 1);
  end if;
  return null;
end;
$$;
revoke all on function private.promote_new_owner() from public;

create trigger family_members_promote_owner
  after delete on public.family_members
  for each row execute function private.promote_new_owner();

-- ---------- Sign-ups: invited addresses only ----------

-- Auth hook "Before User Created" (enabled in the dashboard: Authentication → Auth Hooks).
-- A new account is allowed only for an email with an open invite. Existing accounts sign
-- in as before (the hook runs only when an account is created). Runs as
-- supabase_auth_admin, so not security definer: it reads only what is granted above.
create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  addr text := lower(event -> 'user' ->> 'email');
begin
  if addr is not null and exists (select 1 from public.family_invites i
                                  where i.email = addr and i.expires_at > now()) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403, 'message', 'invite-only: this email has no open invite to a family account'));
end;
$$;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
