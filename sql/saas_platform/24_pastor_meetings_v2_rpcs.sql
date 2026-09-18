-- Enforces pastor_meeting_settings.min_booking_notice_hours (v2,
-- tenant-scoped) in both the listing and the booking RPC, on top of
-- the existing anon tenant-slug resolution.

begin;

create or replace function public.get_public_pastor_slots(p_tenant_slug text default null)
returns table (
  slot_key text,
  pastor_id uuid,
  pastor_name text,
  date date,
  start_time time,
  end_time time,
  location_type text
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant_id uuid;
  v_mode text;
  v_notice_hours int;
  v_cutoff timestamp;
begin
  if auth.uid() is not null then
    v_tenant_id := public.current_tenant_id();
  else
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      raise exception 'Church not found';
    end if;
  end if;

  select selection_mode, min_booking_notice_hours into v_mode, v_notice_hours
  from public.pastor_meeting_settings where tenant_id = v_tenant_id;
  v_cutoff := now() + make_interval(hours => coalesce(v_notice_hours, 24));

  if coalesce(v_mode, 'manual') = 'random' then
    return query
      select
        (pa.date::text || '|' || pa.start_time::text || '|' || pa.end_time::text || '|' || pa.location_type) as slot_key,
        null::uuid as pastor_id,
        null::text as pastor_name,
        pa.date, pa.start_time, pa.end_time, pa.location_type
      from public.pastor_availability pa
      where pa.tenant_id = v_tenant_id
        and pa.date >= current_date
        and (pa.date + pa.start_time) >= v_cutoff
        and not exists (
          select 1 from public.pastor_meeting_requests r
          where r.availability_id = pa.id and r.status <> 'cancelled'
        )
      group by pa.date, pa.start_time, pa.end_time, pa.location_type
      order by pa.date, pa.start_time;
  else
    return query
      select
        pa.id::text as slot_key,
        pa.pastor_id,
        p.full_name as pastor_name,
        pa.date, pa.start_time, pa.end_time, pa.location_type
      from public.pastor_availability pa
      join public.profiles p on p.id = pa.pastor_id
      where pa.tenant_id = v_tenant_id
        and pa.date >= current_date
        and (pa.date + pa.start_time) >= v_cutoff
        and not exists (
          select 1 from public.pastor_meeting_requests r
          where r.availability_id = pa.id and r.status <> 'cancelled'
        )
      order by pa.date, pa.start_time;
  end if;
end;
$$;


create or replace function public.submit_pastor_meeting_booking(
  p_date date,
  p_start_time time,
  p_end_time time,
  p_location_type text,
  p_pastor_id uuid default null,
  p_note text default null,
  p_guest_name text default null,
  p_guest_email text default null,
  p_guest_phone text default null,
  p_tenant_slug text default null
)
returns table (
  booking_id uuid,
  pastor_name text,
  meeting_room text
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_caller uuid := auth.uid();
  v_tenant_id uuid;
  v_slot_id uuid;
  v_pastor_id uuid;
  v_pastor_name text;
  v_booking_id uuid;
  v_meeting_room text;
  v_notice_hours int;
begin
  if v_caller is not null then
    v_tenant_id := public.current_tenant_id();
  else
    if coalesce(trim(p_guest_name), '') = '' or coalesce(trim(p_guest_email), '') = '' or coalesce(trim(p_guest_phone), '') = '' then
      raise exception 'Name, email, and phone are required to book without an account';
    end if;
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      raise exception 'Church not found';
    end if;
  end if;

  select min_booking_notice_hours into v_notice_hours from public.pastor_meeting_settings where tenant_id = v_tenant_id;
  if (p_date + p_start_time) < now() + make_interval(hours => coalesce(v_notice_hours, 24)) then
    raise exception 'This slot no longer meets the minimum booking notice -- please pick a later time.';
  end if;

  select pa.id, pa.pastor_id into v_slot_id, v_pastor_id
  from public.pastor_availability pa
  where pa.tenant_id = v_tenant_id
    and pa.date = p_date
    and pa.start_time = p_start_time
    and pa.end_time = p_end_time
    and pa.location_type = p_location_type
    and (p_pastor_id is null or pa.pastor_id = p_pastor_id)
    and not exists (
      select 1 from public.pastor_meeting_requests r
      where r.availability_id = pa.id and r.status <> 'cancelled'
    )
  order by random()
  limit 1
  for update of pa skip locked;

  if v_slot_id is null then
    raise exception 'That slot was just booked by someone else -- please pick another.';
  end if;

  select full_name into v_pastor_name from public.profiles where id = v_pastor_id;

  insert into public.pastor_meeting_requests (
    tenant_id, user_id, pastor_id, availability_id, meeting_type, status, note,
    guest_name, guest_email, guest_phone, confirmed_at
  ) values (
    v_tenant_id, v_caller, v_pastor_id, v_slot_id, p_location_type, 'confirmed', p_note,
    nullif(trim(p_guest_name), ''), nullif(trim(p_guest_email), ''), nullif(trim(p_guest_phone), ''), now()
  )
  returning id into v_booking_id;

  if p_location_type = 'online' then
    v_meeting_room := 'pastor-meeting-' || v_booking_id;
    update public.pastor_meeting_requests set meeting_room = v_meeting_room where id = v_booking_id;
  end if;

  insert into public.notifications (tenant_id, recipient_id, type, title, body, source_user_id)
  values (
    v_tenant_id,
    v_pastor_id,
    'pastor_meeting_booked',
    'New meeting booked',
    coalesce(nullif(trim(p_guest_name), ''), (select full_name from public.profiles where id = v_caller), 'Someone')
      || ' booked a meeting with you on ' || to_char(p_date, 'FMMonth DD, YYYY') || ' at ' || to_char(p_start_time, 'FMHH12:MI AM') || '.',
    v_caller
  );

  return query select v_booking_id, v_pastor_name, v_meeting_room;
end;
$$;

commit;

select pg_notify('pgrst', 'reload schema');
