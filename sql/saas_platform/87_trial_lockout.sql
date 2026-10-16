-- Once a tenant's trial ends with no plan ever assigned
-- (status='trial_expired'), the client now shows a full-screen lockout
-- instead of the normal app shell (js/app.js's showTrialEnded()) --
-- this migration is the backend half: (1) closes a real gap where the
-- numeric effective_max_*() functions fell through to "unlimited" for
-- exactly this case (plan_id null, status not 'trial' -- the CASE only
-- ever special-cased the trial bonus, never the no-plan-at-all case),
-- (2) owner_set_tenant_plan now also clears trial_expired back to
-- active (assigning a plan is what "removes the trial message"), and
-- (3) a new owner_set_tenant_trial_end lets the owner move a tenant's
-- trial_ends_at (their own included, to preview the lockout the same
-- way they already preview a plan).

begin;

-- ---- Close the no-plan-at-all fallback gap ----
-- Previously: only status='trial' short-circuited to null (unlimited);
-- every other status read straight off plans.max_X, which is NULL
-- when plan_id itself is null -- making a plan-less, trial-expired
-- tenant read as "unlimited" instead of "blocked". Now: no plan at
-- all (and not currently trialing) means 0, not unlimited.

create or replace function public.effective_max_extensions(p_tenant_id uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when (select status from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) = 'trial' then null
    when (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) is null then 0
    else (select max_extensions from public.plans where id = (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)))
  end;
$$;

create or replace function public.effective_max_super_admins_per_tenant(p_tenant_id uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when (select status from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) = 'trial' then null
    when (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) is null then 0
    else (select max_super_admins_per_tenant from public.plans where id = (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)))
  end;
$$;

create or replace function public.effective_max_members(p_tenant_id uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when (select status from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) = 'trial' then null
    when (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) is null then 0
    else (select max_members from public.plans where id = (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)))
  end;
$$;

create or replace function public.effective_max_admins(p_tenant_id uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when (select status from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) = 'trial' then null
    when (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) is null then 0
    else (select max_admins from public.plans where id = (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)))
  end;
$$;

create or replace function public.effective_max_global_admins(p_tenant_id uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when (select status from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) = 'trial' then null
    when (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) is null then 0
    else (select max_global_admins from public.plans where id = (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)))
  end;
$$;

-- ---- Assigning a plan clears the trial-expired lockout ----
-- The owner granting a plan is a real, deliberate "this tenant now has
-- access" decision -- status should follow, not stay stuck on
-- 'trial_expired' forever (which would otherwise still show the
-- lockout screen even with a real plan_id set).
create or replace function public.owner_set_tenant_plan(p_tenant_id uuid, p_plan_key text)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_plan_id uuid;
begin
  if not public.is_platform_owner() then
    raise exception 'Only the platform owner can change a tenant''s plan directly';
  end if;

  select id into v_plan_id from public.plans where key = p_plan_key;
  if v_plan_id is null then
    raise exception 'Unknown plan key: %', p_plan_key;
  end if;

  perform set_config('app.bypass_tenant_column_protection', 'on', true);
  update public.tenants
  set plan_id = v_plan_id,
      status = case when status = 'trial_expired' then 'active' else status end,
      plan_override_source = 'owner',
      plan_override_by = auth.uid(),
      plan_override_at = now(),
      updated_at = now()
  where id = p_tenant_id;
end;
$$;

-- ---- Owner can move a tenant's trial end date (their own included) ----
-- Status follows the date the same way expire_trials() already derives
-- it, so the owner can preview the lockout screen on their own account
-- (set it in the past) and restore it (set it back in the future) the
-- same way they already preview a plan.
create or replace function public.owner_set_tenant_trial_end(p_tenant_id uuid, p_trial_ends_at timestamptz)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Only the platform owner can change a tenant''s trial end date';
  end if;

  perform set_config('app.bypass_tenant_column_protection', 'on', true);
  update public.tenants
  set trial_ends_at = p_trial_ends_at,
      status = case when p_trial_ends_at < now() then 'trial_expired' else 'trial' end,
      updated_at = now()
  where id = p_tenant_id;
end;
$$;

revoke all on function public.owner_set_tenant_trial_end(uuid, timestamptz) from public;
grant execute on function public.owner_set_tenant_trial_end(uuid, timestamptz) to authenticated;

-- ---- Owner panel needs trial_ends_at to show/edit it ----
drop function if exists public.owner_list_tenants();
create or replace function public.owner_list_tenants()
returns table(
  id uuid, name text, slug text, status text, trial_ends_at timestamptz,
  plan_key text, plan_name text,
  is_paying boolean, plan_override_source text, plan_override_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Only the platform owner can view the tenant list';
  end if;

  return query
  select t.id, t.name, t.slug, t.status, t.trial_ends_at,
         p.key, p.name,
         t.stripe_subscription_id is not null,
         t.plan_override_source, t.plan_override_at
  from public.tenants t
  left join public.plans p on p.id = t.plan_id
  order by t.name;
end;
$$;

revoke all on function public.owner_list_tenants() from public;
grant execute on function public.owner_list_tenants() to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
