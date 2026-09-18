-- Pastor Meeting Scheduling System, tenant-scoped port of main's build.
-- Deviates from the original plan sketch in one place: pastor_meeting_
-- settings stays its own per-tenant table rather than becoming columns
-- on `tenants`, because tenants' write policy is super-admin-only
-- (`id = current_tenant_id() and is_super_admin()`) while this setting
-- needs super-admin OR church-secretary write access, same as main --
-- a mismatch only visible once tenants' actual policy was checked live.

begin;

create table public.pastor_availability (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  pastor_id uuid not null references public.profiles(id),
  date date not null,
  start_time time not null,
  end_time time not null,
  location_type text not null check (location_type in ('office','online')),
  created_at timestamptz not null default now(),
  check (end_time > start_time)
);

create index pastor_availability_pastor_id_idx on public.pastor_availability(pastor_id);
create index pastor_availability_date_idx on public.pastor_availability(date);
create index pastor_availability_tenant_id_idx on public.pastor_availability(tenant_id);

alter table public.pastor_availability enable row level security;

create policy "pastor manages own availability" on public.pastor_availability
  for all using (pastor_id = auth.uid() or public.is_super_admin())
  with check (pastor_id = auth.uid() or public.is_super_admin());

create policy tenant_isolation on public.pastor_availability
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- Extend pastor_meeting_requests (already tenant-scoped) the same way
-- main's was extended.
alter table public.pastor_meeting_requests alter column user_id drop not null;
alter table public.pastor_meeting_requests add column pastor_id uuid references public.profiles(id);
alter table public.pastor_meeting_requests add column availability_id uuid references public.pastor_availability(id);
alter table public.pastor_meeting_requests add column meeting_type text check (meeting_type in ('office','online'));
alter table public.pastor_meeting_requests add column guest_name text;
alter table public.pastor_meeting_requests add column guest_email text;
alter table public.pastor_meeting_requests add column guest_phone text;
alter table public.pastor_meeting_requests add constraint pastor_meeting_requests_identity_check
  check (user_id is not null or guest_email is not null);

drop policy "pastor meeting requests are readable by requester or the church" on public.pastor_meeting_requests;
create policy "pastor meeting requests are readable by requester or the church" on public.pastor_meeting_requests
  for select using (
    user_id = auth.uid()
    or pastor_id = auth.uid()
    or public.is_church_secretary()
    or public.is_super_admin()
  );

-- Per-tenant settings row (tenant_id itself is the PK -- one row per
-- tenant, not main's single global boolean-PK row).
create table public.pastor_meeting_settings (
  tenant_id uuid primary key default public.current_tenant_id(),
  selection_mode text not null default 'manual' check (selection_mode in ('manual','random')),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.pastor_meeting_settings enable row level security;

create policy "pastor meeting settings readable by pastoral team" on public.pastor_meeting_settings
  for select using (public.is_super_admin() or public.is_church_secretary() or public.is_pastor_admin());

create policy "pastor meeting settings managed by admin" on public.pastor_meeting_settings
  for all using (public.is_super_admin() or public.is_church_secretary())
  with check (public.is_super_admin() or public.is_church_secretary());

create policy tenant_isolation on public.pastor_meeting_settings
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

commit;

-- Separate statements -- new enum values can't be used in the same
-- transaction that adds them.
alter type public.pastor_meeting_status add value if not exists 'cancelled';
alter type public.notification_type add value if not exists 'pastor_meeting_booked';

select pg_notify('pgrst', 'reload schema');
