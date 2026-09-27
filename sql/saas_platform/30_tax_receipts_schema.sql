-- Tax Receipts (Impôts): donation tracking + official year-end
-- receipts. Finance enters the church's tax-receipt info once
-- (tax_receipt_settings, a true one-row-per-tenant singleton, same
-- shape as app_theme), periodically imports a donations spreadsheet
-- (donation_entries, one row per line item -- batches tracked
-- separately for audit via donation_import_batches), and once ready
-- "finalizes" a fiscal year (tax_receipt_years) via
-- finalize_tax_receipt_year() in 31_tax_receipts_rpcs.sql, which
-- issues one immutable tax_receipts row per member covering that
-- whole year. Members can see their running total any time, but a
-- formal receipt only exists once a tax_receipts row has been issued.

begin;

alter table public.profiles add column if not exists legal_name text;

-- 1. Church's tax-receipt info, one row per tenant.
create table public.tax_receipt_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade default public.current_tenant_id(),
  legal_name text,
  address text,
  charity_registration_number text,
  signing_authority_name text,
  signing_authority_title text,
  signature_data text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.tax_receipt_settings enable row level security;

create policy "finance manage tax receipt settings" on public.tax_receipt_settings
  for all using (public.can_manage_finance())
  with check (public.can_manage_finance());

create policy tenant_isolation on public.tax_receipt_settings
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- 2. Audit trail: one row per spreadsheet upload.
create table public.donation_import_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  filename text,
  row_count int not null default 0,
  matched_count int not null default 0,
  unmatched_count int not null default 0
);

create index donation_import_batches_tenant_id_idx on public.donation_import_batches(tenant_id);

alter table public.donation_import_batches enable row level security;

create policy "finance manage donation import batches" on public.donation_import_batches
  for all using (public.can_manage_finance())
  with check (public.can_manage_finance());

create policy tenant_isolation on public.donation_import_batches
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- 3. One row per spreadsheet line item. fiscal_year is generated from
-- the donation's own date, never from when it was uploaded -- Finance
-- can add late entries for a past year and they still land correctly.
-- member_id stays nullable: a row Finance couldn't match to any
-- profile is kept for the record but never counts toward anyone's
-- total (every query that sums donations filters member_id is not null).
create table public.donation_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  batch_id uuid references public.donation_import_batches(id) on delete set null,
  member_id uuid references public.profiles(id) on delete set null,
  raw_name text not null,
  donation_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  fiscal_year int generated always as (extract(year from donation_date)::int) stored,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

create index donation_entries_tenant_id_idx on public.donation_entries(tenant_id);
create index donation_entries_member_fiscal_year_idx on public.donation_entries(member_id, fiscal_year);

alter table public.donation_entries enable row level security;

create policy "finance manage donation entries" on public.donation_entries
  for all using (public.can_manage_finance())
  with check (public.can_manage_finance());

create policy "members read their own donation entries" on public.donation_entries
  for select using (member_id = auth.uid());

create policy tenant_isolation on public.donation_entries
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- 4. One row per tenant per fiscal year -- tracks whether that year's
-- receipts have been issued yet. Readable by everyone (still narrowed
-- to the caller's own tenant by tenant_isolation below) so a member's
-- Tax tab can show "not finalized yet" vs. a download button.
create table public.tax_receipt_years (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  fiscal_year int not null,
  status text not null default 'open' check (status in ('open', 'finalized')),
  finalized_by uuid references public.profiles(id),
  finalized_at timestamptz,
  unique (tenant_id, fiscal_year)
);

alter table public.tax_receipt_years enable row level security;

create policy "finance manage tax receipt years" on public.tax_receipt_years
  for all using (public.can_manage_finance())
  with check (public.can_manage_finance());

create policy "everyone can see tax receipt year status" on public.tax_receipt_years
  for select using (true);

create policy tenant_isolation on public.tax_receipt_years
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- 5. The actual issued, immutable receipts -- one per member per
-- fiscal year, created only by finalize_tax_receipt_year(). Snapshots
-- both the member's legal name and the church's tax settings at issue
-- time, so a receipt never silently changes later even if either one
-- is edited afterward -- this is a document someone files with the CRA.
create table public.tax_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  member_id uuid not null references public.profiles(id),
  fiscal_year int not null,
  receipt_number text not null,
  legal_name_snapshot text not null,
  total_amount numeric(12,2) not null,
  tenant_info_snapshot jsonb not null,
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles(id),
  unique (tenant_id, member_id, fiscal_year)
);

create index tax_receipts_tenant_fiscal_year_idx on public.tax_receipts(tenant_id, fiscal_year);

alter table public.tax_receipts enable row level security;

create policy "finance manage tax receipts" on public.tax_receipts
  for all using (public.can_manage_finance())
  with check (public.can_manage_finance());

create policy "members read their own tax receipts" on public.tax_receipts
  for select using (member_id = auth.uid());

create policy tenant_isolation on public.tax_receipts
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

commit;
