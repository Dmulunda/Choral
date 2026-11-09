-- Invite Members (parity with sandbox2's ?join=<slug> invite-link
-- feature, sql/saas_platform/10_invite_links.sql): a single
-- church-wide on/off switch for open self-signup, same singleton-row
-- pattern as pastor_meeting_settings. Main has exactly one church,
-- so there's no slug to resolve -- the "invite link" is just this
-- app's own URL with ?join=1, which js/components/authScreen.js
-- uses to auto-switch to the Sign Up tab (or explain why it's
-- hidden, if the switch below is off). The switch itself controls
-- whether the Sign Up tab is shown at all, regardless of ?join --
-- turning it off forces every new account through userCreatorModal.js
-- (admin-created) instead, exactly like sandbox2's
-- allow_self_signup = false state.
begin;

create table public.signup_settings (
  id boolean primary key default true check (id),
  allow_self_signup boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create trigger force_updated_at before insert or update on public.signup_settings
  for each row execute function public.force_server_timestamp_updated_at();

alter table public.signup_settings enable row level security;

create policy "signup settings are managed by super admin" on public.signup_settings
  for all to authenticated
  using (is_super_admin())
  with check (is_super_admin());
create policy "signup settings are readable by everyone" on public.signup_settings
  for select using (true);

insert into public.signup_settings (id, allow_self_signup) values (true, true);

select pg_notify('pgrst', 'reload schema');

commit;
