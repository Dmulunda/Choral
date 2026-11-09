-- Pastor Meetings: four small extensions requested together --
-- (1) a church-wide "booking confirmation note" every booker sees
--     right after they book (and guests get in their email),
-- (2) the church's own address (church_branding.address, already
--     editable via churchLogoModal.js -- no new field needed) shown
--     whenever the booked slot is in-person rather than online,
-- (3) the pause-all-availability message becomes bilingual
--     (message_en/message_fr, replacing the single message column),
-- (4) the confirmation the booker sees/receives gets the church name
--     as its title, not just "Meeting booked!".
--
-- submit_pastor_meeting_booking()'s and get_pastor_pause_notices()'s
-- own RETURNS TABLE shape is changing, which Postgres doesn't allow
-- via a plain CREATE OR REPLACE -- both are dropped and recreated,
-- with their exact prior anon+authenticated grants restored
-- explicitly below (confirmed live via pg_proc/aclexplode before
-- writing this migration).
begin;

alter table public.pastor_meeting_settings add column if not exists booking_note_en text;
alter table public.pastor_meeting_settings add column if not exists booking_note_fr text;

alter table public.pastor_meeting_pause add column if not exists message_en text;
alter table public.pastor_meeting_pause add column if not exists message_fr text;
update public.pastor_meeting_pause set message_en = message where message_en is null and message is not null;
alter table public.pastor_meeting_pause drop column if exists message;

drop function if exists public.get_pastor_pause_notices();
create function public.get_pastor_pause_notices()
returns table(pastor_name text, message_en text, message_fr text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.full_name, pp.message_en, pp.message_fr
  from public.pastor_meeting_pause pp
  join public.profiles p on p.id = pp.pastor_id
  where pp.paused and public.is_pastor_meeting_host(pp.pastor_id);
$$;
revoke all on function public.get_pastor_pause_notices() from public;
grant execute on function public.get_pastor_pause_notices() to anon, authenticated;

drop function if exists public.submit_pastor_meeting_booking(date, time, time, text, text, text, uuid, text, text);
create function public.submit_pastor_meeting_booking(
  p_date date, p_start_time time, p_end_time time, p_location_type text,
  p_contact_name text, p_contact_phone text, p_pastor_id uuid default null,
  p_note text default null, p_guest_email text default null
)
returns table(
  booking_id uuid, pastor_name text, meeting_room text, meeting_link text,
  meeting_date date, meeting_start_time time, meeting_end_time time,
  booking_note_en text, booking_note_fr text, office_address text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_slot_id uuid;
  v_pastor_id uuid;
  v_pastor_name text;
  v_booking_id uuid;
  v_meeting_room text;
  v_meeting_link text;
  v_notice_hours int;
  v_max_lead_days int;
  v_online_link text;
  v_booking_note_en text;
  v_booking_note_fr text;
  v_office_address text;
begin
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_phone), '') = '' then
    raise exception 'Name and phone number are required to book a meeting';
  end if;
  if v_caller is null and coalesce(trim(p_guest_email), '') = '' then
    raise exception 'Email is required to book without an account';
  end if;

  if p_pastor_id is not null and exists (
    select 1 from public.pastor_meeting_pause pp where pp.pastor_id = p_pastor_id and pp.paused
  ) then
    raise exception 'This pastor is not currently taking bookings -- please check back later.';
  end if;

  -- Table-qualified: pastor_meeting_settings.booking_note_en/_fr share a
  -- name with this function's own OUT parameters (RETURNS TABLE), which
  -- Postgres turns into implicit PL/pgSQL variables -- an unqualified
  -- reference is ambiguous between the two and fails to compile.
  select s.min_booking_notice_hours, s.max_booking_lead_days, s.online_meeting_link, s.booking_note_en, s.booking_note_fr
  into v_notice_hours, v_max_lead_days, v_online_link, v_booking_note_en, v_booking_note_fr
  from public.pastor_meeting_settings s where s.id = true;
  if (p_date + p_start_time) < now() + make_interval(hours => coalesce(v_notice_hours, 24)) then
    raise exception 'This slot no longer meets the minimum booking notice -- please pick a later time.';
  end if;
  if coalesce(v_max_lead_days, 0) > 0 and (p_date + p_start_time) > now() + make_interval(days => v_max_lead_days) then
    raise exception 'This slot is too far in the future to book yet -- please check back closer to that date.';
  end if;

  if p_location_type = 'office' then
    select address into v_office_address from public.church_branding where id = true;
  end if;

  select pa.id, pa.pastor_id into v_slot_id, v_pastor_id
  from public.pastor_availability pa
  where pa.date = p_date
    and pa.start_time = p_start_time
    and pa.end_time = p_end_time
    and pa.location_type = p_location_type
    and (p_pastor_id is null or pa.pastor_id = p_pastor_id)
    and not exists (
      select 1 from public.pastor_meeting_requests r
      where r.availability_id = pa.id and r.status <> 'cancelled'
    )
    and not exists (
      select 1 from public.pastor_meeting_pause pp
      where pp.pastor_id = pa.pastor_id and pp.paused
    )
  order by random()
  limit 1
  for update of pa skip locked;

  if v_slot_id is null then
    raise exception 'That slot was just booked by someone else -- please pick another.';
  end if;

  select full_name into v_pastor_name from public.profiles where id = v_pastor_id;

  if p_location_type = 'online' and coalesce(trim(v_online_link), '') <> '' then
    v_meeting_link := v_online_link;
  end if;

  insert into public.pastor_meeting_requests (
    user_id, pastor_id, availability_id, meeting_type, status, note,
    contact_name, contact_phone, guest_email, confirmed_at,
    meeting_date, meeting_start_time, meeting_end_time, meeting_link
  ) values (
    v_caller, v_pastor_id, v_slot_id, p_location_type, 'confirmed', p_note,
    trim(p_contact_name), trim(p_contact_phone), nullif(trim(p_guest_email), ''), now(),
    p_date, p_start_time, p_end_time, v_meeting_link
  )
  returning id into v_booking_id;

  if p_location_type = 'online' and v_meeting_link is null then
    v_meeting_room := 'pastor-meeting-' || v_booking_id;
    update public.pastor_meeting_requests set meeting_room = v_meeting_room where id = v_booking_id;
  end if;

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  values (
    v_pastor_id,
    'pastor_meeting_booked',
    'New meeting booked',
    trim(p_contact_name) || ' booked a meeting with you on ' || to_char(p_date, 'FMMonth DD, YYYY') || ' at ' || to_char(p_start_time, 'FMHH12:MI AM') || '.',
    v_caller
  );

  return query select v_booking_id, v_pastor_name, v_meeting_room, v_meeting_link, p_date, p_start_time, p_end_time,
    v_booking_note_en, v_booking_note_fr, v_office_address;
end;
$function$;
revoke all on function public.submit_pastor_meeting_booking(date, time, time, text, text, text, uuid, text, text) from public;
grant execute on function public.submit_pastor_meeting_booking(date, time, time, text, text, text, uuid, text, text) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');

commit;
