-- A family with no members left is deleted, with everything it owns.
-- Deleting a user (dashboard, or later the app's own "delete my account") removes their
-- family_members rows (on delete cascade). When that leaves their family with nobody in
-- it, the family goes too, and its profiles, packs, cards and badges go with it (on delete
-- cascade from families). Nobody could reach those rows any more anyway. The explorers on
-- each device stay there.
-- Clients can't delete memberships (no grant), so this only runs for deletions made by
-- the server: a user being deleted, or a member removed by an admin.

create function private.delete_empty_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.families f
  where f.id = old.family_id
    and not exists (select 1 from public.family_members m where m.family_id = f.id);
  return null;
end;
$$;
revoke all on function private.delete_empty_family() from public;

-- After each removed membership. When the family itself is being deleted, its rows are
-- already gone and this finds nothing to do.
create trigger family_members_delete_empty_family
  after delete on public.family_members
  for each row execute function private.delete_empty_family();
