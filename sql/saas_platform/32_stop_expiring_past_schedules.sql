-- Reverses 13_expire_past_schedules.sql: that nightly cron job was
-- physically DELETING department_shifts/preaching_schedule/
-- media_tech_assignments/ecodem_sessions the day after their date (8
-- days for service_plans) -- which directly conflicted with a later
-- request to keep Service Program (js/serviceProgramBoard.js,
-- get_service_program()) able to look up any past date and show who
-- worked it. The "removed once the day has passed" behavior members
-- actually wanted is already handled at the UI layer -- every
-- department board (ecodemBoard.js, departmentShiftBoard.js,
-- preachingScheduleBoard.js, mediaTechBoard.js, uniformSchedule.js,
-- serviceRequestAdmin.js) already filters its own day-to-day list to
-- `.gte('date', todayLocal())` for everyone except super_admin, so a
-- past shift already drops out of the normal working view without
-- the row needing to be deleted. Only Service Program needs the full
-- history, and it already has a free (no min-date) date picker.

begin;

select cron.unschedule('expire-past-schedules');

drop function if exists public.expire_past_schedules();

commit;
