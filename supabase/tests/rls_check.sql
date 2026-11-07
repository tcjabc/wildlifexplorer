-- RLS check: re-run after every migration. Everything happens in one transaction that is
-- rolled back at the end, so it leaves nothing behind (the two test users included).
--   npx supabase db query --remote -f supabase/tests/rls_check.sql
-- or paste it into the dashboard's SQL editor. It stops at the first failed check with an
-- error saying what went wrong; the last result reads 'RLS check passed' when all is well.
-- Each later migration adds its own checks to the sections below.

begin;

-- ---------- Setup (as postgres) ----------

-- Two parents; the new-user trigger gives each a family.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'rls-check-a@example.test'),
  ('00000000-0000-4000-8000-0000000000b1', 'rls-check-b@example.test');

select set_config('rls.user_a', '00000000-0000-4000-8000-0000000000a1', true),
       set_config('rls.user_b', '00000000-0000-4000-8000-0000000000b1', true),
       set_config('rls.fam_a', (select family_id::text from public.family_members
                                where user_id = '00000000-0000-4000-8000-0000000000a1' and role = 'owner'), true),
       set_config('rls.fam_b', (select family_id::text from public.family_members
                                where user_id = '00000000-0000-4000-8000-0000000000b1' and role = 'owner'), true);

do $$
begin
  if coalesce(current_setting('rls.fam_a', true), '') = '' or coalesce(current_setting('rls.fam_b', true), '') = '' then
    raise exception 'FAIL: the new-user trigger did not create a family for each test user';
  end if;
end $$;

-- Family B has a profile (written as postgres, bypassing RLS).
select set_config('rls.prof_a', '00000000-0000-4000-8000-0000000000a2', true),
       set_config('rls.prof_b', '00000000-0000-4000-8000-0000000000b2', true);
insert into public.profiles (id, family_id, name, lang, avatar, length_unit, temp_unit, drop_day, drop_time,
                             timeline_epoch, timeline_start_at, client_updated_at)
values (current_setting('rls.prof_b')::uuid, current_setting('rls.fam_b')::uuid, 'Explorer B', 'both', 2,
        'metric', 'C', 6, '09:00', 1, '2026-01-01T09:00:00Z', '2026-01-01T09:00:00Z');

-- …and some progress.
insert into public.packs (profile_id, family_id, epoch, drop_id, seq, card_ids, due_at, granted_at)
values (current_setting('rls.prof_b')::uuid, current_setting('rls.fam_b')::uuid, 1, 's1-w01', 0,
        array['card-b1', 'card-b2', 'card-b3'], '2026-01-01T09:00:00Z', '2026-01-01T09:00:00Z');
insert into public.collection (profile_id, family_id, epoch, card_id, collected_at, drop_id)
values (current_setting('rls.prof_b')::uuid, current_setting('rls.fam_b')::uuid, 1, 'card-b1', '2026-01-01T10:00:00Z', 's1-w01');
insert into public.badges (profile_id, family_id, epoch, badge_id, earned_at)
values (current_setting('rls.prof_b')::uuid, current_setting('rls.fam_b')::uuid, 1, 'group:test', '2026-01-01T10:00:00Z');

-- ---------- As parent A ----------

set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_a'), 'role', 'authenticated')::text, true);

do $$
begin
  -- families / family_members: A sees only family A.
  if (select count(*) from public.families) <> 1
     or not exists (select 1 from public.families where id = current_setting('rls.fam_a')::uuid) then
    raise exception 'FAIL: parent A should see exactly their own family';
  end if;
  if exists (select 1 from public.family_members where family_id = current_setting('rls.fam_b')::uuid) then
    raise exception 'FAIL: parent A can see family B''s members';
  end if;
  if (select count(*) from public.family_members) <> 1 then
    raise exception 'FAIL: parent A should see exactly one membership';
  end if;

  -- Clients never write families or memberships.
  begin
    insert into public.families (created_by) values (current_setting('rls.user_a')::uuid);
    raise exception 'FAIL: parent A could create a family';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.family_members (family_id, user_id)
      values (current_setting('rls.fam_b')::uuid, current_setting('rls.user_a')::uuid);
    raise exception 'FAIL: parent A could join family B';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.family_members set role = 'owner';
    raise exception 'FAIL: parent A could update memberships';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.families;
    raise exception 'FAIL: parent A could delete a family';
  exception when insufficient_privilege then null;
  end;
end $$;

-- profiles: A can add, read and update only family A's profiles.
do $$
declare
  n int;
  p public.profiles;
