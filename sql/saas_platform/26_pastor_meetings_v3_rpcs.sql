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
  v_max_lead_days int;
  v_cutoff timestamp;
  v_horizon timestamp;
begin
  if auth.uid() is not null then
    v_tenant_id := public.current_tenant_id();
  else
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      raise exception 'Church not found';
    end if;
  end if;

  select selection_mode, min_booking_notice_hours, max_booking_lead_days
  into v_mode, v_notice_hours, v_max_lead_days
  from public.pastor_meeting_settings where tenant_id = v_tenant_id;
  v_cutoff := now() + make_interval(hours => coalesce(v_notice_hours, 24));
  v_horizon := case when coalesce(v_max_lead_days, 0) > 0 then now() + make_interval(days => v_max_lead_days) else null end;

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
        and (v_horizon is null or (pa.date + pa.start_time) <= v_horizon)
        and not exists (
          select 1 from public.pastor_meeting_requests r
          where r.availability_id = pa.id and r.status <> 'cancelled'
        )
        and not exists (
          select 1 from public.pastor_meeting_pause pp
          where pp.pastor_id = pa.pastor_id and pp.paused
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
        and (v_horizon is null or (pa.date + pa.start_time) <= v_horizon)
        and not exists (
          select 1 from public.pastor_meeting_requests r
          where r.availability_id = pa.id and r.status <> 'cancelled'
        )
        and not exists (
          select 1 from public.pastor_meeting_pause pp
          where pp.pastor_id = pa.pastor_id and pp.paused
        )
      order by pa.date, pa.start_time;
  end if;
end;
$$;


create or replace function public.get_church_timezone(p_tenant_slug text default null)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant_id uuid;
  v_tz text;
begin
  if auth.uid() is not null then
    v_tenant_id := public.current_tenant_id();
  else
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      return 'America/Toronto';
    end if;
  end if;

  select church_timezone into v_tz from public.pastor_meeting_settings where tenant_id = v_tenant_id;
  return coalesce(v_tz, 'America/Toronto');
end;
$$;
revoke all on function public.get_church_timezone(text) from public;
grant execute on function public.get_church_timezone(text) to anon, authenticated;


create or replace function public.get_pastor_pause_notices(p_tenant_slug text default null)
returns table (pastor_name text, message text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant_id uuid;
begin
  if auth.uid() is not null then
    v_tenant_id := public.current_tenant_id();
  else
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      return;
    end if;
  end if;

  return query
    select p.full_name, pp.message
    from public.pastor_meeting_pause pp
    join public.profiles p on p.id = pp.pastor_id
    where pp.tenant_id = v_tenant_id and pp.paused and p.global_role = 'pastor_admin';
end;
$$;
revoke all on function public.get_pastor_pause_notices(text) from public;
grant execute on function public.get_pastor_pause_notices(text) to anon, authenticated;


drop function if exists public.submit_pastor_meeting_booking(date, time, time, text, uuid, text, text, text, text, text);

create or replace function public.submit_pastor_meeting_booking(
  p_date date,
  p_start_time time,
  p_end_time time,
  p_location_type text,
  p_contact_name text,
  p_contact_phone text,
  p_pastor_id uuid default null,
  p_note text default null,
  p_guest_email text default null,
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
  v_max_lead_days int;
begin
  if coalesce(trim(p_contact_name), '') = '' or coalesce(trim(p_contact_phone), '') = '' then
    raise exception 'Name and phone number are required to book a meeting';
  end if;

  if v_caller is not null then
    v_tenant_id := public.current_tenant_id();
  else
    if coalesce(trim(p_guest_email), '') = '' then
      raise exception 'Email is required to book without an account';
    end if;
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      raise exception 'Church not found';
    end if;
  end if;

  if p_pastor_id is not null and exists (
    select 1 from public.pastor_meeting_pause pp where pp.pastor_id = p_pastor_id and pp.tenant_id = v_tenant_id and pp.paused
  ) then
    raise exception 'This pastor is not currently taking bookings -- please check back later.';
  end if;

  select min_booking_notice_hours, max_booking_lead_days into v_notice_hours, v_max_lead_days
  from public.pastor_meeting_settings where tenant_id = v_tenant_id;
  if (p_date + p_start_time) < now() + make_interval(hours => coalesce(v_notice_hours, 24)) then
    raise exception 'This slot no longer meets the minimum booking notice -- please pick a later time.';
  end if;
  if coalesce(v_max_lead_days, 0) > 0 and (p_date + p_start_time) > now() + make_interval(days => v_max_lead_days) then
    raise exception 'This slot is too far in the future to book yet -- please check back closer to that date.';
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

  insert into public.pastor_meeting_requests (
    tenant_id, user_id, pastor_id, availability_id, meeting_type, status, note,
    contact_name, contact_phone, guest_email, confirmed_at
  ) values (
    v_tenant_id, v_caller, v_pastor_id, v_slot_id, p_location_type, 'confirmed', p_note,
    trim(p_contact_name), trim(p_contact_phone), nullif(trim(p_guest_email), ''), now()
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
    trim(p_contact_name) || ' booked a meeting with you on ' || to_char(p_date, 'FMMonth DD, YYYY') || ' at ' || to_char(p_start_time, 'FMHH12:MI AM') || '.',
    v_caller
  );

  return query select v_booking_id, v_pastor_name, v_meeting_room;
end;
$$;
revoke all on function public.submit_pastor_meeting_booking(date, time, time, text, text, text, uuid, text, text, text) from public;
grant execute on function public.submit_pastor_meeting_booking(date, time, time, text, text, text, uuid, text, text, text) to anon, authenticated;


create or replace function public.cancel_pastor_meeting_booking(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pastor_id uuid;
  v_user_id uuid;
  v_pastor_name text;
begin
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'A cancellation reason is required';
  end if;

  select pastor_id, user_id into v_pastor_id, v_user_id
  from public.pastor_meeting_requests
  where id = p_id and tenant_id = public.current_tenant_id();

  if v_pastor_id is null then
    raise exception 'Booking not found';
  end if;
  if not (v_pastor_id = auth.uid() or public.is_super_admin() or public.is_church_secretary()) then
    raise exception 'Not allowed to cancel this booking';
  end if;

  update public.pastor_meeting_requests
  set status = 'cancelled', cancellation_reason = trim(p_reason)
  where id = p_id;

  if v_user_id is not null then
    select full_name into v_pastor_name from public.profiles where id = v_pastor_id;
    insert into public.notifications (tenant_id, recipient_id, type, title, body, source_user_id)
    values (
      public.current_tenant_id(),
      v_user_id,
      'pastor_meeting_booked',
      'Meeting cancelled',
      'Your meeting with ' || coalesce(v_pastor_name, 'the pastor') || ' was cancelled: ' || trim(p_reason),
      auth.uid()
    );
  end if;
end;
$$;
revoke all on function public.cancel_pastor_meeting_booking(uuid, text) from public;
grant execute on function public.cancel_pastor_meeting_booking(uuid, text) to authenticated;

drop function if exists public.cancel_pastor_meeting_booking(uuid);

commit;

select pg_notify('pgrst', 'reload schema');
