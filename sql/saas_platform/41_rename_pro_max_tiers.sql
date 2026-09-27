-- Renames the two lower tiers -- same prices/limits/features as
-- 39_pricing_tiers.sql, just relabeled: old 'pro' -> 'basic', old
-- 'max' -> 'pro'. Premium is untouched. Order matters: 'pro' must be
-- renamed away before 'max' can claim that key (plans.key is unique).

begin;

update public.plans set key = 'basic', name = 'Basic' where key = 'pro';
update public.plans set key = 'pro', name = 'Pro' where key = 'max';

commit;