begin
  -- The device's own updated_at is ignored: the server sets it.
  insert into public.profiles (id, family_id, name, lang, avatar, length_unit, temp_unit, drop_day, drop_time,
                               timeline_epoch, timeline_start_at, client_updated_at, created_at, updated_at)
  values (current_setting('rls.prof_a')::uuid, current_setting('rls.fam_a')::uuid, 'Explorer A', 'en', 1,
          'metric', 'C', 6, '09:00', 1, '2026-01-01T09:00:00Z', '2026-01-02T00:00:00Z',
          '2026-01-01T09:00:00Z', '2000-01-01T00:00:00Z');
  select * into p from public.profiles where id = current_setting('rls.prof_a')::uuid;
  if p.updated_at <> now() then raise exception 'FAIL: profiles.updated_at was not set by the server'; end if;

  if (select count(*) from public.profiles) <> 1
     or exists (select 1 from public.profiles where id = current_setting('rls.prof_b')::uuid) then
    raise exception 'FAIL: parent A should see only family A''s profile';
  end if;

  begin
    insert into public.profiles (id, family_id, name, lang, avatar, length_unit, temp_unit, drop_day, drop_time,
                                 timeline_epoch, timeline_start_at, client_updated_at)
    values (gen_random_uuid(), current_setting('rls.fam_b')::uuid, 'Intruder', 'en', 1,
            'metric', 'C', 6, '09:00', 1, now(), now());
    raise exception 'FAIL: parent A could add a profile to family B';
  exception when insufficient_privilege then null;
  end;

  update public.profiles set name = 'Changed by A' where id = current_setting('rls.prof_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: parent A could update family B''s profile'; end if;

  -- An upsert with B's profile id must not take B's row over.
  begin
    insert into public.profiles (id, family_id, name, lang, avatar, length_unit, temp_unit, drop_day, drop_time,
                                 timeline_epoch, timeline_start_at, client_updated_at)
    values (current_setting('rls.prof_b')::uuid, current_setting('rls.fam_a')::uuid, 'Taken by A', 'en', 1,
            'metric', 'C', 6, '09:00', 1, now(), '2030-01-01T00:00:00Z')
    on conflict (id) do update set name = excluded.name, client_updated_at = excluded.client_updated_at;
    raise exception 'FAIL: parent A could upsert over family B''s profile';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.profiles set family_id = current_setting('rls.fam_b')::uuid where id = current_setting('rls.prof_a')::uuid;
    raise exception 'FAIL: parent A could move a profile to family B';
  exception when insufficient_privilege or check_violation then null;
  end;

  begin
    delete from public.profiles where id = current_setting('rls.prof_a')::uuid;
    raise exception 'FAIL: parent A could hard-delete a profile';
  exception when insufficient_privilege then null;
  end;

  -- Merge rules (the same ones the app uses).
  insert into public.profiles (id, family_id, name, lang, avatar, length_unit, temp_unit, drop_day, drop_time,
                               timeline_epoch, timeline_start_at, client_updated_at)
  values (current_setting('rls.prof_a')::uuid, current_setting('rls.fam_a')::uuid, 'Older', 'zh', 3,
          'imperial', 'F', 1, '18:30', 1, '2026-01-01T09:00:00Z', '2026-01-01T00:00:00Z')
  on conflict (id) do update set name = excluded.name, lang = excluded.lang, drop_day = excluded.drop_day,
    client_updated_at = excluded.client_updated_at;
  select * into p from public.profiles where id = current_setting('rls.prof_a')::uuid;
  if p.name <> 'Explorer A' or p.lang <> 'en' or p.drop_day <> 6 then
    raise exception 'FAIL: older settings overwrote newer ones';
  end if;

  update public.profiles set name = 'Newer', client_updated_at = '2026-01-03T00:00:00Z'
    where id = current_setting('rls.prof_a')::uuid;
  if (select name from public.profiles where id = current_setting('rls.prof_a')::uuid) <> 'Newer' then
    raise exception 'FAIL: newer settings were not saved';
  end if;

  -- The Welcome details: their own time decides, and no time at all changes nothing.
  update public.profiles set home_country = 'TW', height_cm = 120, details_at = '2026-01-03T00:00:00Z'
    where id = current_setting('rls.prof_a')::uuid;
  update public.profiles set home_country = 'JP', details_at = '2026-01-02T00:00:00Z'
    where id = current_setting('rls.prof_a')::uuid;
  update public.profiles set height_cm = null, details_at = null
    where id = current_setting('rls.prof_a')::uuid;
  select * into p from public.profiles where id = current_setting('rls.prof_a')::uuid;
  if p.home_country <> 'TW' or p.height_cm <> 120 or p.details_at <> '2026-01-03T00:00:00Z' then
    raise exception 'FAIL: older or undated details overwrote newer ones';
  end if;
  update public.profiles set height_cm = null, details_at = '2026-01-04T00:00:00Z'
    where id = current_setting('rls.prof_a')::uuid;
  if (select height_cm from public.profiles where id = current_setting('rls.prof_a')::uuid) is not null then
    raise exception 'FAIL: newer details could not clear a field';
  end if;

  update public.profiles set timeline_epoch = 2, timeline_start_at = '2026-02-01T00:00:00Z'
    where id = current_setting('rls.prof_a')::uuid;
  update public.profiles set timeline_epoch = 1, timeline_start_at = '2026-03-01T00:00:00Z'
    where id = current_setting('rls.prof_a')::uuid;
  update public.profiles set timeline_start_at = '2026-04-01T00:00:00Z'
    where id = current_setting('rls.prof_a')::uuid;
  select * into p from public.profiles where id = current_setting('rls.prof_a')::uuid;
  if p.timeline_epoch <> 2 or p.timeline_start_at <> '2026-02-01T00:00:00Z' then
    raise exception 'FAIL: timeline went back to an older epoch or its start moved';
  end if;

  update public.profiles set deleted_at = '2026-05-01T00:00:00Z' where id = current_setting('rls.prof_a')::uuid;
  update public.profiles set deleted_at = null where id = current_setting('rls.prof_a')::uuid;
  if (select deleted_at from public.profiles where id = current_setting('rls.prof_a')::uuid) is null then
    raise exception 'FAIL: a deleted profile came back';
  end if;
end $$;

-- packs, collection, badges: only family A's, and the merge rules.
do $$
declare
  n int;
  k record;
  pk public.packs;
begin
  -- Granting a pack, then the same drop again from another device.
  insert into public.packs (profile_id, family_id, epoch, drop_id, seq, card_ids, due_at, granted_at, updated_at)
  values (current_setting('rls.prof_a')::uuid, current_setting('rls.fam_a')::uuid, 2, 's1-w01', 0,
          array['card-a1', 'card-a2', 'card-a3'], '2026-02-01T09:00:00Z', '2026-02-01T09:00:00Z', '2000-01-01T00:00:00Z');
  if (select updated_at from public.packs where profile_id = current_setting('rls.prof_a')::uuid) <> now() then
    raise exception 'FAIL: packs.updated_at was not set by the server';
  end if;
  insert into public.packs (profile_id, family_id, epoch, drop_id, seq, card_ids, due_at, granted_at, opened_at)
  values (current_setting('rls.prof_a')::uuid, current_setting('rls.fam_a')::uuid, 2, 's1-w01', 0,
          array['other-1'], '2026-02-02T09:00:00Z', '2026-02-02T09:00:00Z', '2026-02-03T00:00:00Z')
  on conflict (profile_id, epoch, drop_id) do update set
    card_ids = excluded.card_ids, due_at = excluded.due_at, granted_at = excluded.granted_at, opened_at = excluded.opened_at;
  select * into pk from public.packs where profile_id = current_setting('rls.prof_a')::uuid and drop_id = 's1-w01';
  if (select count(*) from public.packs where profile_id = current_setting('rls.prof_a')::uuid) <> 1 then
    raise exception 'FAIL: the same drop was granted twice';
  end if;
  if pk.card_ids <> array['card-a1', 'card-a2', 'card-a3'] or pk.due_at <> '2026-02-01T09:00:00Z' then
    raise exception 'FAIL: a second grant changed the pack''s cards or due time';
  end if;
  if pk.opened_at is distinct from '2026-02-03T00:00:00Z' then
    raise exception 'FAIL: opening the pack was not saved';
  end if;

  update public.packs set opened_at = null where profile_id = current_setting('rls.prof_a')::uuid;
  update public.packs set opened_at = '2026-02-05T00:00:00Z' where profile_id = current_setting('rls.prof_a')::uuid;
  if (select opened_at from public.packs where profile_id = current_setting('rls.prof_a')::uuid) <> '2026-02-03T00:00:00Z' then
    raise exception 'FAIL: an opened pack became unopened, or lost its first opening time';
  end if;

  begin
    insert into public.packs (profile_id, family_id, epoch, drop_id, seq, card_ids, due_at, granted_at)
    values (current_setting('rls.prof_a')::uuid, current_setting('rls.fam_a')::uuid, 2, 's1-w02', 0,
            array['card-a4'], now(), now());
    raise exception 'FAIL: a second drop was granted in the same slot';
  exception when unique_violation then null;
  end;

  -- Rows for family B's profile: not under family B (RLS), not under family A (foreign key).
  begin
    insert into public.packs (profile_id, family_id, epoch, drop_id, seq, card_ids, due_at, granted_at)
    values (current_setting('rls.prof_b')::uuid, current_setting('rls.fam_b')::uuid, 1, 's1-w09', 8, array['x'], now(), now());
    raise exception 'FAIL: parent A could add a pack to family B';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.collection (profile_id, family_id, epoch, card_id, collected_at)
    values (current_setting('rls.prof_b')::uuid, current_setting('rls.fam_a')::uuid, 1, 'card-x', now());
    raise exception 'FAIL: parent A could add a card to family B''s profile';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.packs (profile_id, family_id, epoch, drop_id, seq, card_ids, due_at, granted_at, opened_at)
    values (current_setting('rls.prof_b')::uuid, current_setting('rls.fam_a')::uuid, 1, 's1-w01', 0, array['x'], now(), now(), now())
    on conflict (profile_id, epoch, drop_id) do update set opened_at = excluded.opened_at;
    raise exception 'FAIL: parent A could upsert over family B''s pack';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;

  update public.packs set opened_at = now() where profile_id = current_setting('rls.prof_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: parent A could open family B''s pack'; end if;
  update public.collection set collected_at = now() where profile_id = current_setting('rls.prof_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: parent A could change family B''s collection'; end if;
  update public.badges set earned_at = now() where profile_id = current_setting('rls.prof_b')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: parent A could change family B''s badges'; end if;

  -- Collected cards and badges: the earliest time wins.
  insert into public.collection (profile_id, family_id, epoch, card_id, collected_at, drop_id)
  values (current_setting('rls.prof_a')::uuid, current_setting('rls.fam_a')::uuid, 2, 'card-a1', '2026-02-03T00:00:00Z', 's1-w01');
  insert into public.collection (profile_id, family_id, epoch, card_id, collected_at, drop_id)
  values (current_setting('rls.prof_a')::uuid, current_setting('rls.fam_a')::uuid, 2, 'card-a1', '2026-02-04T00:00:00Z', 's1-w02')
  on conflict (profile_id, epoch, card_id) do update set collected_at = excluded.collected_at, drop_id = excluded.drop_id;
  select collected_at, drop_id into k from public.collection where profile_id = current_setting('rls.prof_a')::uuid;
  if k.collected_at <> '2026-02-03T00:00:00Z' or k.drop_id <> 's1-w01' then
    raise exception 'FAIL: a later collection replaced the first one';
  end if;
  update public.collection set collected_at = '2026-02-02T00:00:00Z', drop_id = null
    where profile_id = current_setting('rls.prof_a')::uuid;
  select collected_at, drop_id into k from public.collection where profile_id = current_setting('rls.prof_a')::uuid;
  if k.collected_at <> '2026-02-02T00:00:00Z' or k.drop_id is not null then
    raise exception 'FAIL: an earlier collection did not win';
  end if;

  insert into public.badges (profile_id, family_id, epoch, badge_id, earned_at)
  values (current_setting('rls.prof_a')::uuid, current_setting('rls.fam_a')::uuid, 2, 'continent:asia:gold', '2026-02-03T00:00:00Z');
  update public.badges set earned_at = '2026-02-09T00:00:00Z' where profile_id = current_setting('rls.prof_a')::uuid;
  if (select earned_at from public.badges where profile_id = current_setting('rls.prof_a')::uuid) <> '2026-02-03T00:00:00Z' then
    raise exception 'FAIL: a later badge time replaced the first one';
  end if;

  -- A sees only family A's progress.
  if (select count(*) from public.packs) <> 1 or (select count(*) from public.collection) <> 1
     or (select count(*) from public.badges) <> 1
     or exists (select 1 from public.packs where profile_id = current_setting('rls.prof_b')::uuid)
     or exists (select 1 from public.collection where profile_id = current_setting('rls.prof_b')::uuid)
     or exists (select 1 from public.badges where profile_id = current_setting('rls.prof_b')::uuid) then
    raise exception 'FAIL: parent A should see only family A''s progress';
  end if;

  begin
    update public.packs set family_id = current_setting('rls.fam_b')::uuid where profile_id = current_setting('rls.prof_a')::uuid;
    raise exception 'FAIL: parent A could move a pack to family B';
  exception when insufficient_privilege or check_violation or foreign_key_violation then null;
  end;

  begin
    delete from public.packs;
    raise exception 'FAIL: parent A could delete packs';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.collection;
    raise exception 'FAIL: parent A could delete collected cards';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.badges;
    raise exception 'FAIL: parent A could delete badges';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- As parent B ----------

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_b'), 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.families) <> 1
     or exists (select 1 from public.families where id = current_setting('rls.fam_a')::uuid) then
    raise exception 'FAIL: parent B should see only their own family';
  end if;
  if (select count(*) from public.profiles) <> 1
     or exists (select 1 from public.profiles where id = current_setting('rls.prof_a')::uuid) then
    raise exception 'FAIL: parent B should see only family B''s profile';
  end if;
  if (select count(*) from public.packs) <> 1 or (select count(*) from public.collection) <> 1
     or (select count(*) from public.badges) <> 1
     or exists (select 1 from public.packs where profile_id = current_setting('rls.prof_a')::uuid) then
    raise exception 'FAIL: parent B should see only family B''s progress';
  end if;
end $$;

-- ---------- Signed out (anon) ----------

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  begin
    perform 1 from public.families;
    raise exception 'FAIL: anon can read families';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.family_members;
    raise exception 'FAIL: anon can read family_members';
  exception when insufficient_privilege then null;
  end;
  begin
    perform private.my_family_ids();
    raise exception 'FAIL: anon can call private.my_family_ids()';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.profiles;
    raise exception 'FAIL: anon can read profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.packs;
    raise exception 'FAIL: anon can read packs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.collection;
    raise exception 'FAIL: anon can read collection';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.badges;
    raise exception 'FAIL: anon can read badges';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- Done ----------

reset role;

-- Nothing A tried changed family B's profile.
do $$
begin
  if (select name from public.profiles where id = current_setting('rls.prof_b')::uuid) <> 'Explorer B' then
    raise exception 'FAIL: family B''s profile was changed by parent A';
  end if;
  if (select opened_at from public.packs where profile_id = current_setting('rls.prof_b')::uuid) is not null
     or (select collected_at from public.collection where profile_id = current_setting('rls.prof_b')::uuid) <> '2026-01-01T10:00:00Z'
     or (select earned_at from public.badges where profile_id = current_setting('rls.prof_b')::uuid) <> '2026-01-01T10:00:00Z' then
    raise exception 'FAIL: family B''s progress was changed by parent A';
  end if;
end $$;

-- ---------- Deleting a user (migration 4) ----------

-- A family left with no members is deleted, with its profiles and progress. Another
-- family is untouched. (Still as postgres; rolled back with everything else.)
delete from auth.users where id = current_setting('rls.user_b')::uuid;

do $$
begin
  if exists (select 1 from public.families where id = current_setting('rls.fam_b')::uuid) then
    raise exception 'FAIL: family B was not deleted with its last member';
  end if;
  if exists (select 1 from public.profiles where family_id = current_setting('rls.fam_b')::uuid)
     or exists (select 1 from public.packs where family_id = current_setting('rls.fam_b')::uuid)
     or exists (select 1 from public.collection where family_id = current_setting('rls.fam_b')::uuid)
     or exists (select 1 from public.badges where family_id = current_setting('rls.fam_b')::uuid) then
    raise exception 'FAIL: family B''s profiles or progress outlived the family';
  end if;
  if not exists (select 1 from public.families where id = current_setting('rls.fam_a')::uuid)
     or not exists (select 1 from public.family_members where family_id = current_setting('rls.fam_a')::uuid) then
    raise exception 'FAIL: deleting user B touched family A';
  end if;
end $$;

-- ---------- Invites (migration 5) ----------

-- Family A (owner A, explorer A) invites. C is new and alone, D has an explorer on the
-- server, E is invited but lets it expire. (Setup as postgres.)
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000c1', 'rls-check-c@example.test'),
  ('00000000-0000-4000-8000-0000000000d1', 'rls-check-d@example.test'),
  ('00000000-0000-4000-8000-0000000000e1', 'rls-check-e@example.test');
select set_config('rls.user_c', '00000000-0000-4000-8000-0000000000c1', true),
       set_config('rls.user_d', '00000000-0000-4000-8000-0000000000d1', true),
       set_config('rls.user_e', '00000000-0000-4000-8000-0000000000e1', true),
       set_config('rls.fam_c', (select family_id::text from public.family_members
                                where user_id = '00000000-0000-4000-8000-0000000000c1'), true),
       set_config('rls.fam_d', (select family_id::text from public.family_members
                                where user_id = '00000000-0000-4000-8000-0000000000d1'), true);
insert into public.profiles (id, family_id, name, lang, avatar, length_unit, temp_unit, drop_day, drop_time,
                             timeline_epoch, timeline_start_at, client_updated_at)
values ('00000000-0000-4000-8000-0000000000d2', current_setting('rls.fam_d')::uuid, 'Explorer D', 'both', 3,
        'metric', 'C', 6, '09:00', 1, '2026-01-01T09:00:00Z', '2026-01-01T09:00:00Z');

-- Runs stmt as the current role and fails unless it raises `want` (the message code the
-- functions use, or a SQLSTATE such as 42501). Created inside this transaction only.
create function private.rls_expect(stmt text, want text, what text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm = want or sqlstate = want then return; end if;
    raise exception 'FAIL: % (got % "%", wanted %)', what, sqlstate, sqlerrm, want;
  end;
  raise exception 'FAIL: % (no error, wanted %)', what, want;
end;
$$;
grant execute on function private.rls_expect(text, text, text) to authenticated, anon;

-- As owner A: invite, the checks on inviting, and no direct access to the tables.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_a'), 'role', 'authenticated')::text, true);

do $$
declare
  r jsonb;
  r2 jsonb;
begin
  r := public.invite_parent('  RLS-Check-C@Example.TEST ');
  if r ->> 'email' <> 'rls-check-c@example.test' then raise exception 'FAIL: the invited email was not lowercased and trimmed'; end if;
  if (r ->> 'expiresAt')::timestamptz not between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' then
    raise exception 'FAIL: an invite should last 7 days';
  end if;
  perform set_config('rls.inv_c', r ->> 'id', true);
  perform set_config('rls.inv_d', public.invite_parent('rls-check-d@example.test') ->> 'id', true);
  perform set_config('rls.inv_e', public.invite_parent('rls-check-e@example.test') ->> 'id', true);

  r2 := public.invite_parent('rls-check-c@example.test'); -- invite again: same invite, renewed
  if r2 ->> 'id' <> r ->> 'id' then raise exception 'FAIL: inviting again made a second invite'; end if;

  perform private.rls_expect($q$select public.invite_parent('not an email')$q$, 'bad-email', 'owner A invited a bad email');
  perform private.rls_expect($q$select public.invite_parent('rls-check-a@example.test')$q$, 'already-member', 'owner A invited themselves');
  perform private.rls_expect($q$select public.invite_parent('rls-check-new@example.test')$q$, 'family-full', 'a fifth grown-up could be invited');
  perform private.rls_expect(format('select public.remove_parent(%L)', current_setting('rls.user_a')), 'not-found', 'owner A could remove the owner');
  perform private.rls_expect(format('select public.remove_parent(%L)', current_setting('rls.user_d')), 'not-found', 'owner A could remove a grown-up of another family');
  perform private.rls_expect('select public.leave_family()', 'is-owner', 'the owner could leave');
  perform private.rls_expect(format('select public.accept_invite(%L)', current_setting('rls.inv_c')), 'not-found', 'owner A could accept an invite to another email');

  r := public.family_people();
  if jsonb_array_length(r -> 'members') <> 1 or jsonb_array_length(r -> 'invites') <> 3 or r -> 'me' ->> 'role' <> 'owner' then
    raise exception 'FAIL: owner A should see 1 grown-up and 3 invites';
  end if;

  perform private.rls_expect('select 1 from public.family_invites', '42501', 'owner A could read family_invites');
  perform private.rls_expect(format('insert into public.family_invites (family_id, email, expires_at) values (%L, %L, now() + interval ''1 day'')',
                                    current_setting('rls.fam_a'), 'x@example.test'), '42501', 'owner A could insert an invite directly');
  perform private.rls_expect('update public.family_invites set expires_at = now() + interval ''1 year''', '42501', 'owner A could update invites directly');
  perform private.rls_expect('delete from public.family_invites', '42501', 'owner A could delete invites directly');
  perform private.rls_expect(format('select public.hook_before_user_created(%L::jsonb)', '{"user":{"email":"x@example.test"}}'),
                             '42501', 'a signed-in grown-up could call the sign-up hook');
end $$;

-- E's invite runs out. Then the sign-up hook, as the auth server runs it if this role may
-- switch to supabase_auth_admin (which also checks its grants), else as postgres.
reset role;
update public.family_invites set expires_at = now() - interval '1 second' where id = current_setting('rls.inv_e')::uuid;

do $$
declare
  ok jsonb;
  no1 jsonb;
  no2 jsonb;
  no3 jsonb;
begin
  begin
    execute 'set local role supabase_auth_admin';
    perform set_config('rls.hook_as', 'supabase_auth_admin', true);
  exception when insufficient_privilege then
    perform set_config('rls.hook_as', 'postgres (could not switch to supabase_auth_admin)', true);
  end;
  ok  := public.hook_before_user_created('{"metadata":{"name":"before-user-created"},"user":{"email":"RLS-Check-C@example.test"}}');
  no1 := public.hook_before_user_created('{"metadata":{"name":"before-user-created"},"user":{"email":"rls-check-nobody@example.test"}}');
  no2 := public.hook_before_user_created('{"metadata":{"name":"before-user-created"},"user":{"email":"rls-check-e@example.test"}}');
  no3 := public.hook_before_user_created('{"metadata":{"name":"before-user-created"},"user":{"phone":"15550000000"}}');
  execute 'reset role';
  if ok <> '{}'::jsonb then raise exception 'FAIL: the sign-up hook refused an invited email'; end if;
  if (no1 -> 'error' ->> 'http_code') is distinct from '403' then raise exception 'FAIL: the sign-up hook let an uninvited email sign up'; end if;
  if (no2 -> 'error' ->> 'http_code') is distinct from '403' then raise exception 'FAIL: the sign-up hook let an expired invite sign up'; end if;
  if (no3 -> 'error' ->> 'http_code') is distinct from '403' then raise exception 'FAIL: the sign-up hook let a sign-up without an email through'; end if;

  -- What supabase_auth_admin needs to run the hook, checked directly (postgres usually
  -- can't switch to it), and that nobody else may call it.
  if not has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute')
     or not has_schema_privilege('supabase_auth_admin', 'public', 'usage')
     or not has_column_privilege('supabase_auth_admin', 'public.family_invites', 'email', 'select')
     or not has_column_privilege('supabase_auth_admin', 'public.family_invites', 'expires_at', 'select')
     or not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'family_invites'
                    and cmd = 'SELECT' and roles = '{supabase_auth_admin}') then
    raise exception 'FAIL: supabase_auth_admin lacks a grant or policy the sign-up hook needs';
  end if;
  if has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute')
     or has_table_privilege('supabase_auth_admin', 'public.family_invites', 'insert, update, delete') then
    raise exception 'FAIL: the sign-up hook or family_invites is open to more than it should be';
  end if;
end $$;

-- As E (expired invite): nothing to accept, nothing of family A's to touch.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_e'), 'role', 'authenticated')::text, true);

do $$
declare
  r jsonb;
begin
  if jsonb_array_length(public.my_invites()) <> 0 then raise exception 'FAIL: E sees an expired invite'; end if;
  perform private.rls_expect(format('select public.accept_invite(%L)', current_setting('rls.inv_e')), 'expired', 'E accepted an expired invite');
  perform private.rls_expect(format('select public.accept_invite(%L)', current_setting('rls.inv_c')), 'not-found', 'E accepted C''s invite');
  perform private.rls_expect(format('select public.decline_invite(%L)', current_setting('rls.inv_c')), 'not-found', 'E declined C''s invite');
  perform private.rls_expect(format('select public.cancel_invite(%L)', current_setting('rls.inv_c')), 'not-found', 'E cancelled family A''s invite');
  perform private.rls_expect(format('select public.remove_parent(%L)', current_setting('rls.user_a')), 'not-found', 'E removed a grown-up of family A');
  r := public.family_people();
  if jsonb_array_length(r -> 'members') <> 1 or r -> 'members' -> 0 ->> 'userId' <> current_setting('rls.user_e')
     or jsonb_array_length(r -> 'invites') <> 0 then
    raise exception 'FAIL: E should see only themselves and no invites';
  end if;
end $$;

-- As D (has an explorer on the server): can't accept, so explorer D isn't left behind.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_d'), 'role', 'authenticated')::text, true);

do $$
declare
  r jsonb := public.my_invites();
begin
  if jsonb_array_length(r) <> 1 or r -> 0 ->> 'ownerEmail' <> 'rls-check-a@example.test' then
    raise exception 'FAIL: D should see one invite, from owner A';
  end if;
  perform private.rls_expect(format('select public.accept_invite(%L)', current_setting('rls.inv_d')), 'has-explorers', 'D joined and left explorer D behind');
end $$;

-- As C: accept, then see family A as a parent, who can't invite or remove.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_c'), 'role', 'authenticated')::text, true);

