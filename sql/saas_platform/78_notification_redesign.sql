-- Notifications vs Messages: today both live behind one "Messages"
-- icon as two tabs sharing one unread badge, and admin-authored
-- department_announcements get miscategorized into the notifications
-- feed (a human wrote it -- it belongs with Messages, not automatic
-- system alerts). This migration:
--   1. Stops department_announcements from fanning into `notifications`
--      -- the Messages UI now reads department_announcements directly,
--      the same RLS-scoped pattern js/components/homeWidgets.js's own
--      Announcements dashboard widget already uses (can_read_department()
--      policy already scopes this correctly with no extra filtering).
--   2. Adds notification_preferences so a user can choose, per
--      notification type, whether to see it in-app and/or get an
--      email -- nothing like this existed before.
--   3. Adds 'shift_assigned' as a genuinely new automatic-alert type
--      (department_shift_assignments insert -> notify that user),
--      the first of the feature spec's own example triggers
--      ("You're scheduled for Usher on Sunday") to actually exist.
--      The others (new member registered, payment received, ticket
--      confirmed) are deliberately left for later -- they belong to
--      features (membership approval flow, Stripe, Events) this pass
--      doesn't touch.
--   4. A generic per-notification email trigger, driven entirely by
--      notification_preferences (default off) -- covers every
--      existing and future notification type without touching any of
--      the many existing insert sites.

-- Must run outside the explicit transaction below and before it --
-- PostgreSQL doesn't allow a new enum value to be used in the same
-- transaction that added it (see 21_pastor_meetings_schema.sql for
-- the same pattern already established in this codebase).
alter type public.notification_type add value if not exists 'shift_assigned';

begin;

drop trigger if exists department_announcement_notify on public.department_announcements;
drop function if exists public.notify_department_announcement();

create table if not exists public.notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_type public.notification_type not null,
  in_app boolean not null default true,
  email boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, notification_type)
);
alter table public.notification_preferences enable row level security;

drop policy if exists "users manage their own notification preferences" on public.notification_preferences;
create policy "users manage their own notification preferences" on public.notification_preferences
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Shift-assignment alert -- fires once per newly-created assignment
-- row, only when it actually lands as approved (department_shift_
-- assignments.status defaults to 'approved', so this is the common
-- path, not a rare edge case).
create or replace function public.notify_shift_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dept_name text;
  v_shift_title text;
  v_shift_date date;
begin
  if new.status <> 'approved' then return new; end if;

  select d.name, s.title, s.date into v_dept_name, v_shift_title, v_shift_date
  from public.department_shifts s
  join public.departments d on d.id = s.department_id
  where s.id = new.shift_id;

  if v_dept_name is null then return new; end if;

  insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
  values (
    new.user_id, 'shift_assigned',
    v_dept_name || ': ' || v_shift_title,
    to_char(v_shift_date, 'FMDay, FMMonth FMDDth'),
    null,
    new.tenant_id
  );
  return new;
end;
$$;

drop trigger if exists shift_assignment_notify on public.department_shift_assignments;
create trigger shift_assignment_notify after insert on public.department_shift_assignments
for each row execute function public.notify_shift_assignment();

create or replace function public.notify_email_on_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wants_email boolean;
  v_secret text;
begin
  select np.email into v_wants_email
  from public.notification_preferences np
  where np.user_id = new.recipient_id and np.notification_type = new.type;

  if coalesce(v_wants_email, false) is not true then return new; end if;

  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'offering_cron_secret';
  if v_secret is null then return new; end if;

  perform net.http_post(
    url := 'https://towlqbxvhftzjfrtepsy.supabase.co/functions/v1/send-notification-email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := jsonb_build_object('notification_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists notification_email_trigger on public.notifications;
create trigger notification_email_trigger after insert on public.notifications
for each row execute function public.notify_email_on_notification();

commit;

select pg_notify('pgrst', 'reload schema');
