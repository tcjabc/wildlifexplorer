-- Profiles (explorers): one person or a whole family, owned by a family.
-- Only what is shared between devices is here. Height, weight, age, home country, quiz
-- scores and Field Notes stay on the device, and so do device-only settings (preview,
-- Field Notes input).
-- Rows are never deleted by clients: deleting a profile sets deleted_at, so every device
-- hears about it. Each device upserts its own copy; the trigger below merges it with the
-- row that is already there, so the order in which devices sync doesn't matter.

-- ---------- Table ----------

create table public.profiles (
  id                uuid primary key,             -- the id the device made (crypto.randomUUID)
  family_id         uuid not null references public.families (id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 24),
  lang              text not null check (lang in ('en', 'zh', 'both')),
  avatar            smallint not null check (avatar between 1 and 8),
  zhuyin            boolean not null default false,
  rate              text not null default 'normal' check (rate in ('normal', 'slow')),
  length_unit       text not null check (length_unit in ('metric', 'imperial')),
  temp_unit         text not null check (temp_unit in ('C', 'F')),
  drop_day          smallint not null check (drop_day between 0 and 6),        -- 0 = Sunday
  drop_time         text not null check (drop_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'), -- 'HH:MM', device time
  timeline_epoch    integer not null check (timeline_epoch >= 1),  -- +1 on every "Start over"
  timeline_start_at timestamptz not null,                          -- when this epoch's drop 1 arrived
  client_updated_at timestamptz not null,  -- the device's updatedAt: decides which settings win
  created_at        timestamptz not null default now(), -- the device's createdAt (picker order)
  updated_at        timestamptz not null default now(), -- server time, set by trigger: the pull cursor
  deleted_at        timestamptz,
  unique (id, family_id) -- lets progress tables check a profile belongs to their family
);
create index profiles_family_updated_idx on public.profiles (family_id, updated_at);

-- ---------- Merging and server time ----------

-- Every write gets the server's time, whatever the device sent.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public;

-- An upsert from a device meets the row already there:
--   settings      the newer client_updated_at wins (the whole set, not field by field)
--   timeline      the higher epoch wins; within an epoch the start never changes
--   deleted_at    once deleted, always deleted (the earliest time is kept)
--   family_id     can't change; created_at keeps the first value
create function private.merge_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.family_id is distinct from old.family_id then
    raise exception 'profiles.family_id cannot change' using errcode = 'check_violation';
  end if;
  new.created_at := old.created_at;

  if new.client_updated_at < old.client_updated_at then
    new.name := old.name;
    new.lang := old.lang;
    new.avatar := old.avatar;
    new.zhuyin := old.zhuyin;
    new.rate := old.rate;
    new.length_unit := old.length_unit;
    new.temp_unit := old.temp_unit;
    new.drop_day := old.drop_day;
    new.drop_time := old.drop_time;
    new.client_updated_at := old.client_updated_at;
  end if;

  if new.timeline_epoch <= old.timeline_epoch then
    new.timeline_epoch := old.timeline_epoch;
    new.timeline_start_at := old.timeline_start_at;
  end if;

  new.deleted_at := least(old.deleted_at, new.deleted_at); -- least() skips nulls
  return new;
end;
$$;
revoke all on function private.merge_profile() from public;

-- Trigger order is alphabetical: merge first, then the server time.
create trigger profiles_1_merge
  before update on public.profiles
  for each row execute function private.merge_profile();
create trigger profiles_2_updated_at
  before insert or update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------- Grants ----------

revoke all on table public.profiles from anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;

-- ---------- Row level security ----------

alter table public.profiles enable row level security;

create policy "Members read their family's profiles"
  on public.profiles for select to authenticated
  using (family_id in (select private.my_family_ids()));

create policy "Members add profiles to their family"
  on public.profiles for insert to authenticated
  with check (family_id in (select private.my_family_ids()));

create policy "Members update their family's profiles"
  on public.profiles for update to authenticated
  using (family_id in (select private.my_family_ids()))
  with check (family_id in (select private.my_family_ids()));