do $$
declare
  r jsonb := public.my_invites();
begin
  if jsonb_array_length(r) <> 1 or r -> 0 ->> 'id' <> current_setting('rls.inv_c') then raise exception 'FAIL: C should see their invite'; end if;
  if public.accept_invite(current_setting('rls.inv_c')::uuid) <> current_setting('rls.fam_a')::uuid then
    raise exception 'FAIL: accepting did not return family A';
  end if;
  if (select count(*) from public.families) <> 1 or not exists (select 1 from public.families where id = current_setting('rls.fam_a')::uuid)
     or not exists (select 1 from public.profiles where id = current_setting('rls.prof_a')::uuid) then
    raise exception 'FAIL: after joining, C should see family A and its explorer';
  end if;
  perform private.rls_expect(format('select public.accept_invite(%L)', current_setting('rls.inv_c')), 'not-found', 'an invite could be used twice');

  r := public.family_people();
  if r -> 'me' ->> 'role' <> 'parent' or jsonb_array_length(r -> 'members') <> 2 or jsonb_array_length(r -> 'invites') <> 0 then
    raise exception 'FAIL: parent C should see 2 grown-ups and no invites';
  end if;
  perform private.rls_expect($q$select public.invite_parent('rls-check-x@example.test')$q$, 'not-owner', 'a parent could invite');
  perform private.rls_expect(format('select public.cancel_invite(%L)', current_setting('rls.inv_d')), 'not-owner', 'a parent could cancel an invite');
  perform private.rls_expect(format('select public.remove_parent(%L)', current_setting('rls.user_a')), 'not-owner', 'a parent could remove the owner');
  perform private.rls_expect('update public.family_members set role = ''owner''', '42501', 'a parent could make themselves owner');
  perform private.rls_expect('delete from public.family_members', '42501', 'a parent could delete memberships');
