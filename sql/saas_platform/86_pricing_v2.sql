-- Redefines Basic/Pro/Premium per a new authoritative pricing table:
-- lower member caps, two brand-new per-tenant caps (admins,
-- "global admins" = non-super-admin global_role holders), a
-- department-tier split (Basic: 7 core departments only), and four
-- already-built, previously-ungated features (Projection, COP
-- Academy, Flyers, Member Card) becoming plan-gated for the first
-- time. Applies retroactively to every non-trial tenant immediately
-- (by design -- has_feature()/effective_max_*() already compute live
-- off the current plans row + trial bypass, same as every existing
-- gate). Every new cap below only ever blocks NEW growth past a
-- limit, same as every existing cap in this app (create_church_
-- extension, handle_new_user, super_admin_count_limit) -- nothing
-- here retroactively deletes or demotes existing data.

begin;

-- ---- Part A: catalog values ----

alter table public.plans add column if not exists max_admins integer; -- null = unlimited
alter table public.plans add column if not exists max_global_admins integer; -- null = unlimited; non-super-admin global_role holders

update public.plans set max_members = 200, max_extensions = 0, max_super_admins_per_tenant = 1, max_admins = 2, max_global_admins = 0
where key in ('basic', 'basic_yearly');
update public.plans set max_members = 600, max_extensions = 3, max_super_admins_per_tenant = 2, max_admins = 6, max_global_admins = 1
where key in ('pro', 'pro_yearly');
update public.plans set max_members = 3000, max_extensions = 6, max_super_admins_per_tenant = null, max_admins = null, max_global_admins = null
where key in ('premium', 'premium_yearly');

insert into public.features (key, name) values
  ('projection', 'Projection'),
  ('flyers', 'Flyer generator'),
  ('member_card', 'Member ID card'),
  ('all_departments', 'All built-in departments'),
  ('create_departments', 'Create new departments'),
  ('customize_departments', 'Customize departments')
on conflict (key) do nothing;

-- Clean replacement for these 6 new keys only -- doesn't touch
-- vpd_academy's existing basic/pro rows (there are none; it's already
-- premium-only per 39_pricing_tiers.sql) or advanced_reports/
-- sms_notifications (still uncatalogued-to-a-plan, untouched).
delete from public.plan_features pf
using public.plans p, public.features f
where pf.plan_id = p.id and pf.feature_id = f.id
  and p.key in ('basic', 'basic_yearly', 'pro', 'pro_yearly', 'premium', 'premium_yearly')
  and f.key in ('projection', 'flyers', 'member_card', 'all_departments', 'create_departments', 'customize_departments');

insert into public.plan_features (plan_id, feature_id)
select p.id, f.id from public.plans p, public.features f
where (p.key in ('pro', 'pro_yearly') and f.key in ('projection', 'all_departments', 'customize_departments'))
   or (p.key in ('premium', 'premium_yearly') and f.key in ('projection', 'flyers', 'member_card', 'all_departments', 'create_departments', 'customize_departments'));

-- vpd_academy (COP Academy) was previously assigned to 'pro'/'pro_yearly'
-- by 39_pricing_tiers.sql (back when that tier was still called 'max')
-- -- not in this migration's own 6-key delete filter above, so it
-- would otherwise survive untouched. The new pricing table is explicit
-- that COP Academy is Premium-only now; remove it from Pro here.
delete from public.plan_features pf
using public.plans p, public.features f
where pf.plan_id = p.id and pf.feature_id = f.id
  and p.key in ('pro', 'pro_yearly') and f.key = 'vpd_academy';

-- ---- Part B: admin / global-admin caps ----

create or replace function public.effective_max_admins(p_tenant_id uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when (select status from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) = 'trial' then null
    else (select max_admins from public.plans where id = (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)))
  end;
$$;

create or replace function public.effective_max_global_admins(p_tenant_id uuid)
returns integer
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when (select status from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) = 'trial' then null
    else (select max_global_admins from public.plans where id = (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)))
  end;
$$;

revoke all on function public.effective_max_admins(uuid) from public;
grant execute on function public.effective_max_admins(uuid) to authenticated;
revoke all on function public.effective_max_global_admins(uuid) from public;
grant execute on function public.effective_max_global_admins(uuid) to authenticated;

-- Admin-count enforcement itself lives in Part C's combined trigger
-- (enforce_department_tier_and_admin_limits) -- department_memberships
-- needs exactly one before-insert-or-update trigger, not two, and it
-- has to check the department-tier question anyway, so both checks
-- live together there.

