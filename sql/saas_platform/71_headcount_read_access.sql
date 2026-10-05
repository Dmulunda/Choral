-- Real pre-existing gap found while merging Record Headcount and
-- Headcount Tally into one page (js/headcountTallyPage.js): the tally
-- tap-counter is open to any approved department member
-- (add_headcount_tally RPC checks can_read_department()), but its
-- "recorded so far" display (headcountTally.js's loadRecorded())
-- reads department_headcounts directly, which only allows
-- can_manage_department() (admin/secretary) or is_pastoral_team() to
-- SELECT -- a plain member silently gets zero rows back (not an
-- error) and sees "0" even when something's already recorded. Now
-- that the merged page is the single entry point for every approved
-- member, not just admins, this needs to actually match what the RPC
-- already allows.

begin;

drop policy if exists "headcounts are readable by department managers or pastoral team" on public."department_headcounts";
create policy "headcounts are readable by department members" on public."department_headcounts"
  for select to authenticated using (can_read_department(department_id) or is_pastoral_team());

commit;

select pg_notify('pgrst', 'reload schema');
