-- Replaces the old Basic/Pro/Enterprise catalog with the new
-- Pro/Max/Premium tiers, and adds real enforcement for the numeric
-- caps they introduce (extension count, super admins per tenant,
-- total members) -- the old plan model only ever had simple on/off
-- features (has_feature()), nothing that counts rows against a limit.
--
-- Stripe: stripe_price_id is left null for the three new plans --
-- no real Stripe Products exist for them yet. plansModal.js already
-- only shows an "Upgrade" button when stripe_price_id is set (same
-- rule Basic has always used), so they display correctly as
-- informational-only until real price IDs are added later.
--
-- Storage (storage_gb) is stored on the plan for display purposes but
-- NOT enforced yet -- doing that properly means instrumenting the
-- course-video-r2 edge function to track bytes actually stored in R2,
-- which is a separate, larger piece of work.

begin;

alter table public.plans add column if not exists max_extensions integer; -- null = unlimited
alter table public.plans add column if not exists max_super_admins_per_tenant integer; -- null = unlimited
alter table public.plans add column if not exists max_members integer; -- null = unlimited
alter table public.plans add column if not exists storage_gb integer; -- null = unlimited; display only for now, see header comment

-- The tenant that first became a denomination (i.e. the one that was
-- an ordinary single church before its Super Admin added a first
-- extension) -- its plan is what governs every limit for the whole
-- denomination (extension count, total members): the pricing is "one
-- subscription covers the main church + its extensions", not one
-- subscription per extension. Set once, in create_church_extension()'s
-- bootstrap branch, never changed after.
alter table public.denominations add column if not exists owner_tenant_id uuid references public.tenants(id);
update public.denominations d set owner_tenant_id = (
  select t.id from public.tenants t where t.denomination_id = d.id order by t.name limit 1
) where owner_tenant_id is null;

-- Update the catalog: 'pro' repriced/re-limited in place, 'enterprise'
-- renamed to 'premium', 'max' added new. 'basic' (the $0 "no active
-- subscription" placeholder) is untouched -- it isn't part of this
-- pricing at all, same as before.
update public.plans set
  name = 'Pro', price_cents = 5999,
  max_extensions = 0, max_super_admins_per_tenant = 2, max_members = 250, storage_gb = null
where key = 'pro';

update public.plans set
  key = 'premium', name = 'Premium', price_cents = 19999,
  max_extensions = null, max_super_admins_per_tenant = null, max_members = null, storage_gb = 200
where key = 'enterprise';

insert into public.plans (key, name, price_cents, billing_interval, max_extensions, max_super_admins_per_tenant, max_members, storage_gb)
values ('max', 'Max', 9999, 'monthly', 5, 2, 700, 50)
on conflict (key) do update set
  name = excluded.name, price_cents = excluded.price_cents,
  max_extensions = excluded.max_extensions, max_super_admins_per_tenant = excluded.max_super_admins_per_tenant,
  max_members = excluded.max_members, storage_gb = excluded.storage_gb;

-- Feature mapping is a clean replacement, not an addition: the new
-- pricing text is a full redefinition of what each tier includes, not
-- a superset of the old one (Pro no longer gets vpd_academy the way
-- the old 'pro' did). advanced_reports/sms_notifications are left
-- catalogued but unassigned to any plan -- not mentioned in the new
-- pricing, available to wire up again later without re-inventing them.
delete from public.plan_features pf using public.plans p
where pf.plan_id = p.id and p.key in ('pro', 'max', 'premium');

insert into public.plan_features (plan_id, feature_id)
select p.id, f.id from public.plans p, public.features f
where p.key in ('max', 'premium') and f.key = 'vpd_academy';

-- Resolves the ONE tenant whose subscription actually governs a given
-- tenant's limits: itself normally, or -- once it's an extension of a
-- denomination -- always the denomination's owner tenant, regardless
-- of which specific extension is being checked. This is what makes "2
-- super admins per extension" and "up to 5 extensions"/"up to 700
-- members" work off ONE subscription instead of needing one per
-- extension, and keeps a fresh extension's own always-trial status
-- (create_tenant_for_signup gives every new tenant one) from
-- overriding the denomination's real plan.
create or replace function public.effective_governing_tenant_id(p_tenant_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select d.owner_tenant_id
      from public.tenants t
      join public.denominations d on d.id = t.denomination_id
      where t.id = p_tenant_id
    ),
    p_tenant_id
  );
$$;

revoke all on function public.effective_governing_tenant_id(uuid) from public;
grant execute on function public.effective_governing_tenant_id(uuid) to authenticated;

