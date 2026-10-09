-- Events with registration -- Phase 1 of the feature spec: event
-- creation, a public registration page, QR ticket generation, admin
-- registrant list + export, confirmation email. Deliberately NOT in
-- this pass (see the user's own scoping decision): paid ticket types/
-- Stripe (neither app has ever done a one-time Stripe charge, and
-- Main has no Stripe integration at all today -- that's real new
-- infrastructure, not an extension), and QR *scanning*/check-in (the
-- spec assumed "the app's existing QR feature" for this -- it doesn't
-- exist; only QR *generation* does, via memberIdCard.js's qrcode
-- library. Scanning is a genuinely new camera+decode capability,
-- deferred to Phase 2 alongside payments).
--
-- Anonymous/public access (the registration page, reached via a
-- shared link, no login) goes entirely through two SECURITY DEFINER
-- RPCs below, never direct table access -- every other table here
-- keeps the same restrictive tenant_isolation policy as everything
-- else in this schema, which would silently block anon regardless of
-- any permissive policy (current_tenant_id() resolves to null with no
-- session). Mirrors the exact pattern already proven for the public
-- pastor-booking page (get_public_pastor_slots/
-- submit_pastor_meeting_booking, sql/saas_platform/26): resolve the
-- tenant from current_tenant_id() when signed in, or from a
-- p_tenant_slug the public link itself carries when not.

begin;

create table public.events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
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
create index events_tenant_id_idx on public.events (tenant_id);
create index events_organizing_department_id_idx on public.events (organizing_department_id);

create table public.event_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  question text not null,
  required boolean not null default false,
  position int not null default 0
);
create index event_questions_event_id_idx on public.event_questions (event_id);

create table public.event_registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
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

create policy "tenant_isolation" on public.events as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public.event_questions as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));
create policy "tenant_isolation" on public.event_registrations as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- Any signed-in member of the tenant can read the event list/details
-- (this is the admin/member-facing read path -- the PUBLIC path is
-- the RPC below, which bypasses RLS entirely for anon). Write is
-- restricted to that event's organizing department's own admin (or a
-- Super Admin, via can_write_department's own fallback).
create policy "tenant members read events" on public.events
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
create policy "department admins manage events" on public.events
  for all to authenticated
  using (public.can_write_department(organizing_department_id))
  with check (public.can_write_department(organizing_department_id));

create policy "tenant members read event questions" on public.event_questions
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
create policy "department admins manage event questions" on public.event_questions
  for all to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.can_write_department(e.organizing_department_id)))
  with check (exists (select 1 from public.events e where e.id = event_id and public.can_write_department(e.organizing_department_id)));

-- Registrations are NOT broadly readable -- only that event's
-- organizing department's own admin (the registrant list), or the
-- registrant themselves if they were signed in when they registered.
create policy "department admins read event registrations" on public.event_registrations
  for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.can_write_department(e.organizing_department_id)) or user_id = auth.uid());
create policy "department admins update event registrations" on public.event_registrations
  for update to authenticated
  using (exists (select 1 from public.events e where e.id = event_id and public.can_write_department(e.organizing_department_id)))
  with check (exists (select 1 from public.events e where e.id = event_id and public.can_write_department(e.organizing_department_id)));
-- No insert policy here on purpose, same reasoning as report_absence()
-- elsewhere in this schema -- register_for_event() below is security
-- definer and handles the insert itself (capacity/deadline/duplicate
-- checks need to happen server-side, atomically, not trusted to a
-- client-side check-then-insert).

create policy "department admins read event registration answers" on public.event_registration_answers
  for select to authenticated
  using (exists (
    select 1 from public.event_registrations r join public.events e on e.id = r.event_id
    where r.id = registration_id and (public.can_write_department(e.organizing_department_id) or r.user_id = auth.uid())
  ));

-- Returns one event's full public-facing detail (for the registration
-- page) as jsonb: the event itself, its questions, and two computed
-- fields the page needs to decide what to show (placesRemaining,
-- registrationOpen) -- computed server-side so the public page never
-- has to trust its own arithmetic on data it can't otherwise read.
create or replace function public.get_public_event_for_registration(p_event_id uuid, p_tenant_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_tenant_id uuid;
  v_event record;
  v_confirmed_count int;
  v_places_remaining int;
  v_registration_open boolean;
begin
  if auth.uid() is not null then
    v_tenant_id := public.current_tenant_id();
  else
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      raise exception 'Church not found';
    end if;
  end if;

  select e.*, d.name as department_name into v_event
  from public.events e
  join public.departments d on d.id = e.organizing_department_id
  where e.id = p_event_id and e.tenant_id = v_tenant_id;

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
revoke all on function public.get_public_event_for_registration(uuid, text) from public;
grant execute on function public.get_public_event_for_registration(uuid, text) to anon, authenticated;

-- p_answers: jsonb array of { "question_id": uuid, "answer": text }.
-- Capacity/waitlist/duplicate-email checks all happen here, inside
-- one function call, specifically so two people registering for the
-- last place at the same moment can't both get seated (a client-side
-- check-then-insert would race; this doesn't).
create or replace function public.register_for_event(
  p_event_id uuid,
  p_tenant_slug text,
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
  v_tenant_id uuid;
  v_event record;
  v_confirmed_count int;
  v_status text;
  v_registration_id uuid;
  v_secret text;
  v_answer jsonb;
begin
  if auth.uid() is not null then
    v_tenant_id := public.current_tenant_id();
  else
    select id into v_tenant_id from public.tenants where slug = p_tenant_slug;
    if v_tenant_id is null then
      raise exception 'Church not found';
    end if;
  end if;

  if coalesce(trim(p_full_name), '') = '' then raise exception 'Name is required'; end if;
  if coalesce(trim(p_email), '') = '' then raise exception 'Email is required'; end if;

  select * into v_event from public.events
  where id = p_event_id and tenant_id = v_tenant_id
  for update;
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

  insert into public.event_registrations (event_id, tenant_id, full_name, email, phone, user_id, status)
  values (p_event_id, v_tenant_id, trim(p_full_name), lower(trim(p_email)), nullif(trim(p_phone), ''), auth.uid(), v_status)
  returning id into v_registration_id;

  for v_answer in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb))
  loop
    insert into public.event_registration_answers (registration_id, question_id, answer)
    values (v_registration_id, (v_answer->>'question_id')::uuid, v_answer->>'answer');
  end loop;

  -- Fire-and-forget confirmation email -- same shared cron-secret
  -- infrastructure already used for promo-code/notification emails,
  -- not a new secret of its own.
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'offering_cron_secret';
  if v_secret is not null then
    perform net.http_post(
      url := 'https://towlqbxvhftzjfrtepsy.supabase.co/functions/v1/event-emails',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('action', 'send_confirmation', 'registration_id', v_registration_id)
    );
  end if;

  return jsonb_build_object('registrationId', v_registration_id, 'status', v_status);
end;
$$;
revoke all on function public.register_for_event(uuid, text, text, text, text, jsonb) from public;
grant execute on function public.register_for_event(uuid, text, text, text, text, jsonb) to anon, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
