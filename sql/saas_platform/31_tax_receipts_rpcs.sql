-- Tax Receipts RPCs. SECURITY DEFINER bypasses RLS entirely (including
-- the RESTRICTIVE tenant_isolation policy), so this explicitly scopes
-- every read/write to the caller's own tenant, not just can_manage_finance()
-- (which only proves the caller is *a* Finance admin somewhere).

begin;

-- Aggregates donation_entries by member for p_fiscal_year and issues
-- one tax_receipts row per member who has a positive total AND a
-- legal_name on file. Members with donations but no legal_name are
-- skipped and returned in the result rather than blocking the whole
-- year -- Finance can call this again later once they've filled it
-- in; already-issued members are never touched or duplicated (the
-- unique (tenant_id, member_id, fiscal_year) constraint on
-- tax_receipts is a second line of defense on top of the explicit
-- "not already issued" filter below). Receipt numbering continues
-- from the highest existing sequence for that tenant+year, so a
-- second run doesn't collide with or reuse numbers already issued.
create or replace function public.finalize_tax_receipt_year(p_fiscal_year int)
returns table(issued_count int, skipped_members jsonb)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller_tenant uuid;
  v_settings public.tax_receipt_settings;
  v_issued int;
  v_skipped jsonb;
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

  insert into public.tax_receipt_years (tenant_id, fiscal_year, status, finalized_by, finalized_at)
  values (caller_tenant, p_fiscal_year, 'finalized', auth.uid(), now())
  on conflict (tenant_id, fiscal_year) do update
    set status = 'finalized', finalized_by = excluded.finalized_by, finalized_at = excluded.finalized_at;

  return query select v_issued, v_skipped;
end;
$$;

revoke all on function public.finalize_tax_receipt_year(int) from public;
grant execute on function public.finalize_tax_receipt_year(int) to authenticated;

commit;