-- Trial tenants get full access everywhere else in this app
-- (has_feature()'s own rule) -- these three mirror that for the new
-- numeric caps, each returning null (unlimited) during the governing
-- tenant's trial, otherwise reading straight off its plan.
create or replace function public.effective_max_extensions(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (select status from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) = 'trial' then null
    else (select max_extensions from public.plans where id = (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)))
  end;
$$;

create or replace function public.effective_max_super_admins_per_tenant(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (select status from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) = 'trial' then null
    else (select max_super_admins_per_tenant from public.plans where id = (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)))
  end;
$$;

create or replace function public.effective_max_members(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when (select status from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)) = 'trial' then null
    else (select max_members from public.plans where id = (select plan_id from public.tenants where id = public.effective_governing_tenant_id(p_tenant_id)))
  end;
$$;

revoke all on function public.effective_max_extensions(uuid) from public;
grant execute on function public.effective_max_extensions(uuid) to authenticated;
revoke all on function public.effective_max_super_admins_per_tenant(uuid) from public;
grant execute on function public.effective_max_super_admins_per_tenant(uuid) to authenticated;
revoke all on function public.effective_max_members(uuid) from public;
grant execute on function public.effective_max_members(uuid) to authenticated;

-- Member count is denomination-wide once a tenant has one (matches
-- "700 members/users" reading as one combined cap across the main
-- church and its extensions, not 700 per extension) -- otherwise just
-- that tenant's own active (not removed/deleted) member count.
create or replace function public.member_count_for_tenant_scope(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- "in (select ... union select p_tenant_id)", NOT "= coalesce((select
  -- ...), p_tenant_id)" -- the inner select can return several rows
  -- once a denomination has several extensions, and a scalar coalesce
  -- around a multi-row subquery is exactly the "more than one row
  -- returned by a subquery used as an expression" bug fixed earlier in
  -- this same feature (see 38_fix_is_admin_cross_tenant_departments.sql).
  select count(*)::int
  from public.profiles p
  where p.removed_at is null
    and p.tenant_id in (
      select t2.id from public.tenants t2
      where t2.denomination_id = (select denomination_id from public.tenants where id = p_tenant_id)
      union
      select p_tenant_id
    );
$$;

revoke all on function public.member_count_for_tenant_scope(uuid) from public;
grant execute on function public.member_count_for_tenant_scope(uuid) to authenticated;

-- Super-admin cap enforcement. Assigning global_role = 'super_admin'
-- currently happens via a plain client-side `profiles` UPDATE
-- (userEditModal.js), not a dedicated RPC -- so the only place left to
-- enforce this is a RESTRICTIVE policy on the table itself. True if
-- the target is ALREADY a super_admin in that tenant (a no-op re-save,
-- never blocked) or the tenant's current super_admin count is still
-- under its plan's cap. SECURITY DEFINER so this can safely query
-- profiles/tenants/plans itself without re-triggering RLS on the very
-- table the policy sits on (the same recursion class of bug fixed for
-- denomination_admins earlier in this feature).
create or replace function public.can_assign_super_admin(p_tenant_id uuid, p_target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    exists (select 1 from public.profiles where id = p_target_user_id and global_role = 'super_admin')
    or (
      select count(*) from public.profiles
      where tenant_id = p_tenant_id and global_role = 'super_admin' and id <> p_target_user_id
    ) < coalesce(public.effective_max_super_admins_per_tenant(p_tenant_id), 2147483647);
$$;

revoke all on function public.can_assign_super_admin(uuid, uuid) from public;
grant execute on function public.can_assign_super_admin(uuid, uuid) to authenticated;

drop policy if exists "super_admin_count_limit" on public.profiles;
create policy "super_admin_count_limit" on public.profiles
  as restrictive for update
  with check (
    global_role is distinct from 'super_admin'
    or public.can_assign_super_admin(tenant_id, id)
  );

-- Extension-count cap + recording who the denomination's owner is,
-- both inside create_church_extension() itself (the bootstrap branch
-- is the only place owner_tenant_id ever gets set).
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
  v_owner_tenant_id uuid;
  v_max_extensions integer;
  v_current_extension_count integer;
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

    insert into public.denominations (name, owner_tenant_id)
    values (coalesce(nullif(trim(p_denomination_name), ''), (select name from public.tenants where id = v_home_tenant_id)), v_home_tenant_id)
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

  select owner_tenant_id into v_owner_tenant_id from public.denominations where id = v_denomination_id;
  v_max_extensions := public.effective_max_extensions(v_owner_tenant_id);
  if v_max_extensions is not null then
    select count(*) into v_current_extension_count
    from public.tenants where denomination_id = v_denomination_id and id <> v_owner_tenant_id;

    if v_current_extension_count >= v_max_extensions then
      raise exception 'Your plan allows up to % church extension(s) -- upgrade to add more', v_max_extensions;
    end if;
  end if;

  v_new_tenant_id := public.create_tenant_for_signup(p_name, p_slug);
  update public.tenants set denomination_id = v_denomination_id where id = v_new_tenant_id;

  return v_new_tenant_id;
end;
$$;

-- Member cap enforcement, at the one place every new member -- however
-- they signed up (admin invite link or public join link) -- gets their
-- profiles row created. Raising here aborts the whole auth.users
-- insert transactionally, so the signup itself fails cleanly rather
-- than leaving an orphaned auth user with no profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_new_tenant_id uuid;
  v_max_members integer;
begin
  v_new_tenant_id := (new.raw_user_meta_data->>'tenant_id')::uuid;
  v_max_members := public.effective_max_members(v_new_tenant_id);

  if v_max_members is not null and public.member_count_for_tenant_scope(v_new_tenant_id) >= v_max_members then
    raise exception 'This church has reached its plan''s member limit -- upgrade to add more members';
  end if;

  insert into public.profiles (id, full_name, role, tenant_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'singer',
    v_new_tenant_id
  );

  insert into public.profile_emails (id, email, tenant_id)
  values (new.id, new.email, v_new_tenant_id);

  return new;
end;
$function$;

commit;

select pg_notify('pgrst', 'reload schema');
