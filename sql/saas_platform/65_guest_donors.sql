-- Guest Donors: a real church member who gives but has no app account
-- still needs to be able to get their annual tax receipt. Today an
-- offering with no member match never reaches donation_entries at all
-- (sync_offering_to_donation_entry(), sql/057, only mirrors member_id
-- matches) and tax_receipts.member_id is NOT NULL, so there was no way
-- to issue a receipt for someone without a real account. This adds a
-- lightweight, Finance-managed identity (name + email) that offerings,
-- donation_entries, and tax_receipts can all optionally point to
-- instead of a real member_id -- mutually exclusive with member_id
-- everywhere via a check constraint, same two-column shape throughout.

create table if not exists public.guest_donors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  name text not null,
  email text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists guest_donors_tenant_id_idx on public.guest_donors (tenant_id);

alter table public.guest_donors enable row level security;

drop policy if exists "finance manage guest donors" on public.guest_donors;
create policy "finance manage guest donors" on public.guest_donors
  for all to authenticated using (public.can_manage_finance()) with check (public.can_manage_finance());

drop policy if exists "tenant_isolation" on public.guest_donors;
create policy "tenant_isolation" on public.guest_donors as restrictive for all
  using (tenant_id = current_tenant_id());

-- ---- offerings: optional guest_donor_id alongside member_id ----
alter table public.offerings add column if not exists guest_donor_id uuid references public.guest_donors(id) on delete set null;
alter table public.offerings drop constraint if exists offerings_one_donor_identity_check;
alter table public.offerings add constraint offerings_one_donor_identity_check
  check (not (member_id is not null and guest_donor_id is not null));

-- ---- donation_entries: same optional guest_donor_id ----
alter table public.donation_entries add column if not exists guest_donor_id uuid references public.guest_donors(id) on delete set null;
alter table public.donation_entries drop constraint if exists donation_entries_one_donor_identity_check;
alter table public.donation_entries add constraint donation_entries_one_donor_identity_check
  check (not (member_id is not null and guest_donor_id is not null));

-- ---- tax_receipts: member_id becomes optional, guest_donor_id added,
-- exactly one of the two required ----
alter table public.tax_receipts alter column member_id drop not null;
alter table public.tax_receipts add column if not exists guest_donor_id uuid references public.guest_donors(id) on delete restrict;
alter table public.tax_receipts drop constraint if exists tax_receipts_exactly_one_donor_identity_check;
alter table public.tax_receipts add constraint tax_receipts_exactly_one_donor_identity_check
  check ((member_id is not null)::int + (guest_donor_id is not null)::int = 1);

create unique index if not exists tax_receipts_guest_fiscal_year_key
  on public.tax_receipts (tenant_id, guest_donor_id, fiscal_year) where guest_donor_id is not null;

