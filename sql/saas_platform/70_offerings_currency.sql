-- Offering currency: USD/CAD/EUR/other (with a required free-text
-- specify field for other) -- exact same shape as payment_method/
-- payment_method_other (sql/57) and the removed_reason required-check
-- (sql/66). Propagated through to donation_entries and tax_receipts
-- so a year-end receipt is always exactly one currency: totals that
-- span more than one currency get a SEPARATE row/line per currency,
-- never blended into one converted number (no exchange rates to
-- invent or keep current, and a legal tax document stays exact).

begin;

-- ---- offerings ----
alter table public.offerings add column if not exists currency text
  not null default 'CAD' check (currency in ('USD', 'CAD', 'EUR', 'other'));
alter table public.offerings add column if not exists currency_other text;
alter table public.offerings drop constraint if exists offerings_currency_other_required_check;
alter table public.offerings add constraint offerings_currency_other_required_check
  check (currency <> 'other' or currency_other is not null);

-- ---- donation_entries: same currency, carried through by the sync
-- trigger below ----
alter table public.donation_entries add column if not exists currency text
  not null default 'CAD' check (currency in ('USD', 'CAD', 'EUR', 'other'));

-- Real pre-existing bug fixed here, found while testing the currency
-- change above: donation_entries_source_offering_id_key (sql/57) is a
-- PARTIAL unique index (`where source_offering_id is not null`), but
-- neither ON CONFLICT clause below ever specified a matching WHERE --
-- Postgres requires that to use a partial index as the arbiter at
-- all, so every single one of these inserts has always failed with
-- "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification" (confirmed via a minimal raw-SQL repro,
-- independent of this migration's other changes). In other words,
-- linking an offering to a member or guest donor has never actually
-- synced into donation_entries via this trigger. Fixed by adding the
-- matching predicate to both ON CONFLICT targets -- source_offering_id
-- is always NOT NULL at this call site anyway (always new.id), so
-- this changes nothing about *when* the branch runs, only makes the
-- arbiter resolvable.
CREATE OR REPLACE FUNCTION public.sync_offering_to_donation_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.member_id is not null then
    insert into public.donation_entries (tenant_id, member_id, raw_name, donation_date, amount, currency, created_by, source_offering_id)
    values (new.tenant_id, new.member_id, new.donor_name, new.offering_date, new.amount_cents / 100.0, new.currency, new.recorded_by, new.id)
    on conflict (source_offering_id) where source_offering_id is not null do update
      set member_id = excluded.member_id, guest_donor_id = null, raw_name = excluded.raw_name,
          donation_date = excluded.donation_date, amount = excluded.amount, currency = excluded.currency;
  elsif new.guest_donor_id is not null then
    insert into public.donation_entries (tenant_id, guest_donor_id, raw_name, donation_date, amount, currency, created_by, source_offering_id)
    values (new.tenant_id, new.guest_donor_id, new.donor_name, new.offering_date, new.amount_cents / 100.0, new.currency, new.recorded_by, new.id)
    on conflict (source_offering_id) where source_offering_id is not null do update
      set guest_donor_id = excluded.guest_donor_id, member_id = null, raw_name = excluded.raw_name,
          donation_date = excluded.donation_date, amount = excluded.amount, currency = excluded.currency;
  else
    delete from public.donation_entries where source_offering_id = new.id;
  end if;
  return new;
end;
$function$;

-- ---- tax_receipts: a receipt is always exactly one currency now --
-- the two existing partial unique indexes (sql/65) are replaced with
-- versions that also key on currency, so a person who gave in two
-- currencies in one year gets two receipts, not a collision.
alter table public.tax_receipts add column if not exists currency text
  not null default 'CAD' check (currency in ('USD', 'CAD', 'EUR', 'other'));

alter table public.tax_receipts drop constraint if exists tax_receipts_tenant_id_member_id_fiscal_year_key;
create unique index if not exists tax_receipts_member_fiscal_year_currency_key
  on public.tax_receipts (tenant_id, member_id, fiscal_year, currency) where member_id is not null;

drop index if exists tax_receipts_guest_fiscal_year_key;
create unique index if not exists tax_receipts_guest_fiscal_year_currency_key
  on public.tax_receipts (tenant_id, guest_donor_id, fiscal_year, currency) where guest_donor_id is not null;

-- ---- finalize_tax_receipt_year(): group by currency too, both for
-- members and guest donors. Return shape unchanged, so no DROP
-- FUNCTION needed this time (only sql/65's change to the RETURNS
-- TABLE shape required that).
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
    select de.member_id, de.currency, sum(de.amount) as total
    from public.donation_entries de
    where de.tenant_id = caller_tenant and de.fiscal_year = p_fiscal_year and de.member_id is not null
    group by de.member_id, de.currency
    having sum(de.amount) > 0
  ) totals
  join public.profiles p on p.id = totals.member_id
  where p.legal_name is null
    and not exists (
      select 1 from public.tax_receipts tr
      where tr.tenant_id = caller_tenant and tr.member_id = totals.member_id
        and tr.fiscal_year = p_fiscal_year and tr.currency = totals.currency
    );

  select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'full_name', g.name)), '[]'::jsonb)
    into v_skipped_guests
  from (
    select de.guest_donor_id, de.currency, sum(de.amount) as total
    from public.donation_entries de
    where de.tenant_id = caller_tenant and de.fiscal_year = p_fiscal_year and de.guest_donor_id is not null
    group by de.guest_donor_id, de.currency
    having sum(de.amount) > 0
  ) totals
  join public.guest_donors g on g.id = totals.guest_donor_id
  where g.email is null
    and not exists (
      select 1 from public.tax_receipts tr
      where tr.tenant_id = caller_tenant and tr.guest_donor_id = totals.guest_donor_id
        and tr.fiscal_year = p_fiscal_year and tr.currency = totals.currency
    );

  select coalesce(max(split_part(receipt_number, '-', 2)::int), 0)
    into v_next_seq
  from public.tax_receipts
  where tenant_id = caller_tenant and fiscal_year = p_fiscal_year;

  with totals as (
    select de.member_id, de.currency, sum(de.amount) as total_amount
    from public.donation_entries de
    where de.tenant_id = caller_tenant and de.fiscal_year = p_fiscal_year and de.member_id is not null
    group by de.member_id, de.currency
    having sum(de.amount) > 0
  ),
  eligible as (
    select t.member_id, t.currency, t.total_amount, p.legal_name,
      row_number() over (order by t.member_id, t.currency) as rn
    from totals t
    join public.profiles p on p.id = t.member_id
    where p.legal_name is not null
      and not exists (
        select 1 from public.tax_receipts tr
        where tr.tenant_id = caller_tenant and tr.member_id = t.member_id
          and tr.fiscal_year = p_fiscal_year and tr.currency = t.currency
      )
  )
  insert into public.tax_receipts (
    tenant_id, member_id, fiscal_year, receipt_number, legal_name_snapshot, total_amount, currency, tenant_info_snapshot, issued_by
  )
  select
    caller_tenant,
    e.member_id,
    p_fiscal_year,
    p_fiscal_year::text || '-' || lpad((v_next_seq + e.rn)::text, 4, '0'),
    e.legal_name,
    e.total_amount,
    e.currency,
    to_jsonb(v_settings),
    auth.uid()
  from eligible e;

  get diagnostics v_issued = row_count;

  select coalesce(max(split_part(receipt_number, '-', 2)::int), v_next_seq + v_issued)
    into v_next_seq
  from public.tax_receipts
  where tenant_id = caller_tenant and fiscal_year = p_fiscal_year;

  with totals as (
    select de.guest_donor_id, de.currency, sum(de.amount) as total_amount
    from public.donation_entries de
    where de.tenant_id = caller_tenant and de.fiscal_year = p_fiscal_year and de.guest_donor_id is not null
    group by de.guest_donor_id, de.currency
    having sum(de.amount) > 0
  ),
  eligible as (
    select t.guest_donor_id, t.currency, t.total_amount, g.name as legal_name,
      row_number() over (order by t.guest_donor_id, t.currency) as rn
    from totals t
    join public.guest_donors g on g.id = t.guest_donor_id
    where g.email is not null
      and not exists (
        select 1 from public.tax_receipts tr
        where tr.tenant_id = caller_tenant and tr.guest_donor_id = t.guest_donor_id
          and tr.fiscal_year = p_fiscal_year and tr.currency = t.currency
      )
  )
  insert into public.tax_receipts (
    tenant_id, guest_donor_id, fiscal_year, receipt_number, legal_name_snapshot, total_amount, currency, tenant_info_snapshot, issued_by
  )
  select
    caller_tenant,
    e.guest_donor_id,
    p_fiscal_year,
    p_fiscal_year::text || '-' || lpad((v_next_seq + e.rn)::text, 4, '0'),
    e.legal_name,
    e.total_amount,
    e.currency,
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

commit;

select pg_notify('pgrst', 'reload schema');
