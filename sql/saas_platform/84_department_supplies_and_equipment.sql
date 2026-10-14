-- Two small, ungated department tools (available on every plan, per
-- product decision):
--  1. Cleaning: supplies/stock tracking, so volunteers can see what a
--     task needs before they arrive and leaders see low stock.
--  2. Media & Tech: equipment inventory (cameras/mics/cables/
--     projectors), storage location, condition, and who's currently
--     borrowed what.
-- Both reuse the exact RLS idiom already proven on ecodem_sessions:
-- can_read_department / can_write_department((select id from
-- departments where key = '<dept>')) -- visible to that department's
-- approved members, hidden from the rest of the church.

begin;

create table if not exists public.department_supplies (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  tenant_id uuid not null,
  name text not null,
  task_label text,
  unit text,
  quantity_on_hand numeric not null default 0,
  low_stock_threshold numeric not null default 0,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.department_supplies alter column tenant_id set default public.current_tenant_id();
create index if not exists department_supplies_department_id_idx on public.department_supplies (department_id);
create index if not exists department_supplies_tenant_id_idx on public.department_supplies (tenant_id);

alter table public.department_supplies enable row level security;

drop policy if exists "tenant_isolation" on public.department_supplies;
create policy "tenant_isolation" on public.department_supplies as restrictive for all
  using (tenant_id = current_tenant_id());

drop policy if exists "cleaning members read supplies" on public.department_supplies;
create policy "cleaning members read supplies" on public.department_supplies
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'cleaning')));

drop policy if exists "cleaning admins manage supplies" on public.department_supplies;
create policy "cleaning admins manage supplies" on public.department_supplies
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'cleaning')))
  with check (public.can_write_department((select id from public.departments where key = 'cleaning')));

create table if not exists public.equipment_items (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  tenant_id uuid not null,
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
alter table public.equipment_items alter column tenant_id set default public.current_tenant_id();
create index if not exists equipment_items_department_id_idx on public.equipment_items (department_id);
create index if not exists equipment_items_tenant_id_idx on public.equipment_items (tenant_id);

alter table public.equipment_items enable row level security;

drop policy if exists "tenant_isolation" on public.equipment_items;
create policy "tenant_isolation" on public.equipment_items as restrictive for all
  using (tenant_id = current_tenant_id());

drop policy if exists "media tech members read equipment" on public.equipment_items;
create policy "media tech members read equipment" on public.equipment_items
  for select to authenticated using (public.can_read_department((select id from public.departments where key = 'media_tech')));

drop policy if exists "media tech admins manage equipment" on public.equipment_items;
create policy "media tech admins manage equipment" on public.equipment_items
  for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'media_tech')))
  with check (public.can_write_department((select id from public.departments where key = 'media_tech')));

commit;

select pg_notify('pgrst', 'reload schema');
