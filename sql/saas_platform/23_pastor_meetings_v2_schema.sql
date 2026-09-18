-- Pastor Meeting Scheduling System v2, tenant-scoped port: bulk slot
-- generation, recurring weekly availability, configurable booking
-- notice. Same additions as main, applied to the per-tenant table
-- shapes already in place (pastor_meeting_settings keyed by tenant_id,
-- not main's singleton boolean id).

begin;

alter table public.pastor_meeting_settings
  add column min_booking_notice_hours integer not null default 24 check (min_booking_notice_hours >= 0);

-- pastor_id alone already disambiguates tenant (a pastor belongs to
-- exactly one), so tenant_id doesn't need to be part of this
-- constraint for correctness -- same shape as main's.
alter table public.pastor_availability
  add constraint pastor_availability_unique_slot unique (pastor_id, date, start_time, end_time);

commit;

select pg_notify('pgrst', 'reload schema');
