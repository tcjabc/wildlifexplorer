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

-- ---------- As parent B ----------

select set_config('request.jwt.claims',
  json_build_object('sub', current_setting('rls.user_b'), 'role', 'authenticated')::text, true);

do $$
begin
  if (select count(*) from public.families) <> 1
     or exists (select 1 from public.families where id = current_setting('rls.fam_a')::uuid) then
    raise exception 'FAIL: parent B should see only their own family';
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
end $$;

-- ---------- Done ----------

reset role;
select 'RLS check passed' as result;
rollback;