end $$;

reset role;
do $$
begin
  if exists (select 1 from public.families where id = current_setting('rls.fam_c')::uuid) then
    raise exception 'FAIL: C''s empty family was not deleted when C joined family A';
  end if;
end $$;

-- As owner A: remove C. C is left with a new empty family of their own.
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_a'), 'role', 'authenticated')::text, true);

do $$
declare
  r jsonb := public.family_people();
begin
  if jsonb_array_length(r -> 'members') <> 2 or jsonb_array_length(r -> 'invites') <> 2
     or not exists (select 1 from jsonb_array_elements(r -> 'invites') i where (i ->> 'expired')::boolean) then
    raise exception 'FAIL: owner A should see 2 grown-ups and 2 invites, one expired';
  end if;
  perform public.cancel_invite(current_setting('rls.inv_e')::uuid);
  perform private.rls_expect(format('select public.cancel_invite(%L)', current_setting('rls.inv_e')), 'not-found', 'an invite could be cancelled twice');
  perform public.remove_parent(current_setting('rls.user_c')::uuid);
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_c'), 'role', 'authenticated')::text, true);

do $$
declare
  r jsonb := public.family_people();
begin
  if exists (select 1 from public.families where id = current_setting('rls.fam_a')::uuid)
     or exists (select 1 from public.profiles where id = current_setting('rls.prof_a')::uuid) then
    raise exception 'FAIL: a removed parent still sees family A';
  end if;
  if r -> 'me' ->> 'role' <> 'owner' or jsonb_array_length(r -> 'members') <> 1 then
    raise exception 'FAIL: a removed parent should be alone in a new family of their own';
  end if;
