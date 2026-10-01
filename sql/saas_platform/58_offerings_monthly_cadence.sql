-- Switches the automatic report cycle from quarterly to monthly (like
-- a bank statement) -- replaces sql/055's close_offering_quarters()
-- with a monthly equivalent. Same mechanism otherwise: runs daily,
-- only acts on the 1st of the month, closes the month that just
-- ended, tags its offerings, fires the Edge Function to render the
-- PDF. The 5-year retention check (send_offering_retention_emails(),
-- unchanged) now just evaluates against ~12 periods/year instead of 4.

CREATE OR REPLACE FUNCTION public.close_offering_month()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant record;
  v_period_start date;
  v_period_end date;
  v_period_id uuid;
  v_secret text;
  v_base_url text;
begin
  -- Only acts on the 1st of a new month -- runs daily, no-op every
  -- other day.
  if extract(day from current_date) != 1 then
    return;
  end if;

  v_period_end := current_date - interval '1 day';
  v_period_start := date_trunc('month', v_period_end)::date;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'offering_cron_secret';
  v_base_url := 'https://towlqbxvhftzjfrtepsy.supabase.co/functions/v1/offering-reports';

  for v_tenant in select id from public.tenants loop
    if exists (
      select 1 from public.offerings
      where tenant_id = v_tenant.id and report_period_id is null
        and offering_date between v_period_start and v_period_end
    ) then
      insert into public.offering_report_periods (tenant_id, period_start, period_end, status)
      values (v_tenant.id, v_period_start, v_period_end, 'open')
      on conflict (tenant_id, period_start, period_end) do update set status = excluded.status
      returning id into v_period_id;

      update public.offerings
      set report_period_id = v_period_id
      where tenant_id = v_tenant.id and report_period_id is null
        and offering_date between v_period_start and v_period_end;

      perform net.http_post(
        url := v_base_url,
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
        body := jsonb_build_object('action', 'generate_quarter', 'period_id', v_period_id)
      );
    end if;
  end loop;
end;
$function$
;

do $$ begin perform cron.unschedule('close-offering-quarters'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('close-offering-month'); exception when others then null; end $$;
select cron.schedule('close-offering-month', '0 5 * * *', 'select public.close_offering_month();');

select pg_notify('pgrst', 'reload schema');
