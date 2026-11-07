-- The Welcome details go on the explorer's row: age, height, weight and home country. Until now
-- they stayed on the device (the note at the top of 20261103115447_profiles.sql no longer holds).
-- The profiles policies and grants are per table, so these columns are already limited to the
-- caller's family: every grown-up in the family can read them, and nobody else.
--
-- They have their own time, details_at, apart from the settings' client_updated_at. A device
-- that has never had an explorer's details sends them empty with no time, and must not clear
-- what another device filled in when it changes a setting.

alter table public.profiles
  add column age          smallint check (age between 0 and 120),
  add column age_as_of    timestamptz,  -- when the age was entered: birthdays count from then
  add column height_cm    numeric(4, 1) check (height_cm between 40 and 250),
  add column weight_kg    numeric(4, 1) check (weight_kg between 3 and 300),
  add column home_country text check (home_country ~ '^[A-Z]{2}$'), -- ISO code, as in js/countries.js
  add column details_at   timestamptz;  -- the device's time for the details: decides which win

-- As in 20261103115447_profiles.sql, with one rule added:
--   details       the newer details_at wins (the whole set); none at all changes nothing
create or replace function private.merge_profile()
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

  if new.details_at is null or new.details_at < old.details_at then
    new.age := old.age;
    new.age_as_of := old.age_as_of;
    new.height_cm := old.height_cm;
    new.weight_kg := old.weight_kg;
    new.home_country := old.home_country;
    new.details_at := old.details_at;
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
