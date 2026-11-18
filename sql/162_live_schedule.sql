-- 162: Regular live-service times for the countdown on welcome.html and
-- live.html (day: 0 = Sunday ... 6 = Saturday; time: 24 h "HH:MM" in
-- live_timezone). Edited in Super Admin Home -> Change Info.
alter table public.church_branding
  add column if not exists live_schedule jsonb not null default '[{"day":3,"time":"19:00"},{"day":5,"time":"18:30"},{"day":0,"time":"10:30"}]'::jsonb,
  add column if not exists live_timezone text not null default 'America/Toronto';
alter table public.church_branding drop constraint if exists church_branding_live_schedule_array;
alter table public.church_branding add constraint church_branding_live_schedule_array check (jsonb_typeof(live_schedule) = 'array' and jsonb_array_length(live_schedule) <= 14);
-- Wednesday 7:00 PM, Friday 6:30 PM, Sunday 10:30 AM
update public.church_branding set live_schedule = '[{"day":3,"time":"19:00"},{"day":5,"time":"18:30"},{"day":0,"time":"10:30"}]'::jsonb where id;
