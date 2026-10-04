-- Adds a yearly billing option alongside each tier's existing monthly
-- price. No changes needed to has_feature()/effective_max_*()/
-- sync_tenant_stripe_subscription() or either Stripe Edge Function --
-- stripe-billing's create_checkout_session resolves a Stripe Price
-- generically off plans.key, and stripe-webhook's planIdForPrice
-- resolves a plan generically off plans.stripe_price_id, so a new
-- plan row for each tier's yearly interval is all this needs.
--
-- plan_group links a tier's monthly and yearly row together,
-- independent of the unique `key` column (e.g. 'pro' and 'pro_yearly'
-- both get plan_group='pro') -- the client UI's monthly/yearly toggle
-- uses this to show the right 3 cards.
--
-- Prices confirmed with the user: Basic 59.99/mo -> 699.99/yr, Pro
-- 99.99/mo -> 1,099.99/yr, Premium 199.99/mo -> 2,299.99/yr. Monthly
-- prices are untouched. stripe_price_id for all 6 rows stays null
-- until the user finishes Stripe Dashboard setup and gives us the
-- real Price IDs (see sql/saas_platform/68b_stripe_price_ids.sql,
-- applied as a short follow-up once those exist).

begin;

alter table public.plans add column if not exists plan_group text;
update public.plans set plan_group = key where plan_group is null;

insert into public.plans (key, name, price_cents, billing_interval, plan_group, max_extensions, max_super_admins_per_tenant, max_members, storage_gb)
select key || '_yearly', name, yearly_cents, 'yearly', key, max_extensions, max_super_admins_per_tenant, max_members, storage_gb
from public.plans, (values
  ('basic', 69999),
  ('pro', 109999),
  ('premium', 229999)
) as yearly(plan_key, yearly_cents)
where plans.key = yearly.plan_key
on conflict (key) do update set
  name = excluded.name, price_cents = excluded.price_cents, billing_interval = excluded.billing_interval,
  plan_group = excluded.plan_group, max_extensions = excluded.max_extensions,
  max_super_admins_per_tenant = excluded.max_super_admins_per_tenant, max_members = excluded.max_members,
  storage_gb = excluded.storage_gb;

-- Same entitlements as the monthly sibling -- only interval/price
-- differ between the two rows of a tier.
insert into public.plan_features (plan_id, feature_id)
select yearly_plan.id, pf.feature_id
from public.plan_features pf
join public.plans monthly_plan on monthly_plan.id = pf.plan_id
join public.plans yearly_plan on yearly_plan.key = monthly_plan.key || '_yearly'
on conflict do nothing;

commit;

select pg_notify('pgrst', 'reload schema');
