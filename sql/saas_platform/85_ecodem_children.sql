-- Extends Sunday School (the `ecodem` department -- already renamed
-- in js/i18n.js, see sql/saas_platform/12_all_default_departments.sql's
-- own comment) with child records, parent-request tracking, and a
-- link from children to the existing ecodem_sessions (the "activity"
-- concept already there -- date/age_group/topic/leader, just missing
-- who's registered). Ungated, available on every plan. Same RLS idiom
-- as ecodem_sessions itself: can_read_department/can_write_department
-- ((select id from departments where key = 'ecodem')) -- visible to
-- Sunday School's own approved members, hidden from the rest of the
-- church. No extra column-level split for allergies/medical/phone:
-- "authorized teachers and leaders" already means "approved member of
-- this department," which is exactly what can_read_department grants.

begin;

create table if not exists public.ecodem_children (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  full_name text not null,
  age_group ecodem_age_group,
  photo_url text,
  allergies text,
  medical_notes text,
  parent_name text,
  parent_phone text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.ecodem_children alter column tenant_id set default public.current_tenant_id();
create index if not exists ecodem_children_tenant_id_idx on public.ecodem_children (tenant_id);

alter table public.ecodem_children enable row level security;

drop policy if exists "tenant_isolation" on public.ecodem_children;
create policy "tenant_isolation" on public.ecodem_children as restrictive for all
  using (tenant_id = current_tenant_id());

drop policy if exists "ecodem members read children" on public.ecodem_children;
create policy "ecodem members read children" on public.ecodem_children
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'ecodem')));

drop policy if exists "ecodem admins manage children" on public.ecodem_children;
create policy "ecodem admins manage children" on public.ecodem_children
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'ecodem')))
  with check (public.can_write_department((select id from public.departments where key = 'ecodem')));

create table if not exists public.ecodem_session_registrations (
  session_id uuid not null references public.ecodem_sessions(id) on delete cascade,
  child_id uuid not null references public.ecodem_children(id) on delete cascade,
  registered_at timestamptz not null default now(),
  primary key (session_id, child_id)
);

alter table public.ecodem_session_registrations enable row level security;

drop policy if exists "ecodem members read registrations" on public.ecodem_session_registrations;
create policy "ecodem members read registrations" on public.ecodem_session_registrations
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'ecodem')));

drop policy if exists "ecodem admins manage registrations" on public.ecodem_session_registrations;
create policy "ecodem admins manage registrations" on public.ecodem_session_registrations
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'ecodem')))
  with check (public.can_write_department((select id from public.departments where key = 'ecodem')));

create table if not exists public.ecodem_parent_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  title text not null,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.ecodem_parent_requests alter column tenant_id set default public.current_tenant_id();
create index if not exists ecodem_parent_requests_tenant_id_idx on public.ecodem_parent_requests (tenant_id);

alter table public.ecodem_parent_requests enable row level security;

drop policy if exists "tenant_isolation" on public.ecodem_parent_requests;
create policy "tenant_isolation" on public.ecodem_parent_requests as restrictive for all
  using (tenant_id = current_tenant_id());

drop policy if exists "ecodem members read parent requests" on public.ecodem_parent_requests;
create policy "ecodem members read parent requests" on public.ecodem_parent_requests
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'ecodem')));

drop policy if exists "ecodem admins manage parent requests" on public.ecodem_parent_requests;
create policy "ecodem admins manage parent requests" on public.ecodem_parent_requests
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'ecodem')))
  with check (public.can_write_department((select id from public.departments where key = 'ecodem')));

create table if not exists public.ecodem_parent_acknowledgements (
  request_id uuid not null references public.ecodem_parent_requests(id) on delete cascade,
  child_id uuid not null references public.ecodem_children(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  acknowledged_by uuid references public.profiles(id) on delete set null,
  primary key (request_id, child_id)
);

alter table public.ecodem_parent_acknowledgements enable row level security;

drop policy if exists "ecodem members read acknowledgements" on public.ecodem_parent_acknowledgements;
create policy "ecodem members read acknowledgements" on public.ecodem_parent_acknowledgements
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'ecodem')));

drop policy if exists "ecodem admins manage acknowledgements" on public.ecodem_parent_acknowledgements;
create policy "ecodem admins manage acknowledgements" on public.ecodem_parent_acknowledgements
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'ecodem')))
  with check (public.can_write_department((select id from public.departments where key = 'ecodem')));

commit;

select pg_notify('pgrst', 'reload schema');
