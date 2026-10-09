-- Events with registration -- Phase 1, Main's single-tenant version of
-- the same feature as SAAS (sql/saas_platform/79_events.sql). No
-- tenant_id anywhere and no tenant-slug resolution in the RPCs --
-- Main has exactly one church, so there's no multi-tenant routing
-- problem the public registration page needs to solve the way SAAS's
-- does. Deliberately NOT in this pass: paid tickets/Stripe (Main has
-- no Stripe integration at all today) and QR check-in scanning
-- (genuinely new camera+decode work, not something "the app's
-- existing QR feature" already covers -- only QR *generation* exists,
-- via memberIdCard.js's qrcode library).
--
-- Reuses the SAME notification_cron_secret vault secret already
-- provisioned for sql/095_notification_redesign.sql's email trigger,
-- not a new one.

create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  cover_image_path text,
  location text,
  online_link text,
  start_at timestamptz not null,
  end_at timestamptz,
  organizing_department_id uuid not null references public.departments(id),
  visibility text not null default 'public' check (visibility in ('public', 'members')),
  capacity int check (capacity > 0),
  waitlist_enabled boolean not null default false,
  registration_deadline timestamptz,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_organizing_department_id_idx on public.events (organizing_department_id);

create table public.event_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  question text not null,
  required boolean not null default false,
  position int not null default 0
);
create index event_questions_event_id_idx on public.event_questions (event_id);

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  full_name text not null,
  email text not null,
  phone text,
  user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'confirmed' check (status in ('confirmed', 'waitlisted', 'cancelled')),
  qr_token uuid not null default gen_random_uuid(),
  checked_in_at timestamptz,
  confirmation_emailed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, email)
);
create index event_registrations_event_id_idx on public.event_registrations (event_id);
create unique index event_registrations_qr_token_idx on public.event_registrations (qr_token);

create table public.event_registration_answers (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null references public.event_registrations(id) on delete cascade,
  question_id uuid not null references public.event_questions(id) on delete cascade,
  answer text
);
create index event_registration_answers_registration_id_idx on public.event_registration_answers (registration_id);

alter table public.events enable row level security;
alter table public.event_questions enable row level security;
alter table public.event_registrations enable row level security;
alter table public.event_registration_answers enable row level security;

create policy "members read events" on public.events
  for select to authenticated using (true);
create policy "department admins manage events" on public.events
  for all to authenticated
  using (public.can_write_department(organizing_department_id))
  with check (public.can_write_department(organizing_department_id));

create policy "members read event questions" on public.event_questions
  for select to authenticated using (true);
create policy "department admins manage event questions" on public.event_questions
  for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.can_write_department(e.organizing_department_id)))
  with check (exists (select 1 from public.events e where e.id = event_id and public.can_write_department(e.organizing_department_id)));

create policy "department admins read event registrations" on public.event_registrations
  for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.can_write_department(e.organizing_department_id)) or user_id = auth.uid());
create policy "department admins update event registrations" on public.event_registrations
  for update to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.can_write_department(e.organizing_department_id)))
  with check (exists (select 1 from public.events e where e.id = event_id and public.can_write_department(e.organizing_department_id)));

create policy "department admins read event registration answers" on public.event_registration_answers
  for select to authenticated
  using (exists (
    select 1 from public.event_registrations r join public.events e on e.id = r.event_id
    where r.id = registration_id and (public.can_write_department(e.organizing_department_id) or r.user_id = auth.uid())
  ));

create or replace function public.get_public_event_for_registration(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event record;
  v_confirmed_count int;
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

  select count(*) into v_confirmed_count from public.event_registrations
  where event_id = p_event_id and status = 'confirmed';
  v_places_remaining := case when v_event.capacity is null then null else greatest(0, v_event.capacity - v_confirmed_count) end;
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
    'questions', (
      select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'required', q.required) order by q.position), '[]'::jsonb)
      from public.event_questions q where q.event_id = p_event_id
    )
  );
end;
$$;
revoke all on function public.get_public_event_for_registration(uuid) from public;
grant execute on function public.get_public_event_for_registration(uuid) to anon, authenticated;

create or replace function public.register_for_event(
  p_event_id uuid,
  p_full_name text,
  p_email text,
  p_phone text,
  p_answers jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_event record;
  v_confirmed_count int;
  v_status text;
  v_registration_id uuid;
  v_secret text;
  v_answer jsonb;
begin
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Name is required'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'Email is required'; end if;

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
    select count(*) into v_confirmed_count from public.event_registrations
    where event_id = p_event_id and status = 'confirmed';
    if v_confirmed_count >= v_event.capacity then
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

  insert into public.event_registrations (event_id, full_name, email, phone, user_id, status)
  values (p_event_id, trim(p_full_name), lower(trim(p_email)), nullif(trim(p_phone), ''), auth.uid(), v_status)
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

  return jsonb_build_object('registrationId', v_registration_id, 'status', v_status);
end;
$$;
revoke all on function public.register_for_event(uuid, text, text, text, jsonb) from public;
grant execute on function public.register_for_event(uuid, text, text, text, jsonb) to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
