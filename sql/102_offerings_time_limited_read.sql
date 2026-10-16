-- Main's own version of SAAS's sql/saas_platform/66_offerings_finance_
-- roles.sql + 89_offerings_time_limited_read.sql combined -- Main
-- never got the admin/non-admin split those two SAAS migrations
-- introduced (it was still on the older single can_manage_finance()
-- check, which is admin/secretary-only -- so "everyone in Finance can
-- enter offerings" wasn't even true here yet). Adds the same two
-- helper functions (no tenant_id qualifier needed -- Main is single-
-- tenant, department keys are already unique), widens who can INSERT
-- to any approved Finance member, and time-limits non-admin reads to
-- today only. DELETE/UPDATE policies are left exactly as they already
-- are -- not part of what was asked.

create or replace function public.can_record_offerings()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select public.can_read_department((select id from public.departments where key = 'finance'));
$$;

create or replace function public.can_delete_offerings()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or public.can_write_department((select id from public.departments where key = 'finance'));
$$;

grant execute on function public.can_record_offerings() to authenticated;
grant execute on function public.can_delete_offerings() to authenticated;

drop policy if exists "finance team can record offerings" on public.offerings;
create policy "finance team can record offerings" on public.offerings
  for insert to authenticated with check (recorded_by = auth.uid() and public.can_record_offerings());

drop policy if exists "finance team can read offerings" on public.offerings;
create policy "finance team can read offerings" on public.offerings
  for select to authenticated using (
    public.can_delete_offerings()
    or (public.can_record_offerings() and offering_date = current_date)
  );

select pg_notify('pgrst', 'reload schema');
