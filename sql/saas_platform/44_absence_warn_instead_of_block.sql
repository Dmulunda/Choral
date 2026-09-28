-- Changes reporting-absence-while-scheduled from a hard rejection to a
-- warn-and-allow flow, per product decision:
--
-- 1. report_absence_conflict_check() is now PURE READ (no notification
--    insert) -- just used by the client to build a confirm dialog
--    ("you're already scheduled on X, still want to report absence?
--    talk to your department head") before ever calling report_absence().
--    If the person confirms, report_absence() still succeeds -- it is
--    no longer rejected.
-- 2. The "wants to be excused but is already scheduled" notification to
--    that department's admins/secretaries now fires from INSIDE
--    report_absence() itself, at the point the absence is actually
--    recorded -- not from the read-only check, which could previously
--    fire it even if the person then canceled and never actually
--    reported anything.
--
-- The OTHER direction (someone already marked absent can't be newly
-- scheduled -- enforce_no_scheduling_reported_absence(), 42_absence_
-- scheduling_hard_block.sql) is unchanged by this migration.

begin;

-- Shared by both functions below so the "which 5 tables, which
-- departments" logic only lives in one place.
create or replace function public.find_schedule_conflicts_for_dates(p_user_id uuid, p_dates date[])
returns table(conflict_date date, department_id uuid, department_name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  v_choir_id uuid;
  v_preaching_id uuid;
  v_media_tech_id uuid;
  v_ecodem_id uuid;
begin
  select id into v_choir_id from public.departments where key = 'choir' and tenant_id = public.current_tenant_id();
  select id into v_preaching_id from public.departments where key = 'preaching' and tenant_id = public.current_tenant_id();
  select id into v_media_tech_id from public.departments where key = 'media_tech' and tenant_id = public.current_tenant_id();
  select id into v_ecodem_id from public.departments where key = 'ecodem' and tenant_id = public.current_tenant_id();

  return query
    select c.d, c.department_id, dep.name
    from (
      select sp.date as d, v_choir_id as department_id
      from public.service_plan_singers sps join public.service_plans sp on sp.id = sps.service_plan_id
      where sps.singer_id = p_user_id and sp.date = any(p_dates)
      union all
      select ps.date, v_preaching_id from public.preaching_schedule ps
      where ps.moderator_id = p_user_id and ps.date = any(p_dates)
      union all
      select mta.date, v_media_tech_id from public.media_tech_assignments mta
      where mta.user_id = p_user_id and mta.date = any(p_dates)
      union all
      select es.date, v_ecodem_id from public.ecodem_session_workers esw join public.ecodem_sessions es on es.id = esw.session_id
      where esw.user_id = p_user_id and es.date = any(p_dates)
      union all
      select ds.date, ds.department_id from public.department_shift_assignments dsa
      join public.department_shifts ds on ds.id = dsa.shift_id
      where dsa.user_id = p_user_id and ds.date = any(p_dates)
    ) c
    join public.departments dep on dep.id = c.department_id
    order by c.d;
end;
$function$;

revoke all on function public.find_schedule_conflicts_for_dates(uuid, date[]) from public;
grant execute on function public.find_schedule_conflicts_for_dates(uuid, date[]) to authenticated;

create or replace function public.report_absence_conflict_check(p_dates date[])
returns table(conflict_date date, department_name text)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select conflict_date, department_name from public.find_schedule_conflicts_for_dates(auth.uid(), p_dates);
$$;

revoke all on function public.report_absence_conflict_check(date[]) from public;
grant execute on function public.report_absence_conflict_check(date[]) to authenticated;

create or replace function public.report_absence(p_dates date[], p_reason text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_report_id uuid;
  v_first_report_id uuid;
  v_full_name text;
  v_title text;
  v_body text;
  v_date date;
  v_dates date[];
begin
  if p_dates is null or array_length(p_dates, 1) is null then
    raise exception 'At least one date is required';
  end if;
  if array_length(p_dates, 1) > 180 then
    raise exception 'Cannot report more than 180 dates at once';
  end if;

  select array_agg(distinct d order by d) into v_dates from unnest(p_dates) as d;

  select full_name into v_full_name from public.profiles where id = auth.uid();

  v_title := case when array_length(v_dates, 1) = 1
    then v_full_name || ' reported an absence'
    else v_full_name || ' reported ' || array_length(v_dates, 1)::text || ' days unavailable' end;
  v_body := v_full_name || ' will be unavailable on: '
    || (select string_agg(d::text, ', ' order by d) from unnest(v_dates) as d)
    || case when p_reason is not null and p_reason <> '' then '. Reason: ' || p_reason else '' end;

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  select recipient_id, 'absence', v_title, v_body, auth.uid()
  from (
    select dm2.user_id as recipient_id
    from public.department_memberships dm1
    join public.department_memberships dm2
      on dm2.department_id = dm1.department_id
     and dm2.role in ('admin', 'secretary')
     and dm2.status = 'approved'
    where dm1.user_id = auth.uid() and dm1.status = 'approved'
    union
    select id as recipient_id
    from public.profiles
    where global_role in ('super_admin', 'pastor_admin', 'church_secretary')
      and tenant_id = public.current_tenant_id()
  ) recipients
  where recipient_id <> auth.uid();

  -- The person confirmed they still want to report absence despite
  -- already being scheduled (client-side confirm dialog, built from
  -- report_absence_conflict_check()) -- this is what actually notifies
  -- the affected department(s) now that it's really happening, not the
  -- read-only check that may have been cancelled.
  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  select distinct dm.user_id, 'absence'::public.notification_type,
    v_full_name || ' wants to be excused but is already scheduled',
    v_full_name || ' reported an absence for a date they are already scheduled -- please arrange a replacement.',
    auth.uid()
  from public.find_schedule_conflicts_for_dates(auth.uid(), v_dates) c
  join public.department_memberships dm
    on dm.department_id = c.department_id and dm.role in ('admin', 'secretary') and dm.status = 'approved'
  where dm.user_id <> auth.uid();

  foreach v_date in array v_dates loop
    insert into public.absence_reports (user_id, absence_date, reason)
    values (auth.uid(), v_date, p_reason)
    returning id into v_report_id;

    if v_first_report_id is null then
      v_first_report_id := v_report_id;
    end if;

    insert into public.availability (user_id, date, status)
    values (auth.uid(), v_date, 'unavailable')
    on conflict (user_id, date) do update set status = 'unavailable';
  end loop;

  return v_first_report_id;
end;
$function$;

commit;

select pg_notify('pgrst', 'reload schema');
