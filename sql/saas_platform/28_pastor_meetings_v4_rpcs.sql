begin;

drop function if exists public.submit_pastor_meeting_booking(date, time, time, text, text, text, uuid, text, text, text);

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
  meeting_room text,
  meeting_link text,
  meeting_date date,
  meeting_start_time time,
  meeting_end_time time
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
  v_meeting_link text;
  v_notice_hours int;
  v_max_lead_days int;
  v_online_link text;
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

  select min_booking_notice_hours, max_booking_lead_days, online_meeting_link
  into v_notice_hours, v_max_lead_days, v_online_link
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

  if p_location_type = 'online' and coalesce(trim(v_online_link), '') <> '' then
    v_meeting_link := v_online_link;
  end if;

  insert into public.pastor_meeting_requests (
    tenant_id, user_id, pastor_id, availability_id, meeting_type, status, note,
    contact_name, contact_phone, guest_email, confirmed_at,
    meeting_date, meeting_start_time, meeting_end_time, meeting_link
  ) values (
    v_tenant_id, v_caller, v_pastor_id, v_slot_id, p_location_type, 'confirmed', p_note,
    trim(p_contact_name), trim(p_contact_phone), nullif(trim(p_guest_email), ''), now(),
    p_date, p_start_time, p_end_time, v_meeting_link
  )
  returning id into v_booking_id;

  if p_location_type = 'online' and v_meeting_link is null then
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

  return query select v_booking_id, v_pastor_name, v_meeting_room, v_meeting_link, p_date, p_start_time, p_end_time;
end;
$$;
revoke all on function public.submit_pastor_meeting_booking(date, time, time, text, text, text, uuid, text, text, text) from public;
grant execute on function public.submit_pastor_meeting_booking(date, time, time, text, text, text, uuid, text, text, text) to anon, authenticated;


create or replace function public.list_bookable_pastors()
returns table (
  id uuid,
  full_name text,
  is_host boolean,
  upcoming_slot_count bigint
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
begin
  if not (is_super_admin() or is_church_secretary() or is_pastor_admin()) then
    raise exception 'Not allowed';
  end if;

  return query
    select
      p.id,
      p.full_name,
      (p.global_role is distinct from 'pastor_admin') as is_host,
      coalesce(sc.cnt, 0) as upcoming_slot_count
    from public.profiles p
    left join (
      select pastor_id, count(*) as cnt
      from public.pastor_availability
      where tenant_id = v_tenant_id and date >= current_date
      group by pastor_id
    ) sc on sc.pastor_id = p.id
    where p.tenant_id = v_tenant_id
      and (p.global_role = 'pastor_admin'
           or exists (select 1 from public.pastor_meeting_hosts h where h.user_id = p.id and h.tenant_id = v_tenant_id))
    order by is_host asc, p.full_name;
end;
$$;
revoke all on function public.list_bookable_pastors() from public;
grant execute on function public.list_bookable_pastors() to authenticated;


create or replace function public.add_pastor_meeting_host(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
begin
  if not (is_super_admin() or is_church_secretary()) then
    raise exception 'Not allowed';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id and tenant_id = v_tenant_id) then
    raise exception 'Member not found';
  end if;
  insert into public.pastor_meeting_hosts (user_id, tenant_id, added_by) values (p_user_id, v_tenant_id, auth.uid())
  on conflict (user_id) do nothing;
end;
$$;
revoke all on function public.add_pastor_meeting_host(uuid) from public;
grant execute on function public.add_pastor_meeting_host(uuid) to authenticated;


create or replace function public.remove_pastor_meeting_host(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if not (is_super_admin() or is_church_secretary()) then
    raise exception 'Not allowed';
  end if;
  delete from public.pastor_meeting_hosts where user_id = p_user_id and tenant_id = public.current_tenant_id();
end;
$$;
revoke all on function public.remove_pastor_meeting_host(uuid) from public;
grant execute on function public.remove_pastor_meeting_host(uuid) to authenticated;


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
    where pp.tenant_id = v_tenant_id and pp.paused and public.is_pastor_meeting_host(pp.pastor_id);
end;
$$;
revoke all on function public.get_pastor_pause_notices(text) from public;
grant execute on function public.get_pastor_pause_notices(text) to anon, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
