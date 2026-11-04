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

select 'RLS check passed' as result;
rollback;
