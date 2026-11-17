-- Communication hub (feature 3 of the improvement roadmap).
--
-- One composer (Tools -> Communication hub) sends a message to the whole
-- church or to chosen departments, on any mix of channels:
--   * in-app  -- a 'broadcast' row in notifications (bell icon)
--   * push    -- Web Push to subscribed phones/computers (existing VAPID setup)
--   * email   -- through the existing Resend setup
--   * SMS / WhatsApp -- through Twilio, ONLY once the Twilio secrets are
--                set on the broadcast edge function (they cost money per
--                message); until then the composer shows them as "not set up".
-- The broadcast edge function does the sending and re-checks permission
-- server-side: church-wide needs a pastoral-team role (super_admin,
-- pastor_admin, church_secretary) or can_post_global_announcements;
-- a department needs being that department's admin or secretary.
-- broadcasts keeps a history with per-channel counts.

alter type public.notification_type add value if not exists 'broadcast';

begin;

create table if not exists public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  audience text not null check (audience in ('church', 'departments')),
  department_ids uuid[] not null default '{}',
  title text not null check (length(trim(title)) between 1 and 150),
  body text not null check (length(trim(body)) between 1 and 2000),
  channels text[] not null check (channels <@ array['in_app', 'push', 'email', 'sms', 'whatsapp']::text[] and cardinality(channels) > 0),
  recipient_count integer not null default 0,
  results jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists broadcasts_created_idx on public.broadcasts (created_at desc);
alter table public.broadcasts enable row level security;

-- History: the sender sees their own; the pastoral team sees all of
-- their church's. Rows are written only by the broadcast edge function.
drop policy if exists "senders and pastoral team read broadcasts" on public.broadcasts;
create policy "senders and pastoral team read broadcasts" on public.broadcasts
  for select to authenticated using (
    (created_by = auth.uid() or public.is_super_admin() or public.is_pastor_admin() or public.is_church_secretary())
  );

commit;

select pg_notify('pgrst', 'reload schema');

-- Knowledge-base row for the communication hub (sql/146).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience)
select v.topic, v.content_en, v.content_fr, v.audience
from (values
('Communication hub', 'Tools → Communication hub sends one message to the whole church or to chosen departments. Pick the channels: in the app (bell icon), phone notification, email, and -- once your church has them set up -- SMS and WhatsApp. Church-wide messages are for the pastoral team; a department admin or secretary can message their own department. The History tab shows past messages and how many people each channel reached.', 'Outils → Centre de communication envoie un message à toute l''église ou aux départements choisis. Choisissez les canaux : dans l''application (icône cloche), notification sur téléphone, courriel et -- une fois activés pour votre église -- SMS et WhatsApp. Les messages à toute l''église sont réservés à l''équipe pastorale ; un administrateur ou secrétaire de département peut écrire à son propre département. L''onglet Historique montre les messages envoyés et combien de personnes chaque canal a atteintes.', 'department_admin')
) as v(topic, content_en, content_fr, audience)
;

commit;
