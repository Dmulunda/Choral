-- Church Offering Registration -- a Finance-only ledger of individual
-- offerings (name, date, amount, type), rolled into a quarterly PDF
-- report automatically every 3 months, retained for 5 years, then
-- emailed to the church's admin as an attachment and purged. See
-- 55_offering_report_automation.sql for the PDF/cron/email half --
-- this file is just the data model + the day-to-day recording.

create table if not exists public.offerings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  donor_name text not null,
  offering_date date not null,
  amount_cents integer not null check (amount_cents > 0),
  offering_type text not null check (offering_type in ('tithe', 'general', 'sacrifice', 'construction', 'other')),
  recorded_by uuid not null references public.profiles(id) on delete restrict,
  report_period_id uuid, -- FK added below, after offering_report_periods exists
  created_at timestamptz not null default now()
);

create table if not exists public.offering_report_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  pdf_storage_path text,
  status text not null default 'open' check (status in ('open', 'closed')),
  generated_at timestamptz,
  retention_emailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, period_start, period_end)
);

alter table public.offerings add constraint offerings_report_period_id_fkey
  foreign key (report_period_id) references public.offering_report_periods(id) on delete set null;

create index if not exists offerings_tenant_id_idx on public.offerings (tenant_id);
create index if not exists offerings_tenant_date_idx on public.offerings (tenant_id, offering_date);
create index if not exists offerings_report_period_id_idx on public.offerings (report_period_id);
create index if not exists offering_report_periods_tenant_id_idx on public.offering_report_periods (tenant_id);

alter table public.offerings enable row level security;
alter table public.offering_report_periods enable row level security;

-- "only the finance team" -- can_manage_finance() is the established
-- function every other finance feature (budget_requests) already uses:
-- Super Admin/Pastor Admin/Church Secretary, or a real admin/secretary
-- of the Finance department specifically.
drop policy if exists "finance team can record offerings" on public.offerings;
create policy "finance team can record offerings" on public.offerings
  for insert to authenticated with check (recorded_by = auth.uid() and public.can_manage_finance());

drop policy if exists "finance team can read offerings" on public.offerings;
create policy "finance team can read offerings" on public.offerings
  for select to authenticated using (public.can_manage_finance());

-- Same "creator or Super Admin" pattern as church_bookings (sql/050) --
-- a financial record shouldn't be editable/removable by just any
-- other Finance team member, only whoever actually recorded it, with
-- the Super Admin override every admin-scoped delete in this app has.
drop policy if exists "recorder or super admin can update an offering" on public.offerings;
create policy "recorder or super admin can update an offering" on public.offerings
  for update to authenticated using ((recorded_by = auth.uid() or is_super_admin()) and public.can_manage_finance())
  with check ((recorded_by = auth.uid() or is_super_admin()) and public.can_manage_finance());

drop policy if exists "recorder or super admin can delete an offering" on public.offerings;
create policy "recorder or super admin can delete an offering" on public.offerings
  for delete to authenticated using ((recorded_by = auth.uid() or is_super_admin()) and public.can_manage_finance());

drop policy if exists "tenant_isolation" on public.offerings;
create policy "tenant_isolation" on public.offerings as restrictive for all
  using (tenant_id = current_tenant_id());

-- offering_report_periods is system-managed (the quarterly rollover
-- function below, SECURITY DEFINER, bypasses RLS) -- no insert/update/
-- delete policy at all means no one can write to it directly, only read.
drop policy if exists "finance team can read report periods" on public.offering_report_periods;
create policy "finance team can read report periods" on public.offering_report_periods
  for select to authenticated using (public.can_manage_finance());

drop policy if exists "tenant_isolation" on public.offering_report_periods;
create policy "tenant_isolation" on public.offering_report_periods as restrictive for all
  using (tenant_id = current_tenant_id());

select pg_notify('pgrst', 'reload schema');
