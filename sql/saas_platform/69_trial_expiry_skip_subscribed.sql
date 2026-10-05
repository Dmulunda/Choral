-- expire_trials() (sql/07_trial_expiry.sql) flips any status='trial'
-- tenant past trial_ends_at to 'trial_expired'. Now that a trial can
-- have a real Stripe subscription attached (card-upfront trial,
-- stripe-billing's create_checkout_session passing
-- subscription_data.trial_end aligned to this same trial_ends_at),
-- Stripe itself drives that transition -- its webhook fires right
-- around the same moment with 'active' (card charged successfully) or
-- 'past_due' (card declined). Letting this daily cron ALSO flip those
-- tenants risks a race: trial_expired could briefly stomp a status the
-- webhook just set correctly, or vice versa depending on which runs
-- first. Only a trial that never got a card attached at all
-- (stripe_subscription_id is null) is still this cron's problem.
--
-- Also fixes a real latent bug found while testing this: this function
-- has never set the protect_tenant_privileged_columns bypass flag
-- (09_tenant_logo.sql, added after this one), which raises an
-- exception on ANY status/trial_ends_at/plan_id/slug change unless
-- that flag is set -- exactly like sync_tenant_stripe_subscription()
-- already does. Confirmed by direct test: calling expire_trials()
-- against a genuinely overdue trial row raised "Only billing/platform
-- operations can change status..." every time. Switched from `language
-- sql` to `plpgsql` since set_config() needs to run as its own
-- statement before the update.

begin;

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
  where status = 'trial' and trial_ends_at < now() and stripe_subscription_id is null;
end;
$$;

commit;

select pg_notify('pgrst', 'reload schema');