-- ---- sync_offering_to_donation_entry(): three-way branch instead of
-- the old member_id-or-nothing check (sql/057's original) ----
CREATE OR REPLACE FUNCTION public.sync_offering_to_donation_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.member_id is not null then
    insert into public.donation_entries (tenant_id, member_id, raw_name, donation_date, amount, created_by, source_offering_id)
    values (new.tenant_id, new.member_id, new.donor_name, new.offering_date, new.amount_cents / 100.0, new.recorded_by, new.id)
    on conflict (source_offering_id) where source_offering_id is not null do update set
      member_id = excluded.member_id,
      guest_donor_id = null,
      raw_name = excluded.raw_name,
      donation_date = excluded.donation_date,
      amount = excluded.amount;
  elsif new.guest_donor_id is not null then
    insert into public.donation_entries (tenant_id, guest_donor_id, raw_name, donation_date, amount, created_by, source_offering_id)
    values (new.tenant_id, new.guest_donor_id, new.donor_name, new.offering_date, new.amount_cents / 100.0, new.recorded_by, new.id)
    on conflict (source_offering_id) where source_offering_id is not null do update set
      guest_donor_id = excluded.guest_donor_id,
      member_id = null,
      raw_name = excluded.raw_name,
      donation_date = excluded.donation_date,
      amount = excluded.amount;
  else
    delete from public.donation_entries where source_offering_id = new.id;
  end if;
  return new;
end;
$function$
;

-- ---- finalize_tax_receipt_year(): additive guest-donor aggregation
-- alongside the existing member one. Return shape changed (added
-- skipped_guests), so the old signature must be dropped first.
DROP FUNCTION IF EXISTS public.finalize_tax_receipt_year(int);
CREATE OR REPLACE FUNCTION public.finalize_tax_receipt_year(p_fiscal_year int)
RETURNS table(issued_count int, skipped_members jsonb, skipped_guests jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  caller_tenant uuid;
  v_settings public.tax_receipt_settings;
  v_issued int;
  v_issued_guests int;
  v_skipped jsonb;
  v_skipped_guests jsonb;
  v_next_seq int;
begin
  if not public.can_manage_finance() then
    raise exception 'Only Finance can finalize tax receipts';
  end if;
  caller_tenant := public.current_tenant_id();

  select * into v_settings from public.tax_receipt_settings where tenant_id = caller_tenant;
  if v_settings is null or v_settings.legal_name is null then
    raise exception 'Tax receipt settings have not been configured yet';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name)), '[]'::jsonb)
    into v_skipped
  from (
    select de.member_id, sum(de.amount) as total
    from public.donation_entries de
    where de.tenant_id = caller_tenant and de.fiscal_year = p_fiscal_year and de.member_id is not null
    group by de.member_id
    having sum(de.amount) > 0
  ) totals
  join public.profiles p on p.id = totals.member_id
  where p.legal_name is null
    and not exists (
      select 1 from public.tax_receipts tr
      where tr.tenant_id = caller_tenant and tr.member_id = totals.member_id and tr.fiscal_year = p_fiscal_year
    );

  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'full_name', g.name)), '[]'::jsonb)
    into v_skipped_guests
  from (
    select de.guest_donor_id, sum(de.amount) as total
    from public.donation_entries de
    where de.tenant_id = caller_tenant and de.fiscal_year = p_fiscal_year and de.guest_donor_id is not null
    group by de.guest_donor_id
    having sum(de.amount) > 0
  ) totals
  join public.guest_donors g on g.id = totals.guest_donor_id
  where g.email is null
    and not exists (
      select 1 from public.tax_receipts tr
      where tr.tenant_id = caller_tenant and tr.guest_donor_id = totals.guest_donor_id and tr.fiscal_year = p_fiscal_year
    );

  select coalesce(max(split_part(receipt_number, '-', 2)::int), 0)
    into v_next_seq
  from public.tax_receipts
  where tenant_id = caller_tenant and fiscal_year = p_fiscal_year;

  with totals as (
    select de.member_id, sum(de.amount) as total_amount
    from public.donation_entries de
    where de.tenant_id = caller_tenant and de.fiscal_year = p_fiscal_year and de.member_id is not null
    group by de.member_id
    having sum(de.amount) > 0
  ),
  eligible as (
    select t.member_id, t.total_amount, p.legal_name,
      row_number() over (order by t.member_id) as rn
    from totals t
    join public.profiles p on p.id = t.member_id
    where p.legal_name is not null
      and not exists (
        select 1 from public.tax_receipts tr
        where tr.tenant_id = caller_tenant and tr.member_id = t.member_id and tr.fiscal_year = p_fiscal_year
      )
  )
  insert into public.tax_receipts (
    tenant_id, member_id, fiscal_year, receipt_number, legal_name_snapshot, total_amount, tenant_info_snapshot, issued_by
  )
  select
    caller_tenant,
    e.member_id,
    p_fiscal_year,
    p_fiscal_year::text || '-' || lpad((v_next_seq + e.rn)::text, 4, '0'),
    e.legal_name,
    e.total_amount,
    to_jsonb(v_settings),
    auth.uid()
  from eligible e;

  get diagnostics v_issued = row_count;

  select coalesce(max(split_part(receipt_number, '-', 2)::int), v_next_seq + v_issued)
    into v_next_seq
  from public.tax_receipts
  where tenant_id = caller_tenant and fiscal_year = p_fiscal_year;

  with totals as (
    select de.guest_donor_id, sum(de.amount) as total_amount
    from public.donation_entries de
    where de.tenant_id = caller_tenant and de.fiscal_year = p_fiscal_year and de.guest_donor_id is not null
    group by de.guest_donor_id
    having sum(de.amount) > 0
  ),
  eligible as (
    select t.guest_donor_id, t.total_amount, g.name as legal_name,
      row_number() over (order by t.guest_donor_id) as rn
    from totals t
    join public.guest_donors g on g.id = t.guest_donor_id
    where g.email is not null
      and not exists (
        select 1 from public.tax_receipts tr
        where tr.tenant_id = caller_tenant and tr.guest_donor_id = t.guest_donor_id and tr.fiscal_year = p_fiscal_year
      )
  )
  insert into public.tax_receipts (
    tenant_id, guest_donor_id, fiscal_year, receipt_number, legal_name_snapshot, total_amount, tenant_info_snapshot, issued_by
  )
  select
    caller_tenant,
    e.guest_donor_id,
    p_fiscal_year,
    p_fiscal_year::text || '-' || lpad((v_next_seq + e.rn)::text, 4, '0'),
    e.legal_name,
    e.total_amount,
    to_jsonb(v_settings),
    auth.uid()
  from eligible e;

  get diagnostics v_issued_guests = row_count;

  insert into public.tax_receipt_years (tenant_id, fiscal_year, status, finalized_by, finalized_at)
  values (caller_tenant, p_fiscal_year, 'finalized', auth.uid(), now())
  on conflict (tenant_id, fiscal_year) do update
    set status = 'finalized', finalized_by = excluded.finalized_by, finalized_at = excluded.finalized_at;

  return query select (v_issued + v_issued_guests), v_skipped, v_skipped_guests;
end;
$$;

revoke all on function public.finalize_tax_receipt_year(int) from public;
grant execute on function public.finalize_tax_receipt_year(int) to authenticated;

select pg_notify('pgrst', 'reload schema');
