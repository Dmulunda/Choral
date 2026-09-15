-- Multi-tenant port of Finance: Budget Management (main commit c948eeb).
-- Same table shape as main, plus tenant_id on both tables with the
-- standard Phase 1 pattern: a RESTRICTIVE tenant_isolation policy
-- layered on top of the same two app-level policies (write/read via
-- can_write_department/can_read_department) every other department
-- table in this project already uses -- confirmed live against
-- department_shifts' actual policy set before writing this.

begin;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  department_id uuid not null references public.departments(id),
  name text not null,
  initial_amount numeric(12,2) not null check (initial_amount >= 0),
  description text,
  status text not null default 'active' check (status in ('upcoming','active','closed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table public.budget_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  budget_id uuid not null references public.budgets(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  note text,
  receipt_path text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index budgets_department_id_idx on public.budgets(department_id);
create index budgets_tenant_id_idx on public.budgets(tenant_id);
create index budget_transactions_budget_id_idx on public.budget_transactions(budget_id);
create index budget_transactions_tenant_id_idx on public.budget_transactions(tenant_id);

alter table public.budgets enable row level security;
alter table public.budget_transactions enable row level security;

create policy "department admins manage budgets" on public.budgets
  for all using (public.can_write_department(department_id))
  with check (public.can_write_department(department_id));

create policy "budgets are readable by department members" on public.budgets
  for select using (public.can_read_department(department_id));

create policy tenant_isolation on public.budgets
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create policy "department admins manage budget transactions" on public.budget_transactions
  for all using (
    exists (select 1 from public.budgets b where b.id = budget_transactions.budget_id and public.can_write_department(b.department_id))
  )
  with check (
    exists (select 1 from public.budgets b where b.id = budget_transactions.budget_id and public.can_write_department(b.department_id))
  );

create policy "budget transactions are readable by department members" on public.budget_transactions
  for select using (
    exists (select 1 from public.budgets b where b.id = budget_transactions.budget_id and public.can_read_department(b.department_id))
  );

create policy tenant_isolation on public.budget_transactions
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- Private bucket, folder-scoped {department_id}/{budget_id}/{filename} --
-- same shape as main, no tenant_id path segment needed: confirmed live
-- that sandbox2's own uniform-photos bucket already relies on
-- can_write_department/can_read_department alone (department_id is
-- itself tenant-unique, and membership rows can't span tenants), no
-- tenant prefix in its path either.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('budget-receipts', 'budget-receipts', false, 10485760, array['image/png','image/jpeg','image/webp','application/pdf'])
on conflict (id) do nothing;

create policy "budget receipts are managed by department admins" on storage.objects
  for all
  using (bucket_id = 'budget-receipts' and public.can_write_department(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'budget-receipts' and public.can_write_department(((storage.foldername(name))[1])::uuid));

create policy "budget receipts are readable by department members" on storage.objects
  for select
  using (bucket_id = 'budget-receipts' and public.can_read_department(((storage.foldername(name))[1])::uuid));

commit;

select pg_notify('pgrst', 'reload schema');
