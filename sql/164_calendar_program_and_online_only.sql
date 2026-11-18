-- 164: make the church calendar show the church's real program, and
-- mark which weekly services are online only.
--
-- 1) live_schedule slots can carry "online_only": true. Wednesday 19:00
--    is online only; Friday and Sunday are at the church (address in
--    church_branding) and also streamed live.
-- 2) get_church_calendar(): department duty rosters ("who serves", e.g.
--    Interpreting, Ushers, Choir service plans) are no longer listed as
--    calendar entries -- they belong to each department's Schedule and
--    to Service Program, and showed up in the calendar as confusing
--    "Schedule" items. Departments flagged is_public_calendar still
--    appear (that flag exists exactly for that). The Church Program
--    (church_program_dates) is now in the calendar, at the weekly
--    service time when there is one, with the church address or
--    "Online (YouTube)" as its place.

update public.church_branding
set live_schedule = '[{"day":3,"time":"19:00","online_only":true},{"day":5,"time":"18:30","online_only":false},{"day":0,"time":"10:30","online_only":false}]'::jsonb
where id;

create or replace function public.get_church_calendar(p_from date, p_to date, p_feed boolean default false)
returns table(kind text, ref_id uuid, title text, starts_at timestamptz, ends_at timestamptz, all_day boolean, location text, department_id uuid, visibility text, created_by uuid)
language plpgsql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_leader boolean;
  v_schedule jsonb;
  v_address text;
begin
  if p_feed then
    if auth.role() <> 'service_role' then raise exception 'not allowed'; end if;
    v_leader := false;
  else
    if auth.uid() is null then return; end if;
    v_leader := public.is_church_leader();
  end if;
  if p_to < p_from or p_to - p_from > 400 then return; end if;

  select coalesce(b.live_schedule, '[]'::jsonb), b.address into v_schedule, v_address
  from public.church_branding b where b.id limit 1;
  v_schedule := coalesce(v_schedule, '[]'::jsonb);

  return query
  select 'item'::text, c.id, c.title, c.starts_at, c.ends_at, false, r.name, c.department_id, c.visibility, c.created_by
  from public.calendar_items c left join public.rooms r on r.id = c.room_id
  where c.starts_at < (p_to + 1)::timestamptz and c.ends_at >= p_from::timestamptz
    and (c.visibility = 'church' or v_leader)
  union all
  select 'event', e.id, e.title, e.start_at, coalesce(e.end_at, e.start_at + interval '2 hours'), false, e.location, e.organizing_department_id, 'church', e.created_by
  from public.events e
  where e.status = 'active' and e.start_at::date between p_from and p_to
  union all
  select 'program', pd.id, p.title,
         case when slot.time is not null then ((pd.date + slot.time) at time zone 'America/Toronto') else pd.date::timestamptz end,
         case when slot.time is not null then ((pd.date + slot.time + interval '2 hours') at time zone 'America/Toronto') else pd.date::timestamptz end,
         slot.time is null,
         case when slot.online_only then 'En ligne / Online (YouTube)' else v_address end,
         null::uuid, 'church', p.created_by
  from public.church_program_dates pd
  join public.church_programs p on p.id = pd.program_id
  left join lateral (
    select (s->>'time')::time as time, coalesce((s->>'online_only')::boolean, false) as online_only
    from jsonb_array_elements(v_schedule) s
    where (s->>'day')::int = extract(dow from pd.date)::int and (s->>'time') ~ '^\d{2}:\d{2}$'
    order by s->>'time' limit 1
  ) slot on true
  where pd.date between p_from and p_to
  union all
  select distinct on (ds.department_id, ds.date, ds.title) 'shift', ds.id, d.name || ' — ' || coalesce(nullif(ds.title, ''), 'Service'),
         ds.date::timestamptz, ds.date::timestamptz, true, null::text, ds.department_id, 'church', ds.created_by
  from public.department_shifts ds join public.departments d on d.id = ds.department_id
  where ds.date between p_from and p_to and d.is_public_calendar
  union all
  select 'group', g.id, g.name,
         ((gs.d + coalesce(g.meeting_time, time '19:00')) at time zone 'America/Toronto'),
         ((gs.d + coalesce(g.meeting_time, time '19:00') + interval '90 minutes') at time zone 'America/Toronto'),
         false, g.location, null, 'church', null
  from public.small_groups g
  cross join lateral generate_series(p_from, p_to, interval '1 day') as gs(d)
  where g.archived_at is null and g.meeting_day is not null
    and extract(dow from gs.d) = g.meeting_day;
end;
$function$;
