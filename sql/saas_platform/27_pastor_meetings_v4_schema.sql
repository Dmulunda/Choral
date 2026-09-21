-- Pastor Meeting Scheduling System v4, tenant-scoped port: denormalized
-- meeting date/time on the request row, church-secretary access to
-- manage a pastor's availability/pause on their behalf, an external
-- Zoom/Teams meeting link, a guest-confirmation-email idempotency
-- flag, and a new "meeting host" designation for bookable people who
-- don't hold the pastor_admin role.

begin;

alter table public.pastor_meeting_requests
  add column meeting_date date,
  add column meeting_start_time time,
  add column meeting_end_time time,
  add column meeting_link text,
  add column confirmation_email_sent_at timestamptz;

alter table public.pastor_meeting_settings
  add column online_meeting_link text;

-- Same reasoning as pastor_meeting_pause: a niche, pastor-meetings-
-- specific designation, not a general identity attribute -- a person
-- keeps their existing global_role/department roles, this only adds
-- bookability. pastor_id (in other tables) disambiguates tenant on
-- its own since a person has exactly one profile/tenant, but tenant_id
-- is kept here anyway for the RESTRICTIVE tenant_isolation layer every
-- other table in this schema uses.
create table public.pastor_meeting_hosts (
  user_id uuid primary key references public.profiles(id),
  tenant_id uuid not null default public.current_tenant_id(),
  added_by uuid references public.profiles(id),
  added_at timestamptz not null default now()
);

create index pastor_meeting_hosts_tenant_id_idx on public.pastor_meeting_hosts(tenant_id);

alter table public.pastor_meeting_hosts enable row level security;

create policy "meeting hosts managed by pastoral team" on public.pastor_meeting_hosts
  for all using (is_super_admin() or is_church_secretary())
  with check (is_super_admin() or is_church_secretary());

create policy "meeting hosts readable by pastoral team" on public.pastor_meeting_hosts
  for select using (is_super_admin() or is_church_secretary() or is_pastor_admin() or user_id = auth.uid());

create policy tenant_isolation on public.pastor_meeting_hosts
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create or replace function public.is_pastor_meeting_host(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select
    exists (select 1 from public.profiles where id = p_user_id and global_role = 'pastor_admin')
    or exists (select 1 from public.pastor_meeting_hosts where user_id = p_user_id);
$$;
revoke all on function public.is_pastor_meeting_host(uuid) from public;
grant execute on function public.is_pastor_meeting_host(uuid) to anon, authenticated;

-- Widened from pastor-self/super-admin-only to also let the church
-- secretary manage a pastor's calendar on their behalf, and closes the
-- same pre-existing gap fixed on main: previously ANY authenticated
-- user could insert pastor_availability rows for themselves
-- (pastor_id = auth.uid()) regardless of role -- the RESTRICTIVE
-- tenant_isolation layer still scoped it to their own tenant, but
-- nothing checked whether they actually counted as a pastor. Self
-- writes now also require is_pastor_meeting_host(auth.uid()).
drop policy "pastor manages own availability" on public.pastor_availability;
create policy "pastoral team manages availability" on public.pastor_availability
  for all using (
    is_super_admin() or is_church_secretary()
    or (pastor_id = auth.uid() and is_pastor_meeting_host(auth.uid()))
  )
  with check (
    is_super_admin() or is_church_secretary()
    or (pastor_id = auth.uid() and is_pastor_meeting_host(auth.uid()))
  );

drop policy "pastor manages own pause state" on public.pastor_meeting_pause;
create policy "pastoral team manages pause state" on public.pastor_meeting_pause
  for all using (
    is_super_admin() or is_church_secretary()
    or (pastor_id = auth.uid() and is_pastor_meeting_host(auth.uid()))
  )
  with check (
    is_super_admin() or is_church_secretary()
    or (pastor_id = auth.uid() and is_pastor_meeting_host(auth.uid()))
  );

-- Pastor Admins can now also edit settings (specifically so they can
-- set the online meeting link themselves) -- was super_admin/
-- church_secretary only.
drop policy "pastor meeting settings managed by admin" on public.pastor_meeting_settings;
create policy "pastor meeting settings managed by pastoral team" on public.pastor_meeting_settings
  for all using (is_super_admin() or is_church_secretary() or is_pastor_admin())
  with check (is_super_admin() or is_church_secretary() or is_pastor_admin());

commit;

select pg_notify('pgrst', 'reload schema');
