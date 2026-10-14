-- Main's version of the same feature as SAAS
-- (sql/saas_platform/85_ecodem_children.sql). No tenant_id anywhere --
-- Main is single-tenant.

create table public.ecodem_children (
  id uuid primary key default gen_random_uuid(),
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

alter table public.ecodem_children enable row level security;

create policy "ecodem members read children" on public.ecodem_children
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'ecodem')));

create policy "ecodem admins manage children" on public.ecodem_children
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'ecodem')))
  with check (public.can_write_department((select id from public.departments where key = 'ecodem')));

create table public.ecodem_session_registrations (
  session_id uuid not null references public.ecodem_sessions(id) on delete cascade,
  child_id uuid not null references public.ecodem_children(id) on delete cascade,
  registered_at timestamptz not null default now(),
  primary key (session_id, child_id)
);

alter table public.ecodem_session_registrations enable row level security;

create policy "ecodem members read registrations" on public.ecodem_session_registrations
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'ecodem')));

create policy "ecodem admins manage registrations" on public.ecodem_session_registrations
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'ecodem')))
  with check (public.can_write_department((select id from public.departments where key = 'ecodem')));

create table public.ecodem_parent_requests (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.ecodem_parent_requests enable row level security;

create policy "ecodem members read parent requests" on public.ecodem_parent_requests
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'ecodem')));

create policy "ecodem admins manage parent requests" on public.ecodem_parent_requests
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'ecodem')))
  with check (public.can_write_department((select id from public.departments where key = 'ecodem')));

create table public.ecodem_parent_acknowledgements (
  request_id uuid not null references public.ecodem_parent_requests(id) on delete cascade,
  child_id uuid not null references public.ecodem_children(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  acknowledged_by uuid references public.profiles(id) on delete set null,
  primary key (request_id, child_id)
);

alter table public.ecodem_parent_acknowledgements enable row level security;

create policy "ecodem members read acknowledgements" on public.ecodem_parent_acknowledgements
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'ecodem')));

create policy "ecodem admins manage acknowledgements" on public.ecodem_parent_acknowledgements
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'ecodem')))
  with check (public.can_write_department((select id from public.departments where key = 'ecodem')));

select pg_notify('pgrst', 'reload schema');