end $$;

-- C is invited again, joins, and leaves on their own; then joins once more for the
-- owner check below.
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_a'), 'role', 'authenticated')::text, true);
do $$ begin perform set_config('rls.inv_c', public.invite_parent('rls-check-c@example.test') ->> 'id', true); end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_c'), 'role', 'authenticated')::text, true);
do $$
begin
  perform public.accept_invite(current_setting('rls.inv_c')::uuid);
  perform public.leave_family();
  if exists (select 1 from public.families where id = current_setting('rls.fam_a')::uuid) then
    raise exception 'FAIL: a parent who left still sees family A';
  end if;
  if (public.family_people() -> 'me' ->> 'role') <> 'owner' then
    raise exception 'FAIL: a parent who left should have a new family of their own';
  end if;
end $$;

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_a'), 'role', 'authenticated')::text, true);
do $$ begin perform set_config('rls.inv_c', public.invite_parent('rls-check-c@example.test') ->> 'id', true); end $$;
select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_c'), 'role', 'authenticated')::text, true);
do $$ begin perform public.accept_invite(current_setting('rls.inv_c')::uuid); end $$;

-- As postgres: one family per grown-up, and the longest-standing parent takes over when
-- the owner's account is deleted.
reset role;
do $$
begin
  perform private.rls_expect(format('insert into public.family_members (family_id, user_id) values (%L, %L)',
                                    current_setting('rls.fam_a'), current_setting('rls.user_d')),
                             '23505', 'a grown-up could be in two families');
