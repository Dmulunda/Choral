-- Usage Dashboard drill-down: per-church login trend (for the chart)
-- and per-department usage within a church (active members, shifts
-- scheduled) -- the "select a church, then select a department"
-- level the dashboard's table view didn't cover.
--
-- Attendance rate is deliberately NOT included per-department here --
-- attendance_records tracks a whole SERVICE's attendance (service_date
-- + who was present), with no department_id at all, so there is no
-- real per-department attendance figure to report; fabricating one by
-- guessing at a department from who's scheduled that day would be
-- actively misleading on a dashboard the COP team makes real
-- decisions from.

begin;

create or replace function public.get_tenant_login_trend(p_tenant_id uuid)
returns table (day date, logins bigint)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view platform usage';
  end if;

  return query
  select le.logged_in_at::date as day, count(*)::bigint as logins
  from public.login_events le
  where le.tenant_id = p_tenant_id
    and le.logged_in_at >= now() - interval '30 days'
  group by le.logged_in_at::date
  order by day;
end;
$$;
revoke all on function public.get_tenant_login_trend(uuid) from public;
grant execute on function public.get_tenant_login_trend(uuid) to authenticated;

create or replace function public.list_department_usage_for_tenant(p_tenant_id uuid)
returns table (
  department_id uuid,
  department_name text,
  department_key text,
  active_member_count bigint,
  shift_count bigint,
  upcoming_shift_count bigint
)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view platform usage';
  end if;

  return query
  select
    d.id, d.name, d.key,
    (select count(*) from public.department_memberships dm where dm.department_id = d.id),
    (select count(*) from public.department_shifts ds where ds.department_id = d.id),
    (select count(*) from public.department_shifts ds where ds.department_id = d.id and ds.date >= current_date)
  from public.departments d
  where d.tenant_id = p_tenant_id
  order by d.name;
end;
$$;
revoke all on function public.list_department_usage_for_tenant(uuid) from public;
grant execute on function public.list_department_usage_for_tenant(uuid) to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
