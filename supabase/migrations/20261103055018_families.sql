-- Families and who belongs to them.
-- A parent signs in (an auth.users row); a family is created for them automatically, with
-- them as its owner. Profiles and progress (later migrations) belong to a family, and RLS
-- lets a signed-in parent reach only the rows of the families they are a member of.
-- Clients can only read these two tables: families and memberships are written by the
-- trigger below (and, later, by an invite flow), never directly through the Data API.

-- Helpers that RLS policies call. This schema is not exposed by the Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------- Tables ----------

create table public.families (
  id         uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Room for a second parent (their own email) later; for now only the owner.
create table public.family_members (
  family_id  uuid not null references public.families (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  role       text not null default 'parent' check (role in ('owner', 'parent')),
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index family_members_user_id_idx on public.family_members (user_id);

-- ---------- The caller's families ----------

-- Security definer so policies on family_members itself can use it without recursing
-- into family_members' own RLS. Returns nothing for anon (auth.uid() is null).
create function private.my_family_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.family_id from public.family_members m where m.user_id = (select auth.uid())
$$;
revoke all on function private.my_family_ids() from public;
grant execute on function private.my_family_ids() to authenticated;

-- ---------- A family for every new parent ----------

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  fid uuid;
begin
  insert into public.families (created_by) values (new.id) returning id into fid;
  insert into public.family_members (family_id, user_id, role) values (fid, new.id, 'owner');
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Users who signed up before this migration get a family too.
do $$
declare
  u record;
  fid uuid;
begin
  for u in select a.id from auth.users a
           where not exists (select 1 from public.family_members m where m.user_id = a.id)
  loop
    insert into public.families (created_by) values (u.id) returning id into fid;
    insert into public.family_members (family_id, user_id, role) values (fid, u.id, 'owner');
  end loop;
end;
$$;

-- ---------- Grants ----------

revoke all on table public.families, public.family_members from anon, authenticated;
grant select on table public.families, public.family_members to authenticated;

-- ---------- Row level security ----------

alter table public.families enable row level security;
alter table public.family_members enable row level security;

create policy "Members read their families"
  on public.families for select to authenticated
  using (id in (select private.my_family_ids()));

create policy "Members read their families' members"
  on public.family_members for select to authenticated
  using (family_id in (select private.my_family_ids()));
