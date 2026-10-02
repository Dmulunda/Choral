-- Site Admin training sandbox: one shared, fixed-slug tenant
-- ("site-admin-training") any Site Admin can enter with REAL write
-- access (not the read-only View-As proxy, js/departments.js --
-- that's explicitly the wrong tool here, see its own header comment)
-- to click around and learn the app as an admin or a member of any
-- department, without touching any real church. Reset to empty every
-- 48 hours on a timer -- see purge_training_sandbox() below.
--
-- Reuses profiles.acting_as_tenant_id (sql/034, built for the
-- denomination "acting as another extension" feature) rather than a
-- new column -- current_tenant_id() already re-validates that
-- override live on every call; this just adds a second, independent
-- condition under which it's trusted (is_site_admin() + the fixed
-- training tenant), alongside the existing denomination_admins one.

-- ---- 1. The training tenant itself (idempotent) ----
do $$
declare
  v_id uuid;
begin
  select id into v_id from public.tenants where slug = 'site-admin-training';
  if v_id is null then
    -- Reuses the exact same seeding create_tenant_for_signup() already
    -- gives every real new church (sql/051) -- same 15 departments,
    -- same defaults -- rather than duplicating that insert list.
    v_id := public.create_tenant_for_signup('Site Admin Training', 'site-admin-training');
    -- status/trial_ends_at are protected columns (sql/009) -- bypass,
    -- same flag Stripe billing operations use (sql/015).
    perform set_config('app.bypass_tenant_column_protection', 'on', true);
    update public.tenants set status = 'active', trial_ends_at = null where id = v_id;
  end if;
end $$;

-- ---- 2. current_tenant_id(): trust acting_as_tenant_id for the
-- training tenant too, when the caller is a Site Admin (re-checked
-- live, same as the existing denomination branch) ----
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when t.deleted_at is null then resolved.id else null end
  from (
    select coalesce(
      (
        select p.acting_as_tenant_id
        from public.profiles p
        join public.tenants t_target on t_target.id = p.acting_as_tenant_id
        where p.id = auth.uid()
          and p.acting_as_tenant_id is not null
          and (
            (
              t_target.denomination_id is not null
              and exists (
                select 1 from public.denomination_admins da
                where da.user_id = auth.uid() and da.denomination_id = t_target.denomination_id
              )
            )
            or (
              t_target.slug = 'site-admin-training'
              and public.is_site_admin()
            )
          )
      ),
      (select tenant_id from public.profiles where id = auth.uid())
    ) as id
  ) resolved
  left join public.tenants t on t.id = resolved.id;
$$;

-- ---- 3. Enter / exit ----
CREATE OR REPLACE FUNCTION public.enter_training_sandbox()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
declare
  v_training_id uuid;
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can enter the training sandbox';
  end if;
  select id into v_training_id from public.tenants where slug = 'site-admin-training';
  update public.profiles set acting_as_tenant_id = v_training_id where id = auth.uid();
end;
$$;

CREATE OR REPLACE FUNCTION public.exit_training_sandbox()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  update public.profiles set acting_as_tenant_id = null where id = auth.uid();
end;
$$;

-- ---- 4. Act as admin/member of a department in the sandbox ----
-- A real department_memberships row, not a synthesized override --
-- every existing RLS policy that checks department_memberships.role
-- just works unmodified. Toggling replaces (not adds to) the caller's
-- one row for that department.
CREATE OR REPLACE FUNCTION public.set_training_department_role(p_department_key text, p_role text)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
declare
  v_training_id uuid;
  v_department_id uuid;
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can act in the training sandbox';
  end if;
  if p_role not in ('admin', 'member') then
    raise exception 'role must be admin or member';
  end if;

  select id into v_training_id from public.tenants where slug = 'site-admin-training';
  select id into v_department_id from public.departments
    where tenant_id = v_training_id and key = p_department_key;
  if v_department_id is null then
    raise exception 'Unknown training department: %', p_department_key;
  end if;

  delete from public.department_memberships
    where user_id = auth.uid() and department_id = v_department_id;

  insert into public.department_memberships (user_id, department_id, role, status, tenant_id, approved_at, approved_by)
  values (auth.uid(), v_department_id, p_role::department_role, 'approved', v_training_id, now(), auth.uid());
end;
$$;

-- ---- 5. Reset the sandbox to empty every 48 hours ----
-- Unconditional, not age-gated -- the whole tenant's activity is
-- disposable, so "wipe it clean on a timer" is simpler and more
-- robust than tracking individual rows' ages (and sidesteps the
-- FK-ordering complexity flagged in sql/062's tenant-purge, since
-- these specific tables' child rows already cascade: department_shifts
-- -> department_shift_assignments, service_plans ->
-- service_plan_songs/singers, songs -> service_plan_songs, all
-- ON DELETE CASCADE).
CREATE OR REPLACE FUNCTION public.purge_training_sandbox()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
declare
  v_training_id uuid;
begin
  select id into v_training_id from public.tenants where slug = 'site-admin-training';
  if v_training_id is null then
    return;
  end if;

  delete from public.department_memberships where tenant_id = v_training_id;
  delete from public.department_announcements where tenant_id = v_training_id;
  delete from public.service_plans where tenant_id = v_training_id;
  delete from public.songs where tenant_id = v_training_id;
  delete from public.department_shifts where tenant_id = v_training_id;
  delete from public.department_uniforms where tenant_id = v_training_id;
  delete from public.budget_requests where tenant_id = v_training_id;
end;
$$;

do $$ begin perform cron.unschedule('purge-training-sandbox'); exception when others then null; end $$;
select cron.schedule('purge-training-sandbox', '0 4 */2 * *', 'select public.purge_training_sandbox();');

revoke all on function public.enter_training_sandbox() from public;
revoke all on function public.exit_training_sandbox() from public;
revoke all on function public.set_training_department_role(text, text) from public;
grant execute on function public.enter_training_sandbox() to authenticated;
grant execute on function public.exit_training_sandbox() to authenticated;
grant execute on function public.set_training_department_role(text, text) to authenticated;

select pg_notify('pgrst', 'reload schema');
