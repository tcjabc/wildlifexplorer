-- A profile's progress: packs, collected cards and badges.
-- Every row belongs to one timeline epoch of a profile (profiles.timeline_epoch). "Start
-- over" begins a new epoch instead of deleting anything, so progress only ever grows:
-- there are no deletes to sync, and a device that was offline during a reset can't bring
-- the old progress back (its rows land in the old epoch, which the app ignores).
-- Each row carries family_id for RLS; the composite foreign key makes sure it is the
-- family that owns the profile.
-- Devices upsert; the merge triggers make the result the same whatever order they sync in.
-- When a pack was first shown to the child (notifiedAt) stays on each device.

-- ---------- Tables ----------

-- A pack's key is its deterministic id (profile + epoch + drop), so the same drop can
-- never be granted twice, however many devices grant it. One drop per slot, too.
create table public.packs (
  profile_id uuid not null,
  family_id  uuid not null,
  epoch      integer not null check (epoch >= 1),
  drop_id    text not null check (drop_id ~ '^[a-z0-9][a-z0-9_-]{0,39}$'),   -- data/drops.json, e.g. 's1-w01'
  seq        integer not null check (seq >= 0),                             -- the drop's place in the plan
  card_ids   text[] not null check (cardinality(card_ids) between 1 and 10 and array_position(card_ids, null) is null),
  due_at     timestamptz not null,
  granted_at timestamptz not null,
  opened_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), -- server time, set by trigger: the pull cursor
  primary key (profile_id, epoch, drop_id),
  unique (profile_id, epoch, seq),
  foreign key (profile_id, family_id) references public.profiles (id, family_id) on delete cascade
);
create index packs_family_updated_idx on public.packs (family_id, updated_at);

create table public.collection (
  profile_id   uuid not null,
  family_id    uuid not null,
  epoch        integer not null check (epoch >= 1),
  card_id      text not null check (card_id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  collected_at timestamptz not null,
  drop_id      text check (drop_id ~ '^[a-z0-9][a-z0-9_-]{0,39}$'), -- the pack it came in (null: from before packs)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (profile_id, epoch, card_id),
  foreign key (profile_id, family_id) references public.profiles (id, family_id) on delete cascade
);
create index collection_family_updated_idx on public.collection (family_id, updated_at);

create table public.badges (
  profile_id uuid not null,
  family_id  uuid not null,
  epoch      integer not null check (epoch >= 1),
  badge_id   text not null check (badge_id ~ '^[a-z0-9][a-z0-9:_-]{0,79}$'), -- e.g. 'group:mammals', 'continent:asia:gold'
  earned_at  timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, epoch, badge_id),
  foreign key (profile_id, family_id) references public.profiles (id, family_id) on delete cascade
);
create index badges_family_updated_idx on public.badges (family_id, updated_at);

-- ---------- Merging ----------

-- packs: the first grant's details stay (seq, cards, due and grant times); opened is
-- the earliest time any device opened it, and an opened pack can't become unopened.
create function private.merge_pack()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.family_id is distinct from old.family_id then
    raise exception 'packs.family_id cannot change' using errcode = 'check_violation';
  end if;
  new.seq := old.seq;
  new.card_ids := old.card_ids;
  new.due_at := old.due_at;
  new.granted_at := old.granted_at;
  new.created_at := old.created_at;
  new.opened_at := least(old.opened_at, new.opened_at); -- least() skips nulls
  return new;
end;
$$;
revoke all on function private.merge_pack() from public;

-- collection: the earliest collection wins, with the pack it came in.
create function private.merge_collection()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.family_id is distinct from old.family_id then
    raise exception 'collection.family_id cannot change' using errcode = 'check_violation';
  end if;
  new.created_at := old.created_at;
  if new.collected_at >= old.collected_at then
    new.collected_at := old.collected_at;
    new.drop_id := old.drop_id;
  end if;
  return new;
end;
$$;
revoke all on function private.merge_collection() from public;

-- badges: the earliest time it was earned.
create function private.merge_badge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.family_id is distinct from old.family_id then
    raise exception 'badges.family_id cannot change' using errcode = 'check_violation';
  end if;
  new.created_at := old.created_at;
  new.earned_at := least(old.earned_at, new.earned_at);
  return new;
end;
$$;
revoke all on function private.merge_badge() from public;

-- Trigger order is alphabetical: merge first, then the server time (from migration 2).
create trigger packs_1_merge before update on public.packs
  for each row execute function private.merge_pack();
create trigger packs_2_updated_at before insert or update on public.packs
  for each row execute function private.set_updated_at();

create trigger collection_1_merge before update on public.collection
  for each row execute function private.merge_collection();
create trigger collection_2_updated_at before insert or update on public.collection
  for each row execute function private.set_updated_at();

create trigger badges_1_merge before update on public.badges
  for each row execute function private.merge_badge();
create trigger badges_2_updated_at before insert or update on public.badges
  for each row execute function private.set_updated_at();

-- ---------- Grants ----------

revoke all on table public.packs, public.collection, public.badges from anon, authenticated;
grant select, insert, update on table public.packs, public.collection, public.badges to authenticated;

-- ---------- Row level security ----------

alter table public.packs enable row level security;
alter table public.collection enable row level security;
alter table public.badges enable row level security;

create policy "Members read their family's packs"
  on public.packs for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy "Members add their family's packs"
  on public.packs for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy "Members update their family's packs"
  on public.packs for update to authenticated
  using (family_id in (select private.my_family_ids()))
  with check (family_id in (select private.my_family_ids()));

create policy "Members read their family's collection"
  on public.collection for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy "Members add to their family's collection"
  on public.collection for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy "Members update their family's collection"
  on public.collection for update to authenticated
  using (family_id in (select private.my_family_ids()))
  with check (family_id in (select private.my_family_ids()));

create policy "Members read their family's badges"
  on public.badges for select to authenticated
  using (family_id in (select private.my_family_ids()));
create policy "Members add their family's badges"
  on public.badges for insert to authenticated
  with check (family_id in (select private.my_family_ids()));
create policy "Members update their family's badges"
  on public.badges for update to authenticated
  using (family_id in (select private.my_family_ids()))
  with check (family_id in (select private.my_family_ids()));
