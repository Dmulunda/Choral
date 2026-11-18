-- 165: monthly clean-up of past schedules (asked by the church).
--
-- On the 1st of every month (pg_cron, 04:15 UTC), every schedule entry
-- dated more than one month ago is deleted for good:
--   * department shifts and their assignments
--   * Media & Tech assignments
--   * Sunday-school (Ecodem) worker assignments -- the sessions
--     themselves and the children's check-in records are KEPT
--   * preaching / moderation schedule
--   * Choir service plans (their RSVPs, singers, songs and replacement
--     requests go with them)
--   * members' availability answers
-- Kept: church program, events, calendar items, attendance, offerings,
-- sermons. Note: Leadership insights and Service teams can only show
-- the last month of schedules after this runs.

create or replace function public.cleanup_old_schedules()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cutoff date := ((now() at time zone 'America/Toronto')::date - interval '1 month')::date;
  v jsonb := jsonb_build_object('cutoff', v_cutoff);
  n integer;
begin
  delete from department_shifts where date < v_cutoff;
  get diagnostics n = row_count; v := v || jsonb_build_object('department_shifts', n);

  delete from media_tech_assignments where date < v_cutoff;
  get diagnostics n = row_count; v := v || jsonb_build_object('media_tech_assignments', n);

  delete from ecodem_session_workers w using ecodem_sessions s
  where s.id = w.session_id and s.date < v_cutoff;
  get diagnostics n = row_count; v := v || jsonb_build_object('ecodem_session_workers', n);

  delete from preaching_schedule where date < v_cutoff;
  get diagnostics n = row_count; v := v || jsonb_build_object('preaching_schedule', n);

  delete from service_plans where date < v_cutoff;
  get diagnostics n = row_count; v := v || jsonb_build_object('service_plans', n);

  delete from availability where date < v_cutoff;
  get diagnostics n = row_count; v := v || jsonb_build_object('availability', n);

  return v;
end;
$$;

revoke all on function public.cleanup_old_schedules() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'cleanup-old-schedules';
select cron.schedule('cleanup-old-schedules', '15 4 1 * *', 'select public.cleanup_old_schedules();');
