-- Automates Church Offering Registration's quarterly PDF + 5-year
-- retention email (see the offering-reports Edge Function). Two daily
-- pg_cron jobs:
--   1. close_offering_quarters() -- on the 1st of Jan/Apr/Jul/Oct,
--      closes every tenant's just-ended quarter (tags its offerings
--      with a new offering_report_periods row) and asks the Edge
--      Function to render + store that period's PDF.
--   2. send_offering_retention_emails() -- every day, finds any
--      closed period whose end date is >= 5 years ago and hasn't been
--      emailed yet, and asks the Edge Function to email the tenant's
--      Super Admin the PDF, then purge that period's offering rows.
--
-- Both cron functions call the Edge Function via pg_net (fire-and-
-- forget -- the function does its own DB writes once done), protected
-- by a shared secret stored in Supabase Vault rather than the actual
-- service-role key, since the only thing being authenticated here is
-- "this request came from OUR pg_cron," not a specific user.
--
-- IMPORTANT -- two things this migration does NOT do, because they
-- can't be done from SQL: (1) deploy the actual Edge Function (run
-- `supabase functions deploy offering-reports --no-verify-jwt` from
-- this repo), and (2) set that function's CRON_SECRET secret to the
-- exact value stored in this project's Vault below (you were given
-- that value separately when this migration was applied -- it is
-- deliberately NOT in this file).

create extension if not exists pg_net with schema extensions;

-- Storage bucket for generated PDFs. Private -- the client only ever
-- reads it via a signed URL (offeringsBoard.js) or it's served as an
-- email attachment; never listed/downloaded directly.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('offering-reports', 'offering-reports', false, null, array['application/pdf'])
on conflict (id) do nothing;

drop policy if exists "offering report pdfs are managed by finance team" on storage."objects";
create policy "offering report pdfs are managed by finance team" on storage."objects"
  for all to authenticated
  using (bucket_id = 'offering-reports' and can_manage_finance())
  with check (bucket_id = 'offering-reports' and can_manage_finance());

CREATE OR REPLACE FUNCTION public.close_offering_quarters()
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
  -- Only acts on the 1st of a new calendar quarter -- runs daily, but
  -- is a no-op every other day.
  if extract(day from current_date) != 1 or extract(month from current_date)::int not in (1, 4, 7, 10) then
    return;
  end if;

  v_period_end := current_date - interval '1 day';
  v_period_start := date_trunc('quarter', v_period_end)::date;

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

CREATE OR REPLACE FUNCTION public.send_offering_retention_emails()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_period record;
  v_secret text;
  v_base_url text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'offering_cron_secret';
  v_base_url := 'https://towlqbxvhftzjfrtepsy.supabase.co/functions/v1/offering-reports';

  for v_period in
    select id from public.offering_report_periods
    where status = 'closed'
      and pdf_storage_path is not null
      and retention_emailed_at is null
      and period_end <= (current_date - interval '5 years')
  loop
    perform net.http_post(
      url := v_base_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('action', 'send_retention_email', 'period_id', v_period.id)
    );
  end loop;
end;
$function$
;

do $$ begin perform cron.unschedule('close-offering-quarters'); exception when others then null; end $$;
select cron.schedule('close-offering-quarters', '0 5 * * *', 'select public.close_offering_quarters();');

do $$ begin perform cron.unschedule('send-offering-retention-emails'); exception when others then null; end $$;
select cron.schedule('send-offering-retention-emails', '30 5 * * *', 'select public.send_offering_retention_emails();');

select pg_notify('pgrst', 'reload schema');
