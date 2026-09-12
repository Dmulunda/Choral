-- Trial expiry: a daily pg_cron job flips status to 'trial_expired' once
-- trial_ends_at has passed. Data is never touched/deleted -- expiry is
-- purely a status flip; what an expired tenant can still do is decided by
-- the feature-gating layer (06_plans_and_features.sql), not here.

begin;

create or replace function public.expire_trials()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.tenants
  set status = 'trial_expired', updated_at = now()
  where status = 'trial' and trial_ends_at < now();
$$;

commit;

select cron.schedule(
  'expire-trials',
  '0 4 * * *',
  'select public.expire_trials();'
);

select pg_notify('pgrst', 'reload schema');
