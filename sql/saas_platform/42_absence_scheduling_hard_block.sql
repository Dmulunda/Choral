-- Two behavior changes to reported absences (both directions), per
-- product decision:
--
-- 1. Reporting an absence for a date you're already scheduled on is now
--    REJECTED outright (report_absence_conflict_check(), called by
--    reportAbsenceModal.js before ever calling report_absence()) --
--    naming exactly which date(s)/department(s) conflict, and notifying
--    that department's admins/secretaries that a swap is needed, so the
--    member doesn't have to separately go find them.
-- 2. Someone who's already reported an absence for a date can no longer
--    be scheduled on it at all -- not just filtered out of the picker
--    dropdown (which 4 of 5 scheduling boards already did) with a
--    save-time warning a scheduler could click through
--    (checkAndConfirmAssignment/checkAndConfirmBatchAssignment in
--    js/utils/schedulingConflicts.js, unchanged, still used for the
--    OTHER conflict kind -- "already assigned elsewhere that day", a
--    legitimate scheduler judgment call, not an absence). This is now a
--    hard, un-overridable rejection enforced server-side (BEFORE INSERT
--    OR UPDATE triggers below) on all 5 assignment tables, so it can't
--    be bypassed by calling the API directly either.

begin;

create or replace function public.has_reported_absence(p_user_id uuid, p_date date)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.availability
    where user_id = p_user_id and date = p_date and status = 'unavailable'
  );
$$;

revoke all on function public.has_reported_absence(uuid, date) from public;
grant execute on function public.has_reported_absence(uuid, date) to authenticated;

-- ---- Part 1: reject reporting an absence on an already-scheduled date ----

