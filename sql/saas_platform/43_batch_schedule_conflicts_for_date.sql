-- Batch sibling of get_user_schedule_conflicts() -- instead of one
-- user at a time, returns every (user_id, department_name) pair for
-- anyone already assigned somewhere ELSE on a given date, in one
-- round trip. Powers a plain-text note next to a candidate's name in
-- the picker dropdowns ("already in {department}") -- native <option>
-- elements can't render bold/color, so this is deliberately plain text,
-- not a redesign of the pickers themselves.
--
-- While writing this, found get_user_schedule_conflicts() (and this
-- new sibling, if written the same naive way) joins departments ON
-- d.key = '<key>' with NO tenant_id filter -- the exact bug class
-- fixed in 38_fix_is_admin_cross_tenant_departments.sql, just
-- surfacing as duplicate/wrong-tenant rows here (a JOIN multiplying
-- rows) rather than a "more than one row" crash (which only happens in
-- a scalar-subquery context). Fixed in both functions below.

begin;

create or replace function public.get_user_schedule_conflicts(p_user_id uuid, p_date date, p_exclude_department_id uuid)
returns table(department_name text, context text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if (select tenant_id from public.profiles where id = p_user_id) is distinct from public.current_tenant_id() then
    return;
  end if;

  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.department_memberships
      where user_id = auth.uid() and department_id = p_exclude_department_id
        and role in ('admin', 'secretary') and status = 'approved'
    )
  ) then
    return;
  end if;

  return query
  select d.name, 'Choir (' || sps.voice_part::text || ')'
  from public.service_plan_singers sps
  join public.service_plans sp on sp.id = sps.service_plan_id
  join public.departments d on d.key = 'choir' and d.tenant_id = public.current_tenant_id()
  where sps.singer_id = p_user_id and sp.date = p_date and sp.status <> 'draft'
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, 'Preaching (moderator)'
  from public.preaching_schedule ps
  join public.departments d on d.key = 'preaching' and d.tenant_id = public.current_tenant_id()
  where ps.moderator_id = p_user_id and ps.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, 'Media & Tech (' || mta.role::text || ')'
  from public.media_tech_assignments mta
  join public.departments d on d.key = 'media_tech' and d.tenant_id = public.current_tenant_id()
  where mta.user_id = p_user_id and mta.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, 'Ecodem (' || es.age_group::text || ')'
  from public.ecodem_session_workers esw
  join public.ecodem_sessions es on es.id = esw.session_id
  join public.departments d on d.key = 'ecodem' and d.tenant_id = public.current_tenant_id()
  where esw.user_id = p_user_id and es.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, ds.title
  from public.department_shift_assignments dsa
  join public.department_shifts ds on ds.id = dsa.shift_id
  join public.departments d on d.id = ds.department_id
  where dsa.user_id = p_user_id and ds.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select null::text, 'reported absent'
  where exists (
    select 1 from public.absence_reports
    where user_id = p_user_id and absence_date = p_date
  );
end;
$function$;

create or replace function public.get_all_schedule_conflicts_for_date(p_date date, p_exclude_department_id uuid)
returns table(user_id uuid, department_name text)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  -- Table-qualified throughout: this function's OUT parameter (user_id)
  -- becomes a plpgsql variable in scope for the whole body, so an
  -- unqualified "user_id" is ambiguous against department_memberships'
  -- own user_id column (same bug class as find_denomination_member_by_email
  -- in 36_church_extensions_member_lookup.sql).
  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.department_memberships dm
      where dm.user_id = auth.uid() and dm.department_id = p_exclude_department_id
        and dm.role in ('admin', 'secretary') and dm.status = 'approved'
    )
  ) then
    return;
  end if;

  return query
  select sps.singer_id, d.name
  from public.service_plan_singers sps
  join public.service_plans sp on sp.id = sps.service_plan_id
  join public.departments d on d.key = 'choir' and d.tenant_id = public.current_tenant_id()
  where sp.date = p_date and sp.status <> 'draft'
    and d.id is distinct from p_exclude_department_id

  union all

  select ps.moderator_id, d.name
  from public.preaching_schedule ps
  join public.departments d on d.key = 'preaching' and d.tenant_id = public.current_tenant_id()
  where ps.date = p_date and ps.moderator_id is not null
    and d.id is distinct from p_exclude_department_id

  union all

  select mta.user_id, d.name
  from public.media_tech_assignments mta
  join public.departments d on d.key = 'media_tech' and d.tenant_id = public.current_tenant_id()
  where mta.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select esw.user_id, d.name
  from public.ecodem_session_workers esw
  join public.ecodem_sessions es on es.id = esw.session_id
  join public.departments d on d.key = 'ecodem' and d.tenant_id = public.current_tenant_id()
  where es.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select dsa.user_id, d.name
  from public.department_shift_assignments dsa
  join public.department_shifts ds on ds.id = dsa.shift_id
  join public.departments d on d.id = ds.department_id
  where ds.date = p_date
    and d.id is distinct from p_exclude_department_id;
end;
$function$;

revoke all on function public.get_all_schedule_conflicts_for_date(date, uuid) from public;
grant execute on function public.get_all_schedule_conflicts_for_date(date, uuid) to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
