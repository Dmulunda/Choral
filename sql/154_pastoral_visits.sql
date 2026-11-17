-- Pastoral visits (feature 13 of the improvement roadmap).
--
-- Plan and record home, hospital, phone and office visits: who is visited
-- (someone in the member database, or any name), why, when, who goes, what
-- happened (confidential notes) and when to follow up. The pastoral team sees
-- and manages every visit; a person a visit is assigned to (a deacon, an
-- elder...) sees only their own visits and can mark them done with notes.
-- The visitor gets a notification when assigned and the day before.
--
-- Notification type 'pastoral_visit' is added outside the transaction (an
-- enum value can't be added and used in the same transaction).

alter type public.notification_type add value if not exists 'pastoral_visit';

begin;

create table if not exists public.pastoral_visits (
  id uuid primary key default gen_random_uuid(),
  member_id uuid references public.members(id) on delete set null,
  person_name text not null check (length(trim(person_name)) between 1 and 160),
  visit_type text not null default 'home' check (visit_type in ('home', 'hospital', 'phone', 'office', 'other')),
  reason text check (reason is null or length(reason) <= 300),
  location text check (location is null or length(location) <= 200),
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  planned_on date,
  planned_time time,
  assigned_to uuid references public.profiles(id) on delete set null,
  visited_on date,
  notes text,
  follow_up_on date,
  reminded_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pastoral_visits_planned_idx on public.pastoral_visits (planned_on);
create index if not exists pastoral_visits_assignee_idx on public.pastoral_visits (assigned_to);
create index if not exists pastoral_visits_member_idx on public.pastoral_visits (member_id);

alter table public.pastoral_visits enable row level security;
drop policy if exists "pastoral team manages visits" on public.pastoral_visits;
create policy "pastoral team manages visits" on public.pastoral_visits
  for all to authenticated
  using (public.is_pastoral_team())
  with check (public.is_pastoral_team());
drop policy if exists "visitor reads own visits" on public.pastoral_visits;
create policy "visitor reads own visits" on public.pastoral_visits
  for select to authenticated
  using (assigned_to = auth.uid());
drop policy if exists "visitor updates own visits" on public.pastoral_visits;
create policy "visitor updates own visits" on public.pastoral_visits
  for update to authenticated
  using (assigned_to = auth.uid())
  with check (assigned_to = auth.uid());

-- A visitor may only change the outcome fields of their own visit.
create or replace function public.guard_pastoral_visit_update()
returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if new.assigned_to is distinct from old.assigned_to or new.planned_on is distinct from old.planned_on then
    new.reminded_at := null;
  end if;
  if not public.is_pastoral_team() then
    if new.member_id is distinct from old.member_id or new.person_name is distinct from old.person_name
       or new.visit_type is distinct from old.visit_type or new.reason is distinct from old.reason
       or new.assigned_to is distinct from old.assigned_to
       or new.created_by is distinct from old.created_by then
      raise exception 'ONLY_OUTCOME_FIELDS';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists pastoral_visits_guard on public.pastoral_visits;
create trigger pastoral_visits_guard before update on public.pastoral_visits
  for each row execute function public.guard_pastoral_visit_update();

-- Tell the visitor when a visit is assigned to them (not when they assign
-- themselves). The notification shows no confidential notes.
create or replace function public.notify_pastoral_visit_assigned()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if new.assigned_to is not null and new.status = 'planned'
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and new.assigned_to is distinct from auth.uid() then
    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    values (new.assigned_to, 'pastoral_visit',
            '🏠 Visit: ' || new.person_name || ' / Visite : ' || new.person_name,
            coalesce(to_char(new.planned_on, 'DD/MM/YYYY'), 'Date to set / Date à fixer')
              || coalesce(' ' || to_char(new.planned_time, 'HH24:MI'), '')
              || coalesce(' — ' || nullif(new.location, ''), ''),
            auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists pastoral_visits_notify on public.pastoral_visits;
create trigger pastoral_visits_notify after insert or update of assigned_to on public.pastoral_visits
  for each row execute function public.notify_pastoral_visit_assigned();

-- Day-before reminder for planned visits (daily cron below).
create or replace function public.send_pastoral_visit_reminders()
returns integer
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  with due as (
    update public.pastoral_visits v
       set reminded_at = now()
     where v.status = 'planned' and v.assigned_to is not null and v.reminded_at is null
       and v.planned_on = (now() at time zone 'America/Toronto')::date + 1
    returning v.*
  )
  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  select due.assigned_to, 'pastoral_visit',
         '⏰ Visit tomorrow: ' || due.person_name || ' / Visite demain : ' || due.person_name,
         coalesce(to_char(due.planned_time, 'HH24:MI'), '') || coalesce(' — ' || nullif(due.location, ''), ''),
         null
  from due;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.send_pastoral_visit_reminders() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'send-pastoral-visit-reminders';
select cron.schedule('send-pastoral-visit-reminders', '5 13 * * *', 'select public.send_pastoral_visit_reminders()');

commit;

select pg_notify('pgrst', 'reload schema');

-- Knowledge-base rows for pastoral visits (sql/164).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience)
select v.topic, v.content_en, v.content_fr, v.audience
from (values
('Pastoral visits', 'Pastoral Visits (sidebar) lets the pastoral team plan home, hospital, phone and church visits: choose the person (from the member database or any name), the reason, date, time, place and the visitor. The visitor gets a notification when assigned and the day before. After the visit, "Mark done" records the date, confidential notes and an optional follow-up date; follow-ups due appear in their own list with "Plan follow-up". "Not visited in 6 months" lists members with no recent visit, each with a "Plan" button.', 'Visites pastorales (barre latérale) permet à l''équipe pastorale de planifier des visites à domicile, à l''hôpital, par téléphone ou à l''église : choisissez la personne (dans la base des membres ou n''importe quel nom), le motif, la date, l''heure, le lieu et le visiteur. Le visiteur reçoit une notification lorsqu''on la lui confie et la veille. Après la visite, « Marquer comme faite » enregistre la date, des notes confidentielles et une date de suivi facultative ; les suivis à faire apparaissent dans leur propre liste avec « Planifier le suivi ». « Pas visités depuis 6 mois » liste les membres sans visite récente, chacun avec un bouton « Planifier ».', 'pastoral'),
('Visits assigned to me', 'If a pastor assigns you a visit, Pastoral Visits appears in your sidebar with only your visits. After the visit, tap "Mark done", enter the date and a short confidential note for the pastors, and a follow-up date if needed.', 'Si un pasteur vous confie une visite, Visites pastorales apparaît dans votre barre latérale avec uniquement vos visites. Après la visite, touchez « Marquer comme faite », indiquez la date, une courte note confidentielle pour les pasteurs et, si besoin, une date de suivi.', 'everyone')
) as v(topic, content_en, content_fr, audience)
;

commit;