-- Global admins: any global_role OTHER than 'super_admin'
-- (pastor_admin/church_secretary/super_viewer), capped separately
-- from the existing super-admin cap/policy (untouched, still its own
-- mechanism). Same restrictive-policy shape as super_admin_count_limit
-- since this is set via the same plain client-side profiles UPDATE.
create or replace function public.can_assign_global_admin(p_tenant_id uuid, p_target_user_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select
    exists (
      select 1 from public.profiles
      where id = p_target_user_id and tenant_id = p_tenant_id
        and global_role is not null and global_role <> 'super_admin'
    )
    or (
      select count(*) from public.profiles
      where tenant_id = p_tenant_id and global_role is not null and global_role <> 'super_admin' and id <> p_target_user_id
    ) < coalesce(public.effective_max_global_admins(p_tenant_id), 2147483647);
$$;

revoke all on function public.can_assign_global_admin(uuid, uuid) from public;
grant execute on function public.can_assign_global_admin(uuid, uuid) to authenticated;

drop policy if exists "global_admin_count_limit" on public.profiles;
create policy "global_admin_count_limit" on public.profiles
  as restrictive for update
  with check (
    global_role is null
    or global_role = 'super_admin'
    or public.can_assign_global_admin(tenant_id, id)
  );

-- ---- Part C: department tier access (Basic: 7 core only) ----

create or replace function public.is_core_department_key(p_key text)
returns boolean
language sql immutable
as $$
  select p_key = any (array['media_tech', 'preaching', 'finance', 'ushers', 'ecodem', 'choir', 'cleaning']);
$$;

grant execute on function public.is_core_department_key(text) to authenticated;

-- Blocks a NEW approved membership in a non-core department when the
-- tenant's plan doesn't include all_departments -- existing
-- memberships (e.g. from before a downgrade) are left untouched, only
-- further growth is blocked, same non-destructive shape as every
-- other cap here. Folded into the SAME trigger as the admin-count
-- check above (one trigger function, both concerns) rather than a
-- second trigger on the same table.
create or replace function public.enforce_department_tier_and_admin_limits()
returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_dept_key text;
  v_max_admins integer;
  v_current_admin_count integer;
  v_was_already_admin boolean;
begin
  if new.status = 'approved' then
    select key into v_dept_key from public.departments where id = new.department_id;
    if v_dept_key is not null and not public.is_core_department_key(v_dept_key)
       and not public.has_feature('all_departments') then
      raise exception 'This church''s plan only includes the core departments -- upgrade to access %', v_dept_key;
    end if;
  end if;

  if new.role = 'admin' and new.status = 'approved' then
    v_was_already_admin := (tg_op = 'UPDATE' and old.role = 'admin' and old.status = 'approved');
    if not v_was_already_admin then
      v_max_admins := public.effective_max_admins(new.tenant_id);
      if v_max_admins is not null then
        select count(distinct user_id) into v_current_admin_count
        from public.department_memberships
        where tenant_id = new.tenant_id and role = 'admin' and status = 'approved' and user_id <> new.user_id;
        if v_current_admin_count >= v_max_admins then
          raise exception 'This church''s plan allows up to % department admin(s) -- upgrade to add more', v_max_admins;
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_department_tier_and_admin_limits_trigger on public.department_memberships;
create trigger enforce_department_tier_and_admin_limits_trigger
  before insert or update on public.department_memberships
  for each row execute function public.enforce_department_tier_and_admin_limits();

-- Create new departments: Premium only (has_feature('create_departments')).
drop policy if exists "super admins create lightweight departments" on public."departments";
create policy "super admins create lightweight departments" on public."departments"
  for insert to authenticated
  with check (is_super_admin() and kind = 'lightweight' and public.has_feature('create_departments'));

commit;

-- ---- Part D: gate Projection and Flyers at the RLS layer ----
-- (separate transaction: these DROP+CREATE restrictive policies on
-- tables with existing live data, kept isolated from Part A-C's DDL
-- for a cleaner rollback boundary if any single statement here needs
-- re-running on its own.)

begin;

drop policy if exists "tenant_isolation" on public.flyers;
create policy "tenant_isolation" on public.flyers as restrictive for all
  using (tenant_id = (select public.current_tenant_id()) and public.has_feature('flyers'))
  with check (tenant_id = (select public.current_tenant_id()) and public.has_feature('flyers'));

drop policy if exists "tenant_isolation" on public."projection_schedule_items";
create policy "tenant_isolation" on public."projection_schedule_items" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()) and public.has_feature('projection'))
  with check (tenant_id = (select public.current_tenant_id()) and public.has_feature('projection'));

drop policy if exists "tenant_isolation" on public."projection_schedules";
create policy "tenant_isolation" on public."projection_schedules" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()) and public.has_feature('projection'))
  with check (tenant_id = (select public.current_tenant_id()) and public.has_feature('projection'));

drop policy if exists "tenant_isolation" on public."projection_settings";
create policy "tenant_isolation" on public."projection_settings" as restrictive for all
  using (tenant_id = (select public.current_tenant_id()) and public.has_feature('projection'))
  with check (tenant_id = (select public.current_tenant_id()) and public.has_feature('projection'));

drop policy if exists "tenant_isolation" on public.projection_themes;
create policy "tenant_isolation" on public.projection_themes as restrictive for all
  using (tenant_id = current_tenant_id() and public.has_feature('projection'))
  with check (tenant_id = current_tenant_id() and public.has_feature('projection'));

commit;

select pg_notify('pgrst', 'reload schema');
