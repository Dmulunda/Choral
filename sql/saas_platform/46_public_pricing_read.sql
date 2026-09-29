-- Lets the new public marketing page (welcome.html) show live pricing
-- to anonymous visitors -- plans/features/plan_features are already
-- non-sensitive public catalog data (per 08_plans_and_features.sql's
-- own comment: "readable by anyone signed in so the upgrade UI can
-- show what each plan unlocks"), just previously scoped to
-- `authenticated` only since nothing pre-signup needed to read them
-- before now.

begin;

drop policy if exists "plans are readable by everyone" on public.plans;
create policy "plans are readable by everyone" on public.plans for select to anon, authenticated using (true);

drop policy if exists "features are readable by everyone" on public.features;
create policy "features are readable by everyone" on public.features for select to anon, authenticated using (true);

drop policy if exists "plan_features are readable by everyone" on public.plan_features;
create policy "plan_features are readable by everyone" on public.plan_features for select to anon, authenticated using (true);

commit;

select pg_notify('pgrst', 'reload schema');
