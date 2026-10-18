-- Lets a guest visitor check themselves in directly, no account
-- needed -- scanning a Welcoming & Socialisation member's displayed
-- QR code (js/components/guestCheckinQrModal.js) opens
-- guest-checkin.html?d=<today> (js/publicGuestCheckin.js), which
-- calls this RPC. Main is single-tenant -- no tenant slug/lookup
-- needed the way SAAS's version (sql/saas_platform/92) needs it.
--
-- service_date is always current_date, hardcoded server-side --
-- nothing the client sends ever controls it, so a stale/reused QR
-- link can never backdate a record even if someone bypasses the
-- public page's own "this code has expired" client-side check.
--
-- Inserting a guest row here fires the exact same
-- notify_guest_attendance() trigger (sql/038/041/042) a staff-entered
-- guest already triggers -- auto-creates a pastoral-care lead,
-- auto-assigned to Welcoming & Socialisation. Unlike SAAS, Main's
-- version of that trigger has no tenant_id column to worry about, so
-- no fix needed there.

create or replace function public.submit_guest_checkin(
  p_guest_name text,
  p_service_type text,
  p_guest_phone text default null,
  p_guest_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_record_id uuid;
begin
  if coalesce(trim(p_guest_name), '') = '' then
    raise exception 'Name is required';
  end if;
  if p_service_type not in ('sunday_service', 'midweek_service', 'special_service') then
    raise exception 'Invalid service type';
  end if;

  insert into public.attendance_records (service_date, service_type, guest_name, guest_phone, guest_email)
  values (current_date, p_service_type::service_type, trim(p_guest_name), nullif(trim(p_guest_phone), ''), nullif(trim(p_guest_email), ''))
  returning id into v_record_id;

  return jsonb_build_object('id', v_record_id);
end;
$$;

revoke all on function public.submit_guest_checkin(text, text, text, text) from public;
grant execute on function public.submit_guest_checkin(text, text, text, text) to anon, authenticated;
