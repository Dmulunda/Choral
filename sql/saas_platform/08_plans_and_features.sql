-- Plans, features, and entitlement gating.
--
-- Entitlement rule: a tenant on status='trial' has every feature,
-- regardless of plan_id (full access during trial, per spec). Otherwise,
-- entitlements = the union of features on the tenant's current plan_id.
-- A tenant with no plan_id (trial_expired, or never subscribed) has none
-- of the gated features -- base/ungated functionality (everything NOT
-- listed in plan_features) stays available regardless.
--
-- Enforced in two layers, per spec:
--  1. Backend: a RESTRICTIVE policy on each gated table, requiring
--     has_feature('<key>') in addition to the existing tenant_isolation
--     restriction -- so even a direct API call from someone who bypassed
--     the UI still gets blocked. Applied here to VPD Academy's tables as
--     the concrete example (key: 'vpd_academy').
--  2. Frontend: hide/upgrade-prompt in the UI (see js/entitlements.js) --
--     not built here, just the data layer it reads from.

begin;

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  price_cents integer not null default 0,
  billing_interval text not null default 'monthly' check (billing_interval in ('monthly', 'yearly')),
  created_at timestamptz not null default now()
);

create table if not exists public.features (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null
);

create table if not exists public.plan_features (
  plan_id uuid not null references public.plans(id) on delete cascade,
  feature_id uuid not null references public.features(id) on delete cascade,
  primary key (plan_id, feature_id)
);

-- plans/features/plan_features are catalog data (what plans exist, what
-- they include) -- not tenant-scoped, readable by anyone signed in so the
-- upgrade UI can show what each plan unlocks. Only writable directly
-- (service-role/dashboard), same trust boundary as the help-docs
-- `_shared/` folder -- no INSERT/UPDATE/DELETE policy granted.
alter table public.plans enable row level security;
alter table public.features enable row level security;
alter table public.plan_features enable row level security;
create policy "plans are readable by everyone" on public.plans for select to authenticated using (true);
create policy "features are readable by everyone" on public.features for select to authenticated using (true);
create policy "plan_features are readable by everyone" on public.plan_features for select to authenticated using (true);

-- Now that plans exists, attach the real FK tenants.plan_id was missing
-- (it's been a bare placeholder column since 01_schema.sql).
alter table public.tenants add constraint tenants_plan_id_fkey foreign key (plan_id) references public.plans(id) on delete set null;

create or replace function public.has_feature(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (select status from public.tenants where id = public.current_tenant_id()) = 'trial'
    or exists (
      select 1
      from public.tenants t
      join public.plan_features pf on pf.plan_id = t.plan_id
      join public.features f on f.id = pf.feature_id and f.key = p_key
      where t.id = public.current_tenant_id()
    );
$$;

revoke execute on function public.has_feature(text) from public;
grant execute on function public.has_feature(text) to authenticated;

-- Lists the feature keys the caller's tenant currently has -- used by the
-- frontend (js/entitlements.js) to decide what to show/hide without one
-- has_feature() round trip per nav item. Returns every feature key that
-- exists when on trial (full access), matching has_feature()'s own rule.
create or replace function public.get_my_features()
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select key from public.features
  where (select status from public.tenants where id = public.current_tenant_id()) = 'trial'
  union
  select f.key
  from public.tenants t
  join public.plan_features pf on pf.plan_id = t.plan_id
  join public.features f on f.id = pf.feature_id
  where t.id = public.current_tenant_id();
$$;

revoke execute on function public.get_my_features() from public;
grant execute on function public.get_my_features() to authenticated;

-- Seed catalog data.
insert into public.features (key, name) values
  ('vpd_academy', 'VPD Academy (online courses)'),
  ('advanced_reports', 'Advanced attendance/absence reports'),
  ('sms_notifications', 'SMS notifications')
on conflict (key) do nothing;

insert into public.plans (key, name, price_cents, billing_interval) values
  ('basic', 'Basic', 0, 'monthly'),
  ('pro', 'Pro', 2900, 'monthly'),
  ('enterprise', 'Enterprise', 9900, 'monthly')
on conflict (key) do nothing;

insert into public.plan_features (plan_id, feature_id)
select p.id, f.id from public.plans p, public.features f
where (p.key = 'pro' and f.key in ('vpd_academy', 'advanced_reports'))
   or (p.key = 'enterprise' and f.key in ('vpd_academy', 'advanced_reports', 'sms_notifications'))
on conflict do nothing;

-- Backend enforcement example: VPD Academy tables require the
-- 'vpd_academy' feature, layered on top of the existing tenant_isolation
-- restriction (both must pass -- RESTRICTIVE policies AND together).
do $$
declare
  t text;
  academy_tables text[] := array[
    'courses', 'course_modules', 'lessons', 'quizzes', 'quiz_questions',
    'course_enrollments', 'course_approvals', 'lesson_progress', 'course_questions'
  ];
begin
  foreach t in array academy_tables loop
    execute format('drop policy if exists "requires_vpd_academy_feature" on public.%I', t);
    execute format(
      'create policy "requires_vpd_academy_feature" on public.%I as restrictive for all ' ||
      'using (public.has_feature(''vpd_academy'')) with check (public.has_feature(''vpd_academy''))',
      t
    );
  end loop;
end $$;

commit;

select pg_notify('pgrst', 'reload schema');
