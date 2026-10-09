-- A registration can now be for more than one person -- Main's
-- version of the same feature as SAAS
-- (sql/saas_platform/81_event_party_size.sql).

alter table public.event_registrations add column party_size int not null default 1 check (party_size >= 1);
alter table public.event_registrations add column additional_names text[] not null default '{}';

create or replace function public.register_for_event(
  p_event_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_answers jsonb default '[]'::jsonb,
  p_party_size int default 1,
  p_additional_names text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event record;
  v_confirmed_people int;
  v_status text;
  v_payment_status text;
  v_registration_id uuid;
  v_secret text;
  v_answer jsonb;
  v_party_size int;
begin
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Name is required'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'Email is required'; end if;
  v_party_size := greatest(1, coalesce(p_party_size, 1));

  select * into v_event from public.events where id = p_event_id for update;
  if v_event is null then raise exception 'Event not found'; end if;
  if v_event.status <> 'active' then raise exception 'This event is no longer accepting registrations.'; end if;
  if v_event.registration_deadline is not null and v_event.registration_deadline <= now() then
    raise exception 'Registration for this event has closed.';
  end if;
  if v_event.visibility = 'members' and auth.uid() is null then
    raise exception 'This event is for church members only -- please sign in.';
  end if;

  if exists (select 1 from public.event_registrations where event_id = p_event_id and email = lower(trim(p_email))) then
    raise exception 'You''ve already registered for this event with that email.';
  end if;

  if v_event.capacity is not null then
    select coalesce(sum(party_size), 0) into v_confirmed_people from public.event_registrations
    where event_id = p_event_id and status = 'confirmed';
    if v_confirmed_people + v_party_size > v_event.capacity then
      if v_event.waitlist_enabled then
        v_status := 'waitlisted';
      else
        raise exception 'This event is full.';
      end if;
    else
      v_status := 'confirmed';
    end if;
  else
    v_status := 'confirmed';
  end if;

  v_payment_status := case when coalesce(v_event.price_cents, 0) > 0 then 'pending' else 'not_required' end;

  insert into public.event_registrations (event_id, full_name, email, phone, user_id, status, payment_status, party_size, additional_names)
  values (p_event_id, trim(p_full_name), lower(trim(p_email)), nullif(trim(p_phone), ''), auth.uid(), v_status, v_payment_status, v_party_size, coalesce(p_additional_names, '{}'))
  returning id into v_registration_id;

  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
  loop
    insert into public.event_registration_answers (registration_id, question_id, answer)
    values (v_registration_id, (v_answer->>'question_id')::uuid, v_answer->>'answer');
  end loop;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'notification_cron_secret';
  if v_secret is not null then
    perform net.http_post(
      url := 'https://ezrwmplohjvttwosqvrn.supabase.co/functions/v1/event-emails',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('action', 'send_confirmation', 'registration_id', v_registration_id)
    );
  end if;

  return jsonb_build_object('registrationId', v_registration_id, 'status', v_status, 'paymentStatus', v_payment_status);
end;
$$;

create or replace function public.get_public_event_for_registration(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event record;
  v_confirmed_people int;
  v_places_remaining int;
  v_registration_open boolean;
begin
  select e.*, d.name as department_name into v_event
  from public.events e
  join public.departments d on d.id = e.organizing_department_id
  where e.id = p_event_id;

  if v_event is null then
    raise exception 'Event not found';
  end if;
  if v_event.visibility = 'members' and auth.uid() is null then
    raise exception 'This event is for church members only -- please sign in.';
  end if;

  select coalesce(sum(party_size), 0) into v_confirmed_people from public.event_registrations
  where event_id = p_event_id and status = 'confirmed';
  v_places_remaining := case when v_event.capacity is null then null else greatest(0, v_event.capacity - v_confirmed_people) end;
  v_registration_open := v_event.status = 'active'
    and (v_event.registration_deadline is null or v_event.registration_deadline > now());

  return jsonb_build_object(
    'id', v_event.id,
    'title', v_event.title,
    'description', v_event.description,
    'coverImagePath', v_event.cover_image_path,
    'location', v_event.location,
    'onlineLink', v_event.online_link,
    'startAt', v_event.start_at,
    'endAt', v_event.end_at,
    'departmentName', v_event.department_name,
    'visibility', v_event.visibility,
    'capacity', v_event.capacity,
    'waitlistEnabled', v_event.waitlist_enabled,
    'placesRemaining', v_places_remaining,
    'registrationOpen', v_registration_open,
    'priceCents', v_event.price_cents,
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'required', q.required) order by q.position), '[]'::jsonb)
      from public.event_questions q where q.event_id = p_event_id
    )
  );
end;
$$;

select pg_notify('pgrst', 'reload schema');