-- Duplicates the same UNION ALL of all 5 scheduling tables twice (the
-- notify insert, then the returned rows) rather than sharing it via a
-- temp table -- a temp table would risk "relation already exists" on a
-- pooled connection reused across unrelated requests (PgBouncer/
-- Supavisor transaction pooling), which a same-session CTE avoids
-- entirely. Self-service only (checks auth.uid(), not a parameter) --
-- nothing lets a member check/report on someone else's behalf.
create or replace function public.report_absence_conflict_check(p_dates date[])
returns table(conflict_date date, department_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_choir_id uuid;
  v_preaching_id uuid;
  v_media_tech_id uuid;
  v_ecodem_id uuid;
  v_full_name text;
begin
  select id into v_choir_id from public.departments where key = 'choir' and tenant_id = public.current_tenant_id();
  select id into v_preaching_id from public.departments where key = 'preaching' and tenant_id = public.current_tenant_id();
  select id into v_media_tech_id from public.departments where key = 'media_tech' and tenant_id = public.current_tenant_id();
  select id into v_ecodem_id from public.departments where key = 'ecodem' and tenant_id = public.current_tenant_id();
  select full_name into v_full_name from public.profiles where id = auth.uid();

  -- No-ops (inserts zero rows) when there are no conflicts -- no need
  -- for a separate "if conflicts exist" guard.
  -- Reuses the existing 'absence' notification_type (no
  -- 'absence_conflict' value exists in that enum, and adding one is
  -- unnecessary complexity for what's still fundamentally an
  -- absence-related notification).
  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  select distinct dm.user_id, 'absence'::public.notification_type,
    v_full_name || ' wants to be excused but is already scheduled',
    v_full_name || ' tried to report an absence for a date they are already scheduled -- please arrange a replacement.',
    auth.uid()
  from (
    select sp.date as d, v_choir_id as department_id
    from public.service_plan_singers sps join public.service_plans sp on sp.id = sps.service_plan_id
    where sps.singer_id = auth.uid() and sp.date = any(p_dates)
    union all
    select ps.date, v_preaching_id from public.preaching_schedule ps
    where ps.moderator_id = auth.uid() and ps.date = any(p_dates)
    union all
    select mta.date, v_media_tech_id from public.media_tech_assignments mta
    where mta.user_id = auth.uid() and mta.date = any(p_dates)
    union all
    select es.date, v_ecodem_id from public.ecodem_session_workers esw join public.ecodem_sessions es on es.id = esw.session_id
    where esw.user_id = auth.uid() and es.date = any(p_dates)
    union all
    select ds.date, ds.department_id from public.department_shift_assignments dsa
    join public.department_shifts ds on ds.id = dsa.shift_id
    where dsa.user_id = auth.uid() and ds.date = any(p_dates)
  ) conflicts
  join public.department_memberships dm
    on dm.department_id = conflicts.department_id and dm.role in ('admin', 'secretary') and dm.status = 'approved'
  where dm.user_id <> auth.uid();

  return query
    select c.d, dep.name
    from (
      select sp.date as d, v_choir_id as department_id
      from public.service_plan_singers sps join public.service_plans sp on sp.id = sps.service_plan_id
      where sps.singer_id = auth.uid() and sp.date = any(p_dates)
      union all
      select ps.date, v_preaching_id from public.preaching_schedule ps
      where ps.moderator_id = auth.uid() and ps.date = any(p_dates)
      union all
      select mta.date, v_media_tech_id from public.media_tech_assignments mta
      where mta.user_id = auth.uid() and mta.date = any(p_dates)
      union all
      select es.date, v_ecodem_id from public.ecodem_session_workers esw join public.ecodem_sessions es on es.id = esw.session_id
      where esw.user_id = auth.uid() and es.date = any(p_dates)
      union all
      select ds.date, ds.department_id from public.department_shift_assignments dsa
      join public.department_shifts ds on ds.id = dsa.shift_id
      where dsa.user_id = auth.uid() and ds.date = any(p_dates)
    ) c
    join public.departments dep on dep.id = c.department_id
    order by c.d;
end;
$function$;

revoke all on function public.report_absence_conflict_check(date[]) from public;
grant execute on function public.report_absence_conflict_check(date[]) to authenticated;

-- ---- Part 2: reject scheduling someone already reported absent ----

create or replace function public.enforce_no_scheduling_reported_absence()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid;
  v_date date;
  v_full_name text;
begin
  -- media_tech_assignments/ecodem_session_workers/department_shift_assignments
  -- carry a status/reason/responded_at (accept/decline) flow -- an UPDATE
  -- to one of those columns on an already-existing, already-valid row
  -- must not re-trigger this check just because the person has SINCE
  -- reported absence for unrelated reasons; only a genuinely new or
  -- changed assignee is checked, same reasoning as preaching_schedule's
  -- own moderatorChanged guard on the client side.
  if TG_TABLE_NAME = 'service_plan_singers' then
    if TG_OP = 'UPDATE' and new.singer_id is not distinct from old.singer_id then return new; end if;
    v_user_id := new.singer_id;
    select date into v_date from public.service_plans where id = new.service_plan_id;
  elsif TG_TABLE_NAME = 'preaching_schedule' then
    if new.moderator_id is null or (TG_OP = 'UPDATE' and new.moderator_id is not distinct from old.moderator_id) then
      return new;
    end if;
    v_user_id := new.moderator_id;
    v_date := new.date;
  elsif TG_TABLE_NAME = 'media_tech_assignments' then
    if TG_OP = 'UPDATE' and new.user_id is not distinct from old.user_id then return new; end if;
    v_user_id := new.user_id;
    v_date := new.date;
  elsif TG_TABLE_NAME = 'ecodem_session_workers' then
    if TG_OP = 'UPDATE' and new.user_id is not distinct from old.user_id then return new; end if;
    v_user_id := new.user_id;
    select date into v_date from public.ecodem_sessions where id = new.session_id;
  elsif TG_TABLE_NAME = 'department_shift_assignments' then
    if TG_OP = 'UPDATE' and new.user_id is not distinct from old.user_id then return new; end if;
    v_user_id := new.user_id;
    select date into v_date from public.department_shifts where id = new.shift_id;
  end if;

  if v_user_id is not null and v_date is not null and public.has_reported_absence(v_user_id, v_date) then
    select full_name into v_full_name from public.profiles where id = v_user_id;
    raise exception '% has already reported an absence for % and cannot be scheduled that day.', coalesce(v_full_name, 'This member'), v_date;
  end if;

  return new;
end;
$function$;

drop trigger if exists no_scheduling_reported_absence on public.service_plan_singers;
create trigger no_scheduling_reported_absence
  before insert or update on public.service_plan_singers
  for each row execute function public.enforce_no_scheduling_reported_absence();

drop trigger if exists no_scheduling_reported_absence on public.preaching_schedule;
create trigger no_scheduling_reported_absence
  before insert or update on public.preaching_schedule
  for each row execute function public.enforce_no_scheduling_reported_absence();

drop trigger if exists no_scheduling_reported_absence on public.media_tech_assignments;
create trigger no_scheduling_reported_absence
  before insert or update on public.media_tech_assignments
  for each row execute function public.enforce_no_scheduling_reported_absence();

drop trigger if exists no_scheduling_reported_absence on public.ecodem_session_workers;
create trigger no_scheduling_reported_absence
  before insert or update on public.ecodem_session_workers
  for each row execute function public.enforce_no_scheduling_reported_absence();

drop trigger if exists no_scheduling_reported_absence on public.department_shift_assignments;
create trigger no_scheduling_reported_absence
  before insert or update on public.department_shift_assignments
  for each row execute function public.enforce_no_scheduling_reported_absence();

commit;

select pg_notify('pgrst', 'reload schema');
