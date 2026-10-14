-- Platform Owner: a single, cross-tenant account (not a global_role --
-- that enum is tenant-scoped semantics, see 01_schema.sql) that can
-- manually set any tenant's plan without going through Stripe, to comp
-- partner churches for free and to preview Basic/Pro/Premium on their
-- own account. Modeled directly on platform_admins/is_site_admin()
-- (sql/049) -- same "no tenant_id, cross-tenant by design" shape, just
-- a distinct, narrower table/function since Owner and Site Admin are
-- different capabilities (billing override vs. support/suggestion
-- triage) that happen to both be "not scoped to one church."

begin;

create table if not exists public.platform_owner (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.platform_owner enable row level security;

create or replace function public.is_platform_owner()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.platform_owner where user_id = auth.uid());
$$;

revoke all on function public.is_platform_owner() from public;
grant execute on function public.is_platform_owner() to authenticated;

-- No tenant_id -- same reasoning as platform_admins.
drop policy if exists "the owner can read the owner row" on public.platform_owner;
create policy "the owner can read the owner row" on public.platform_owner
  for select to authenticated using (public.is_platform_owner());

-- Seed the one owner. Safe to re-run: on conflict do nothing.
insert into public.platform_owner (user_id)
select p.id from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = lower('didiermulunda@gmail.com')
on conflict (user_id) do nothing;

-- ---- Manual plan override ----

alter table public.tenants add column if not exists plan_override_source text;
alter table public.tenants add column if not exists plan_override_by uuid references public.profiles(id);
alter table public.tenants add column if not exists plan_override_at timestamptz;

-- tenants_select_own (01_schema.sql) only lets a tenant read its own
-- row -- this is a separate, additive PERMISSIVE policy (permissive
-- policies OR together) so the owner can list every tenant for the
-- panel, without touching that existing policy at all.
drop policy if exists "platform owner can read every tenant" on public.tenants;
create policy "platform owner can read every tenant" on public.tenants
  for select to authenticated using (public.is_platform_owner());

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
      plan_override_source = 'owner',
      plan_override_by = auth.uid(),
      plan_override_at = now(),
      updated_at = now()
  where id = p_tenant_id;
end;
$$;

create or replace function public.owner_clear_tenant_override(p_tenant_id uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_platform_owner() then
    raise exception 'Only the platform owner can clear a tenant''s plan override';
  end if;

  update public.tenants
  set plan_override_source = null,
      plan_override_by = null,
      plan_override_at = null,
      updated_at = now()
  where id = p_tenant_id;
end;
$$;

revoke all on function public.owner_set_tenant_plan(uuid, text) from public;
revoke all on function public.owner_clear_tenant_override(uuid) from public;
grant execute on function public.owner_set_tenant_plan(uuid, text) to authenticated;
grant execute on function public.owner_clear_tenant_override(uuid) to authenticated;

-- Dedicated, Owner-only tenant list for the panel -- deliberately NOT
-- the Site-Admin list_all_tenants_for_site_admin() (sql/062): Owner and
-- Site Admin are independent roles, and this one needs plan/billing
-- fields that list doesn't carry.
create or replace function public.owner_list_tenants()
returns table(
  id uuid, name text, slug text, status text,
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
  select t.id, t.name, t.slug, t.status,
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

-- A nightly auto-expiry must never silently undo an owner's manual
-- comp -- only tenants with no override are candidates.
create or replace function public.expire_trials()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform set_config('app.bypass_tenant_column_protection', 'on', true);
  update public.tenants
  set status = 'trial_expired', updated_at = now()
  where status = 'trial' and trial_ends_at < now() and stripe_subscription_id is null
    and plan_override_source is distinct from 'owner';
end;
$$;

-- Likewise, the Stripe webhook's own sync must never stomp an owner's
-- manual plan choice -- status/subscription/period fields still update
-- normally (those reflect real billing state), only plan_id is held.
drop function if exists public.sync_tenant_stripe_subscription(text, text, text, uuid, timestamptz);
create or replace function public.sync_tenant_stripe_subscription(
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_plan_id uuid,
  p_current_period_end timestamptz default null
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform set_config('app.bypass_tenant_column_protection', 'on', true);
  update public.tenants
  set status = p_status,
      plan_id = case when plan_override_source = 'owner' then plan_id else p_plan_id end,
      stripe_subscription_id = p_stripe_subscription_id,
      current_period_end = p_current_period_end,
      updated_at = now()
  where stripe_customer_id = p_stripe_customer_id;
end;
$$;
revoke all on function public.sync_tenant_stripe_subscription(text, text, text, uuid, timestamptz) from public, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
