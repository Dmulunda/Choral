-- Same daily cleanup job as the live single-church app, ported over so
-- this project doesn't silently diverge: department_shifts,
-- preaching_schedule, media_tech_assignments, ecodem_sessions are purged
-- the day after their date passes; Choir's service_plans gets an 8-day
-- window instead, so roughly the last two Sunday/Friday services stay
-- visible. Multi-tenant here, but the job itself needs no tenant
-- filtering -- it deletes by date across every tenant at once, which
-- leaks nothing (no data is read, only expired rows anywhere are
-- dropped) and matches what every tenant already expects.
--
-- FKs verified live in this project (matches the live single-church
-- project): department_shifts and ecodem_sessions each cascade to their
-- own child table; preaching_schedule and media_tech_assignments have no
-- incoming FKs; service_plans cascades to replacement_requests,
-- service_plan_singers, service_plan_songs, service_rsvps.

begin;

create or replace function public.expire_past_schedules()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.department_shifts where date < current_date;
  delete from public.preaching_schedule where date < current_date;
  delete from public.media_tech_assignments where date < current_date;
  delete from public.ecodem_sessions where date < current_date;
  delete from public.service_plans where date < current_date - interval '8 days';
end;
$$;

commit;

select cron.schedule(
  'expire-past-schedules',
  '0 4 * * *',
  'select public.expire_past_schedules();'
);
