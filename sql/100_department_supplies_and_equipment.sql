-- Main's version of the same feature as SAAS
-- (sql/saas_platform/84_department_supplies_and_equipment.sql). No
-- tenant_id anywhere -- Main is single-tenant.
-- 1. Cleaning: supplies/stock tracking.
-- 2. Media & Tech: equipment inventory + borrow/return.

create table public.department_supplies (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  task_label text,
  unit text,
  quantity_on_hand numeric not null default 0,
  low_stock_threshold numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index department_supplies_department_id_idx on public.department_supplies (department_id);

alter table public.department_supplies enable row level security;

create policy "cleaning members read supplies" on public.department_supplies
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'cleaning')));

create policy "cleaning admins manage supplies" on public.department_supplies
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'cleaning')))
  with check (public.can_write_department((select id from public.departments where key = 'cleaning')));

create table public.equipment_items (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  name text not null,
  category text,
  storage_location text,
  condition text not null default 'working' check (condition in ('working', 'needs_repair', 'missing')),
  borrowed_by uuid references public.profiles(id) on delete set null,
  borrowed_at timestamptz,
  due_back_at date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index equipment_items_department_id_idx on public.equipment_items (department_id);

alter table public.equipment_items enable row level security;

create policy "media tech members read equipment" on public.equipment_items
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'media_tech')));

create policy "media tech admins manage equipment" on public.equipment_items
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'media_tech')))
  with check (public.can_write_department((select id from public.departments where key = 'media_tech')));

select pg_notify('pgrst', 'reload schema');
