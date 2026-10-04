-- Real Stripe Price IDs, set once Stripe Dashboard setup (sql/68's
-- header comment, Phase 1 of the Stripe setup walkthrough) was
-- actually completed. Safe to re-run.

update public.plans set stripe_price_id = 'price_1UMeEIAKLslkTkB79ffmLnNH' where key = 'basic';
update public.plans set stripe_price_id = 'price_1UMeF2AKLslkTkB7AziVMeoF' where key = 'basic_yearly';
update public.plans set stripe_price_id = 'price_1UMeFYAKLslkTkB7PlPTGg3C' where key = 'pro';
update public.plans set stripe_price_id = 'price_1UMeGQAKLslkTkB7OsGlqs1L' where key = 'pro_yearly';
update public.plans set stripe_price_id = 'price_1UMeGrAKLslkTkB7ioDVrEYm' where key = 'premium';
update public.plans set stripe_price_id = 'price_1UMeJLAKLslkTkB77vBXH9v4' where key = 'premium_yearly';

select pg_notify('pgrst', 'reload schema');
