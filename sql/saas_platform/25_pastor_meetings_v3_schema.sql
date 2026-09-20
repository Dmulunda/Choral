-- Pastor Meeting Scheduling System v3, tenant-scoped port: max lead
-- time, per-pastor pause, church timezone, contact name/phone
-- (renamed from guest_name/guest_phone), cancellation reason.

begin;

alter table public.pastor_meeting_settings
  add column max_booking_lead_days integer,
  add column church_timezone text not null default 'America/Toronto';

alter table public.pastor_meeting_settings
  add constraint pastor_meeting_settings_max_lead_check check (max_booking_lead_days is null or max_booking_lead_days >= 0);

create table public.pastor_meeting_pause (
  pastor_id uuid primary key references public.profiles(id),
  tenant_id uuid not null default public.current_tenant_id(),
  paused boolean not null default false,
  message text,
  updated_at timestamptz not null default now()
);

create index pastor_meeting_pause_tenant_id_idx on public.pastor_meeting_pause(tenant_id);

alter table public.pastor_meeting_pause enable row level security;

create policy "pastor manages own pause state" on public.pastor_meeting_pause
  for all using (pastor_id = auth.uid() or public.is_super_admin())
  with check (pastor_id = auth.uid() or public.is_super_admin());

create policy "pause state is readable by everyone" on public.pastor_meeting_pause
  for select using (true);

create policy tenant_isolation on public.pastor_meeting_pause
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- Same rename as main -- guest_name/guest_phone already meant exactly
-- "this booking's contact name/phone," a member booking now populates
-- them too, so the "guest_" prefix stopped being accurate.
alter table public.pastor_meeting_requests rename column guest_name to contact_name;
alter table public.pastor_meeting_requests rename column guest_phone to contact_phone;
alter table public.pastor_meeting_requests add column cancellation_reason text;

commit;

select pg_notify('pgrst', 'reload schema');
