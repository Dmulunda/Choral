-- Church Extensions RPCs.

begin;

-- Adds a new extension under the caller's denomination. The FIRST call
-- from a given tenant auto-creates the denomination (naming it
-- p_denomination_name if given, otherwise reusing the tenant's own
-- name) and makes the caller its global_super_admin -- every call
-- after that requires the caller to already hold global_super_admin
-- for that specific denomination (not just be "a" Super Admin
-- somewhere unrelated). Reuses create_tenant_for_signup() entirely for
-- the actual tenant row + default department seeding, so there's only
-- one place that logic lives.
create or replace function public.create_church_extension(p_name text, p_slug text, p_denomination_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_home_tenant_id uuid;
  v_denomination_id uuid;
  v_new_tenant_id uuid;
  v_is_home_super_admin boolean;
begin
  select tenant_id, (global_role = 'super_admin')
    into v_home_tenant_id, v_is_home_super_admin
    from public.profiles where id = auth.uid();

  if v_home_tenant_id is null then
    raise exception 'No tenant found for this account';
  end if;

  select denomination_id into v_denomination_id from public.tenants where id = v_home_tenant_id;

  if v_denomination_id is null then
    if not coalesce(v_is_home_super_admin, false) then
      raise exception 'Only your church''s Super Admin can start adding extensions';
    end if;

    insert into public.denominations (name)
    values (coalesce(nullif(trim(p_denomination_name), ''), (select name from public.tenants where id = v_home_tenant_id)))
    returning id into v_denomination_id;

    update public.tenants set denomination_id = v_denomination_id where id = v_home_tenant_id;

    insert into public.denomination_admins (user_id, denomination_id, role)
    values (auth.uid(), v_denomination_id, 'global_super_admin')
    on conflict (user_id, denomination_id) do nothing;
  else
    if not exists (
      select 1 from public.denomination_admins
      where user_id = auth.uid() and denomination_id = v_denomination_id and role = 'global_super_admin'
    ) then
      raise exception 'Only a Global Super Admin of this denomination can add another extension';
    end if;
  end if;

  v_new_tenant_id := public.create_tenant_for_signup(p_name, p_slug);
  update public.tenants set denomination_id = v_denomination_id where id = v_new_tenant_id;

  return v_new_tenant_id;
end;
$$;

-- Grants an EXISTING denomination_admins holder's role to someone else
-- (e.g. the Global Super Admin appointing a General Overseer/Secretary,
-- or a second Global Super Admin). Caller must already be
-- global_super_admin for that denomination.
create or replace function public.grant_denomination_role(p_user_id uuid, p_denomination_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_role not in ('global_super_admin', 'general_overseer', 'general_secretary') then
    raise exception 'Invalid role';
  end if;
  if not exists (
    select 1 from public.denomination_admins
    where user_id = auth.uid() and denomination_id = p_denomination_id and role = 'global_super_admin'
  ) then
    raise exception 'Only a Global Super Admin of this denomination can grant this';
  end if;

  insert into public.denomination_admins (user_id, denomination_id, role)
  values (p_user_id, p_denomination_id, p_role)
  on conflict (user_id, denomination_id) do update set role = excluded.role;
end;
$$;

-- Switches which extension the caller's own tenant-scoped queries
-- resolve to (see current_tenant_id() in 34_church_extensions.sql) --
-- re-verifies denomination_admins membership itself rather than
-- trusting that the caller already has it some other way.
create or replace function public.set_acting_as_tenant(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target_denomination_id uuid;
begin
  select denomination_id into v_target_denomination_id from public.tenants where id = p_tenant_id;
  if v_target_denomination_id is null then
    raise exception 'That extension is not part of a denomination';
  end if;
  if not exists (
    select 1 from public.denomination_admins where user_id = auth.uid() and denomination_id = v_target_denomination_id
  ) then
    raise exception 'You do not have cross-extension access to this denomination';
  end if;

  update public.profiles set acting_as_tenant_id = p_tenant_id where id = auth.uid();
end;
$$;

create or replace function public.clear_acting_as_tenant()
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.profiles set acting_as_tenant_id = null where id = auth.uid();
$$;

-- Every extension across every denomination the caller holds a
-- denomination_admins row for, plus which one (if any) they're
-- currently acting as -- powers the switcher UI without a
-- client-side cross-tenant query (which RLS would block anyway).
create or replace function public.list_my_denomination_extensions()
returns table(tenant_id uuid, name text, slug text, is_acting_as boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.name, t.slug, (t.id = (select p.acting_as_tenant_id from public.profiles p where p.id = auth.uid()))
  from public.tenants t
  where t.denomination_id in (select denomination_id from public.denomination_admins where user_id = auth.uid())
  order by t.name;
$$;

revoke all on function public.create_church_extension(text, text, text) from public;
grant execute on function public.create_church_extension(text, text, text) to authenticated;

revoke all on function public.grant_denomination_role(uuid, uuid, text) from public;
grant execute on function public.grant_denomination_role(uuid, uuid, text) to authenticated;

revoke all on function public.set_acting_as_tenant(uuid) from public;
grant execute on function public.set_acting_as_tenant(uuid) to authenticated;

revoke all on function public.clear_acting_as_tenant() from public;
grant execute on function public.clear_acting_as_tenant() to authenticated;

revoke all on function public.list_my_denomination_extensions() from public;
grant execute on function public.list_my_denomination_extensions() to authenticated;

commit;
