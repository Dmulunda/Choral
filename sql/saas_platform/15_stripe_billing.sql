-- Stripe billing plumbing. Basic ($0) needs no Stripe object -- a tenant
-- with plan_id = null already has zero gated features today
-- (has_feature() only grants access on status='trial' or a plan_features
-- match). So this only needs to handle the two paid tiers.

begin;

alter table public.plans add column if not exists stripe_price_id text unique;
alter table public.tenants add column if not exists stripe_customer_id text unique;
alter table public.tenants add column if not exists stripe_subscription_id text unique;

-- Single entry point for anything that needs to change status/plan_id --
-- wraps the bypass flag (protect_tenant_privileged_columns, 09_tenant_logo.sql)
-- so callers never have to remember it. SECURITY DEFINER, revoked from
-- authenticated -- only the webhook (service-role) calls this.
create or replace function public.sync_tenant_stripe_subscription(
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_status text,
  p_plan_id uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform set_config('app.bypass_tenant_column_protection', 'on', true); -- true = transaction-local
  update public.tenants
  set status = p_status, plan_id = p_plan_id,
      stripe_subscription_id = p_stripe_subscription_id, updated_at = now()
  where stripe_customer_id = p_stripe_customer_id;
end;
$$;
revoke all on function public.sync_tenant_stripe_subscription(text, text, text, uuid) from public, authenticated;

-- Sets the customer id the first time a tenant checks out (no status/plan_id
-- touched, so no bypass flag needed -- these two columns aren't in the
-- trigger's protected list).
create or replace function public.set_tenant_stripe_customer(p_tenant_id uuid, p_stripe_customer_id text)
returns void language sql security definer set search_path = public, pg_temp
as $$ update public.tenants set stripe_customer_id = p_stripe_customer_id where id = p_tenant_id; $$;
revoke all on function public.set_tenant_stripe_customer(uuid, text) from public, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
