-- Paid events + QR check-in (feature 15 of the improvement roadmap; the
-- "Phase 2" announced in sql/79_events.sql).
--
-- 1. Online payment for priced events, through the church's own Stripe
--    account (the same Stripe Connect set-up as online giving, sql 144):
--    the 'event-payment' edge function opens Stripe Checkout for a
--    registration; online-giving-webhook marks it paid with
--    mark_event_registration_paid(). Organizers can also mark a
--    registration paid in cash/other, or waived.
-- 2. Check-in at the door: scanning the QR code from the confirmation email
--    (registration qr_token) or tapping a name. Allowed for the organizing
--    department's members (volunteers at the door), its admins, and the
--    pastoral team.

begin;

alter table public.event_registrations
  add column if not exists stripe_session_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists amount_paid_cents integer,
  add column if not exists payment_method text check (payment_method is null or payment_method in ('online', 'cash', 'other')),
  add column if not exists checked_in_by uuid references public.profiles(id) on delete set null;
create index if not exists event_registrations_session_idx on public.event_registrations (stripe_session_id);
create index if not exists event_registrations_qr_idx on public.event_registrations (qr_token);

alter table public.event_registrations drop constraint if exists event_registrations_payment_status_check;
alter table public.event_registrations add constraint event_registrations_payment_status_check
  check (payment_status in ('not_required', 'pending', 'paid', 'waived'));

-- Called by online-giving-webhook (service role) when Stripe says paid.
-- Idempotent: a second call for the same session changes nothing.
create or replace function public.mark_event_registration_paid(p_session_id text, p_amount_cents integer)
returns uuid
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  update public.event_registrations
     set payment_status = 'paid', paid_at = coalesce(paid_at, now()),
         amount_paid_cents = coalesce(p_amount_cents, amount_paid_cents), payment_method = 'online'
   where stripe_session_id = p_session_id and payment_status <> 'paid'
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.event_registrations where stripe_session_id = p_session_id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.mark_event_registration_paid(text, integer) from public, anon, authenticated;

create or replace function public.can_check_in_event(p_event_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.events e
                  where e.id = p_event_id
                    and (public.is_pastoral_team()
                         or public.can_write_department(e.organizing_department_id)
                         or public.can_read_department(e.organizing_department_id)));
$$;
grant execute on function public.can_check_in_event(uuid) to authenticated;

-- Check in (or undo) by QR token or by registration id. Returns who it is,
-- so the door volunteer sees name, party size, payment and any earlier
-- check-in time. Errors: NOT_ALLOWED, NOT_FOUND (wrong event or unknown
-- code), CANCELLED.
create or replace function public.check_in_event_registration(
  p_event_id uuid, p_token uuid default null, p_registration_id uuid default null, p_undo boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  r public.event_registrations;
  v_already timestamptz;
begin
  if not public.can_check_in_event(p_event_id) then raise exception 'NOT_ALLOWED'; end if;
  select * into r from public.event_registrations
   where event_id = p_event_id
     and ((p_token is not null and qr_token = p_token) or (p_registration_id is not null and id = p_registration_id))
   for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.status = 'cancelled' then raise exception 'CANCELLED'; end if;
  v_already := r.checked_in_at;
  if p_undo then
    update public.event_registrations set checked_in_at = null, checked_in_by = null where id = r.id;
  elsif v_already is null then
    update public.event_registrations set checked_in_at = now(), checked_in_by = auth.uid() where id = r.id;
  end if;
  return jsonb_build_object(
    'id', r.id, 'full_name', r.full_name, 'party_size', r.party_size,
    'additional_names', to_jsonb(r.additional_names), 'status', r.status,
    'payment_status', r.payment_status, 'already_checked_in_at', v_already, 'undone', p_undo);
end;
$$;
grant execute on function public.check_in_event_registration(uuid, uuid, uuid, boolean) to authenticated;

-- Door volunteers (department members) need the list of names to check
-- people in by hand; registration RLS only lets department ADMINS read it.
-- This returns just what the door needs -- no email or phone.
create or replace function public.get_event_checkin_list(p_event_id uuid)
returns table (id uuid, full_name text, party_size integer, additional_names text[], status text,
               payment_status text, checked_in_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if not public.can_check_in_event(p_event_id) then raise exception 'NOT_ALLOWED'; end if;
  return query
    select r.id, r.full_name, r.party_size, r.additional_names, r.status, r.payment_status, r.checked_in_at
      from public.event_registrations r
     where r.event_id = p_event_id and r.status <> 'cancelled'
     order by r.full_name;
end;
$$;
grant execute on function public.get_event_checkin_list(uuid) to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');

-- Knowledge-base rows for paid events and check-in (sql/168).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience)
select v.topic, v.content_en, v.content_fr, v.audience
from (values
('Event check-in', 'At the door, open Events → the event → "📷 Check-in". Tap "Scan tickets with the camera" and point the phone at the QR code from the person''s confirmation email: a green box means checked in, orange means already checked in, waitlisted or payment pending, red means it is not a ticket for this event. No ticket? Search the name in the list and tap "Check in"; "Undo" reverses a mistake. Members of the organizing department and the pastoral team can check people in.', 'À l''entrée, ouvrez Événements → l''événement → « 📷 Accueil ». Touchez « Scanner les billets avec la caméra » et visez le code QR du courriel de confirmation : un encadré vert signifie accueilli, orange signifie déjà accueilli, sur liste d''attente ou paiement en attente, rouge signifie que ce n''est pas un billet pour cet événement. Pas de billet ? Cherchez le nom dans la liste et touchez « Accueillir » ; « Annuler » corrige une erreur. Les membres du département organisateur et l''équipe pastorale peuvent accueillir les participants.', 'everyone'),
('Paid events', 'For a priced event, people can pay by card right after registering, or later with the "Pay online" link in their confirmation email, when the church has set up online payments (the same Stripe account as online giving). Organizers see "x of y paid"; for cash at the door, change the person''s payment to Paid, or to Waived for a free place. Online payments show 💳 and are marked paid automatically.', 'Pour un événement payant, les participants peuvent payer par carte juste après l''inscription, ou plus tard avec le lien « Payer en ligne » de leur courriel de confirmation, si l''église a configuré les paiements en ligne (le même compte Stripe que les dons en ligne). Les organisateurs voient « x sur y payés » ; pour un paiement en espèces à l''entrée, passez le paiement de la personne à Payé, ou à Exempté pour une place gratuite. Les paiements en ligne affichent 💳 et sont marqués payés automatiquement.', 'department_admin')
) as v(topic, content_en, content_fr, audience)
;

commit;
