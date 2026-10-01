-- Support for importing historical offering records (Excel/CSV/PDF,
-- js/components/offeringsImport.js): a row dated in the current open
-- month is inserted exactly like a normal manual entry (report_period_id
-- left null, swept into a PDF by next month's cron as usual). A row
-- dated in a past month needs its own (closed) report period so it
-- doesn't pollute "this month's" running ledger -- this RPC gets or
-- creates that period row (SECURITY DEFINER, since offering_report_periods
-- has no insert policy for anyone else, by design -- see 054).
-- offeringsImport.js then calls the offering-reports Edge Function's
-- new generate_for_period action once per distinct past period touched,
-- so an imported historical month still gets a real PDF, same as any
-- other closed month.
CREATE OR REPLACE FUNCTION public.get_or_create_offering_period(p_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_period_start date := date_trunc('month', p_date)::date;
  v_period_end date := (date_trunc('month', p_date) + interval '1 month - 1 day')::date;
  v_tenant uuid := current_tenant_id();
  v_id uuid;
begin
  if not can_manage_finance() then
    raise exception 'Only the Finance team can import offerings';
  end if;

  insert into public.offering_report_periods (tenant_id, period_start, period_end, status)
  values (v_tenant, v_period_start, v_period_end, 'closed')
  on conflict (tenant_id, period_start, period_end) do update set status = offering_report_periods.status
  returning id into v_id;

  return v_id;
end;
$function$
;

grant execute on function public.get_or_create_offering_period(date) to authenticated;

select pg_notify('pgrst', 'reload schema');
