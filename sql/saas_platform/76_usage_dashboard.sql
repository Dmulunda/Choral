-- Site Admin "Usage Dashboard" -- platform-wide overview (active
-- churches by plan, new/cancelled this month, at-risk churches) plus
-- a per-church usage table (plan + renewal date, member/extension
-- counts against plan limits, login activity, last active). Scoped
-- to what's genuinely instrumented today: Events/tickets and
-- messages/emails-sent counts from the feature spec aren't included
-- here, since neither feature exists yet -- this is the "Overview of
-- all churches" + "For each church" sections only, not the
-- per-department breakdown, which is a separate, deeper drill-down
-- left for a follow-up.

begin;

-- Stripe's subscription.current_period_end -- the webhook already
-- retrieves the full subscription object on checkout.session.completed
-- and customer.subscription.updated, so this just persists a field it
-- already has in hand. Without this, a paid tenant's actual renewal
-- date was nowhere in the database (trial_ends_at only covers the
-- trial itself).
alter table public.tenants add column if not exists current_period_end timestamptz;

drop function if exists public.sync_tenant_stripe_subscription(text, text, text, uuid);
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
  perform set_config('app.bypass_tenant_column_protection', 'on', true); -- true = transaction-local
  update public.tenants
  set status = p_status, plan_id = p_plan_id,
      stripe_subscription_id = p_stripe_subscription_id,
      current_period_end = p_current_period_end,
      updated_at = now()
  where stripe_customer_id = p_stripe_customer_id;
end;
$$;
revoke all on function public.sync_tenant_stripe_subscription(text, text, text, uuid, timestamptz) from public, authenticated;

-- Single scalar snapshot for the dashboard's top "Overview" section --
-- one round trip instead of several separate count queries from the
-- client. "At risk" mirrors the spec's own definition exactly: no
-- sign-in (ever, or within) the last 14 days.
create or replace function public.get_platform_usage_overview()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view platform usage';
  end if;

  with last_active as (
    select p.tenant_id, max(u.last_sign_in_at) as last_active_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.removed_at is null
    group by p.tenant_id
  )
  select jsonb_build_object(
    'byPlan', (
      select coalesce(jsonb_object_agg(plan_name, cnt), '{}'::jsonb)
      from (
        select coalesce(p.name, 'Basic') as plan_name, count(*) as cnt
        from public.tenants t
        left join public.plans p on p.id = t.plan_id
        where t.deleted_at is null and t.status in ('trial', 'active', 'past_due')
        group by coalesce(p.name, 'Basic')
      ) x
    ),
    'newThisMonth', (
      select count(*) from public.tenants
      where deleted_at is null and created_at >= date_trunc('month', now())
    ),
    'cancelledThisMonth', (
      select count(*) from public.tenants
      where status = 'canceled' and updated_at >= date_trunc('month', now())
    ),
    'atRiskCount', (
      select count(*) from public.tenants t
      where t.deleted_at is null
        and (
          (select la.last_active_at from last_active la where la.tenant_id = t.id) is null
          or (select la.last_active_at from last_active la where la.tenant_id = t.id) < now() - interval '14 days'
        )
    )
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.get_platform_usage_overview() from public;
grant execute on function public.get_platform_usage_overview() to authenticated;

-- Per-church row for the dashboard's detail table. Storage bytes are
-- deliberately NOT recomputed here -- list_all_tenants_for_site_admin()
-- (60_site_admin_tenant_overview.sql) already does that cross-bucket
-- attribution and the Churches tab already shows it; duplicating that
-- query here would just be two sources of truth for the same number.
create or replace function public.list_tenant_usage_for_site_admin()
returns table (
  id uuid,
  name text,
  status text,
  plan_name text,
  max_members int,
  max_extensions int,
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  member_count bigint,
  extension_count bigint,
  logins_7d bigint,
  logins_30d bigint,
  last_active_at timestamptz
)
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view platform usage';
  end if;

  return query
  select
    t.id, t.name, t.status,
    p.name as plan_name, p.max_members, p.max_extensions,
    t.trial_ends_at, t.current_period_end,
    (select count(*) from public.profiles pr where pr.tenant_id = t.id and pr.removed_at is null),
    (select count(*) from public.tenants ext where ext.denomination_id = t.denomination_id and ext.id <> t.id and t.denomination_id is not null),
    (select count(*) from public.login_events le where le.tenant_id = t.id and le.logged_in_at >= now() - interval '7 days'),
    (select count(*) from public.login_events le where le.tenant_id = t.id and le.logged_in_at >= now() - interval '30 days'),
    (select max(u.last_sign_in_at) from public.profiles pr2 join auth.users u on u.id = pr2.id where pr2.tenant_id = t.id and pr2.removed_at is null)
  from public.tenants t
  left join public.plans p on p.id = t.plan_id
  where t.deleted_at is null
  order by t.created_at desc;
end;
$$;
revoke all on function public.list_tenant_usage_for_site_admin() from public;
grant execute on function public.list_tenant_usage_for_site_admin() to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