end $$;

delete from auth.users where id = current_setting('rls.user_a')::uuid;

do $$
begin
  if not exists (select 1 from public.families where id = current_setting('rls.fam_a')::uuid)
     or not exists (select 1 from public.profiles where id = current_setting('rls.prof_a')::uuid) then
    raise exception 'FAIL: family A was deleted although parent C is still in it';
  end if;
  if (select role from public.family_members where user_id = current_setting('rls.user_c')::uuid
      and family_id = current_setting('rls.fam_a')::uuid) is distinct from 'owner' then
    raise exception 'FAIL: parent C did not become the owner when owner A''s account was deleted';
  end if;
end $$;

-- Signed out: none of the invite functions, nor the hook. (anon may reach the test
-- helper only; private.my_family_ids() was checked above. Rolled back like the rest.)
grant usage on schema private to anon;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  perform private.rls_expect($q$select public.invite_parent('x@example.test')$q$, '42501', 'anon could invite');
  perform private.rls_expect(format('select public.cancel_invite(%L)', gen_random_uuid()), '42501', 'anon could cancel an invite');
  perform private.rls_expect(format('select public.remove_parent(%L)', gen_random_uuid()), '42501', 'anon could remove a parent');
  perform private.rls_expect('select public.family_people()', '42501', 'anon could list a family');
  perform private.rls_expect('select public.leave_family()', '42501', 'anon could leave a family');
  perform private.rls_expect('select public.my_invites()', '42501', 'anon could list invites');
  perform private.rls_expect(format('select public.accept_invite(%L)', gen_random_uuid()), '42501', 'anon could accept an invite');
  perform private.rls_expect(format('select public.decline_invite(%L)', gen_random_uuid()), '42501', 'anon could decline an invite');
  perform private.rls_expect(format('select public.hook_before_user_created(%L::jsonb)', '{"user":{"email":"x@example.test"}}'),
                             '42501', 'anon could call the sign-up hook');
  perform private.rls_expect('select 1 from public.family_invites', '42501', 'anon could read family_invites');
end $$;

reset role;

select 'RLS check passed' as result, current_setting('rls.hook_as') as hook_checked_as;
rollback;
