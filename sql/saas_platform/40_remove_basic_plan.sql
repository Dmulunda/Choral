-- Removes the 'basic' ($0) plan row entirely -- it was never part of
-- the real Pro/Max/Premium pricing (see 39_pricing_tiers.sql), just a
-- placeholder representing "no active subscription". tenants.plan_id
-- is "on delete set null", so any tenant that happened to reference it
-- (none do today) simply reverts to plan_id = null, which already
-- means the exact same thing has_feature()/effective_max_*() treat
-- "no plan" as -- no change in behavior, just one less card shown in
-- the Plans & Pricing modal.

begin;

delete from public.plans where key = 'basic';

commit;
