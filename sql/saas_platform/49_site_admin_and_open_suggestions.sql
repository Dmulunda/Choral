-- Two things:
--
-- 1. App Suggestions (already existed, sql/040) was gated to elevated
--    roles only (can_submit_suggestions()) and readable only by each
--    tenant's own Super Admin -- both wrong for "everyone should be
--    able to suggest" and for a platform-wide team that needs to see
--    suggestions across every church, not just their own. Its
--    recipient logic (notify_primary_admin_of_suggestion) also picked
--    a single hardcoded person and inserted their notification with
--    the SUGGESTER's tenant_id (via the column default), which the
--    blanket tenant_isolation RESTRICTIVE policy on `notifications`
--    would then hide from that recipient whenever they belong to a
--    different tenant than the suggester -- the same cross-tenant RLS
--    bug class fixed in 47/48, just not yet triggered because nobody
--    outside the suggester's own tenant was ever the intended reader
--    before now.
--
-- 2. A brand-new `support_requests` channel (tech problems/questions,
--    submitted in-app by any signed-in member) with the same shape.
--
-- Both are read by a new platform-wide `platform_admins` role ("Site
-- Admin") -- people who aren't scoped to one church, who handle
-- incoming requests/questions from every church on the platform.

create table if not exists public.platform_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;

CREATE OR REPLACE FUNCTION public.is_site_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$function$
;

-- No tenant_id / tenant_isolation on this table on purpose: Site Admin
-- is explicitly a cross-tenant concept, not scoped to any one church.
drop policy if exists "site admins can read the site admin list" on public.platform_admins;
create policy "site admins can read the site admin list" on public.platform_admins
  for select to authenticated using (public.is_site_admin());

-- ---- App Suggestions: open submission + admin triage fields ----

alter table public.app_suggestions add column if not exists status text not null default 'new'
  check (status in ('new', 'planned', 'done', 'declined'));
alter table public.app_suggestions add column if not exists admin_note text;
alter table public.app_suggestions add column if not exists updated_at timestamptz not null default now();

drop policy if exists "suggestions are submitted by elevated roles" on public.app_suggestions;
drop policy if exists "any signed-in member can submit a suggestion" on public.app_suggestions;
create policy "any signed-in member can submit a suggestion" on public.app_suggestions
  for insert to authenticated with check (submitted_by = auth.uid());

drop policy if exists "suggestions are readable by super admins" on public.app_suggestions;
drop policy if exists "super admins and site admins can read suggestions" on public.app_suggestions;
create policy "super admins and site admins can read suggestions" on public.app_suggestions
  for select to authenticated using (is_super_admin() OR public.is_site_admin());

drop policy if exists "site admins can triage suggestions" on public.app_suggestions;
create policy "site admins can triage suggestions" on public.app_suggestions
  for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

-- The generic per-table tenant_isolation RESTRICTIVE policy would
-- otherwise block a Site Admin from reading a suggestion filed from a
-- different tenant even with the permissive policy above (RESTRICTIVE
-- policies AND together with every permissive one) -- so this table's
-- copy needs the same override current_tenant_id() overrides get
-- elsewhere: an explicit is_site_admin() escape hatch.
drop policy if exists "tenant_isolation" on public.app_suggestions;
create policy "tenant_isolation" on public.app_suggestions as restrictive for all
  using (tenant_id = current_tenant_id() OR public.is_site_admin());

-- ---- Support Requests (new): tech problems / questions ----

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid references public.profiles(id) on delete set null,
  topic text not null check (topic in ('tech_problem', 'question', 'other')),
  message text not null,
  status text not null default 'new' check (status in ('new', 'answered', 'closed')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  tenant_id uuid not null
);

alter table public.support_requests alter column tenant_id set default public.current_tenant_id();
create index if not exists support_requests_tenant_id_idx on public.support_requests (tenant_id);

alter table public.support_requests enable row level security;

drop policy if exists "any signed-in member can submit a support request" on public.support_requests;
create policy "any signed-in member can submit a support request" on public.support_requests
  for insert to authenticated with check (submitted_by = auth.uid());

drop policy if exists "authors and site admins can read support requests" on public.support_requests;
create policy "authors and site admins can read support requests" on public.support_requests
  for select to authenticated using (submitted_by = auth.uid() OR public.is_site_admin());

drop policy if exists "site admins can triage support requests" on public.support_requests;
create policy "site admins can triage support requests" on public.support_requests
  for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

drop policy if exists "tenant_isolation" on public.support_requests;
create policy "tenant_isolation" on public.support_requests as restrictive for all
  using (tenant_id = current_tenant_id() OR public.is_site_admin());

-- ---- Notify every Site Admin, cross-tenant-safe ----
-- Each notification row is inserted with the RECIPIENT's own
-- tenant_id (not the suggester's, which is what the column default
-- would otherwise silently apply) so it isn't hidden from them by
-- their own tenant_isolation policy on `notifications`.

CREATE OR REPLACE FUNCTION public.notify_site_admins(p_title text, p_body text, p_source_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
  select pa.user_id, 'app_suggestion'::notification_type, p_title, p_body, p_source_user_id, p.tenant_id
  from public.platform_admins pa
  join public.profiles p on p.id = pa.user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_primary_admin_of_suggestion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_full_name text;
begin
  select full_name into v_full_name from public.profiles where id = new.submitted_by;
  perform public.notify_site_admins(
    coalesce(v_full_name, 'Someone') || ' submitted an app suggestion',
    new.message,
    new.submitted_by
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_site_admins_of_support_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_full_name text;
begin
  select full_name into v_full_name from public.profiles where id = new.submitted_by;
  perform public.notify_site_admins(
    coalesce(v_full_name, 'Someone') || ' submitted a support request',
    new.message,
    new.submitted_by
  );
  return new;
end;
$function$
;

DROP TRIGGER IF EXISTS support_request_notify ON public.support_requests;
CREATE TRIGGER support_request_notify AFTER INSERT ON public.support_requests
  FOR EACH ROW EXECUTE FUNCTION notify_site_admins_of_support_request();

-- ---- Cross-tenant lookups/management for the Site Admin console ----

CREATE OR REPLACE FUNCTION public.list_app_suggestions_for_site_admin()
 RETURNS TABLE(id uuid, message text, status text, admin_note text, created_at timestamptz,
               submitted_by uuid, full_name text, tenant_id uuid, tenant_name text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view all app suggestions';
  end if;
  return query
    select s.id, s.message, s.status, s.admin_note, s.created_at,
           s.submitted_by, p.full_name, s.tenant_id, t.name
    from public.app_suggestions s
    left join public.profiles p on p.id = s.submitted_by
    join public.tenants t on t.id = s.tenant_id
    order by s.created_at desc;
end;
$$;

CREATE OR REPLACE FUNCTION public.list_support_requests_for_site_admin()
 RETURNS TABLE(id uuid, topic text, message text, status text, admin_note text, created_at timestamptz,
               submitted_by uuid, full_name text, tenant_id uuid, tenant_name text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view all support requests';
  end if;
  return query
    select r.id, r.topic, r.message, r.status, r.admin_note, r.created_at,
           r.submitted_by, p.full_name, r.tenant_id, t.name
    from public.support_requests r
    left join public.profiles p on p.id = r.submitted_by
    join public.tenants t on t.id = r.tenant_id
    order by r.created_at desc;
end;
$$;

CREATE OR REPLACE FUNCTION public.list_site_admins()
 RETURNS TABLE(user_id uuid, full_name text, tenant_name text, granted_at timestamptz)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view the Site Admin list';
  end if;
  return query
    select pa.user_id, p.full_name, t.name, pa.created_at
    from public.platform_admins pa
    join public.profiles p on p.id = pa.user_id
    join public.tenants t on t.id = p.tenant_id
    order by pa.created_at;
end;
$$;

DROP FUNCTION IF EXISTS public.grant_site_admin_by_email(text);
CREATE OR REPLACE FUNCTION public.grant_site_admin_by_email(p_email text)
 -- OUT param deliberately NOT named user_id: plpgsql's identifier
 -- resolution flags any bare "user_id" in the embedded INSERT below
 -- (even in the ON CONFLICT column list, which can't be table-qualified)
 -- as ambiguous against an OUT param of that name -- same bug class as
 -- find_denomination_member_by_email/get_all_schedule_conflicts_for_date
 -- earlier this session, this time triggered by ON CONFLICT specifically.
 RETURNS TABLE(granted_user_id uuid, full_name text, tenant_name text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
declare
  v_user_id uuid;
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can grant Site Admin access';
  end if;

  select pe.id into v_user_id from public.profile_emails pe
  where lower(pe.email) = lower(trim(p_email)) limit 1;

  if v_user_id is null then
    raise exception 'No user found with that email';
  end if;

  insert into public.platform_admins (user_id, granted_by) values (v_user_id, auth.uid())
  on conflict (user_id) do nothing;

  return query
    select p.id, p.full_name, t.name
    from public.profiles p join public.tenants t on t.id = p.tenant_id
    where p.id = v_user_id;
end;
$$;

CREATE OR REPLACE FUNCTION public.revoke_site_admin(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can revoke Site Admin access';
  end if;
  delete from public.platform_admins where user_id = p_user_id;
end;
$$;

revoke all on function public.list_app_suggestions_for_site_admin() from public;
revoke all on function public.list_support_requests_for_site_admin() from public;
revoke all on function public.list_site_admins() from public;
revoke all on function public.grant_site_admin_by_email(text) from public;
revoke all on function public.revoke_site_admin(uuid) from public;
grant execute on function public.list_app_suggestions_for_site_admin() to authenticated;
grant execute on function public.list_support_requests_for_site_admin() to authenticated;
grant execute on function public.list_site_admins() to authenticated;
grant execute on function public.grant_site_admin_by_email(text) to authenticated;
grant execute on function public.revoke_site_admin(uuid) to authenticated;
grant execute on function public.is_site_admin() to authenticated;
