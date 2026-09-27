-- Church Extensions: lets several independent tenants ("VPD Ottawa",
-- "VPD Gatineau", "VPD Kinshasa") be grouped under one denomination,
-- plus three new roles that span every extension of a denomination --
-- global_super_admin, general_overseer (= pastor_admin everywhere),
-- general_secretary (= church_secretary everywhere) -- with full real
-- access, not just a read-only view. Regular members are unaffected:
-- they still belong to exactly one tenant/extension, same as always.
--
-- The key mechanism: current_tenant_id() and the three role-check
-- functions (is_super_admin/is_pastor_admin/is_church_secretary) are
-- the ONLY functions nearly every RLS policy and admin-gated feature
-- in this app calls. Redefining just these few to recognize a
-- verified, explicit "acting as this other extension" override
-- (profiles.acting_as_tenant_id, re-validated against
-- denomination_admins on every single call, never trusted blindly)
-- cascades correctly through the entire existing app with zero
-- per-table policy edits and zero per-feature code changes.

begin;

create table public.denominations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.tenants add column denomination_id uuid references public.denominations(id);

-- A person keeps exactly one home profiles row/tenant (unchanged) --
-- this is what grants them ADDITIONAL cross-extension reach, checked
-- live every time, never baked into their one profile.
create table public.denomination_admins (
  user_id uuid not null references public.profiles(id) on delete cascade,
  denomination_id uuid not null references public.denominations(id) on delete cascade,
  role text not null check (role in ('global_super_admin', 'general_overseer', 'general_secretary')),
  created_at timestamptz not null default now(),
  primary key (user_id, denomination_id)
);

-- When set (and only while the caller still actually holds a matching
-- denomination_admins row for that tenant's denomination -- re-checked
-- every time in current_tenant_id() below, not trusted blindly), this
-- is the tenant the app behaves as for that person, until they switch
-- back or pick another one.
alter table public.profiles add column acting_as_tenant_id uuid references public.tenants(id);

alter table public.denominations enable row level security;
alter table public.denomination_admins enable row level security;

-- Denominations/denomination_admins have no tenant_id of their own
-- (they sit ABOVE the tenant level) -- deliberately not gated by the
-- usual tenant_isolation pattern; visibility here is who's actually
-- listed, not which tenant is currently active.
create policy "denominations are readable by their own admins" on public.denominations
  for select using (
    exists (select 1 from public.denomination_admins da where da.denomination_id = denominations.id and da.user_id = auth.uid())
    or exists (select 1 from public.tenants t where t.denomination_id = denominations.id and t.id = (select public.current_tenant_id()))
  );

create policy "denomination admins are readable by themselves and their peers" on public.denomination_admins
  for select using (
    user_id = auth.uid()
    or denomination_id in (select denomination_id from public.denomination_admins where user_id = auth.uid())
  );

-- Every write to both tables goes through the RPCs in
-- 35_church_extensions_rpcs.sql (SECURITY DEFINER, bypasses RLS) --
-- no direct insert/update/delete policy needed on either table.

-- ---- The three function changes ----

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select p.acting_as_tenant_id
      from public.profiles p
      join public.tenants t_target on t_target.id = p.acting_as_tenant_id
      where p.id = auth.uid()
        and p.acting_as_tenant_id is not null
        and t_target.denomination_id is not null
        and exists (
          select 1 from public.denomination_admins da
          where da.user_id = auth.uid() and da.denomination_id = t_target.denomination_id
        )
    ),
    (select tenant_id from public.profiles where id = auth.uid())
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles where id = auth.uid() and global_role = 'super_admin'
  )
  or exists (
    select 1 from public.denomination_admins da
    join public.tenants t on t.denomination_id = da.denomination_id
    where da.user_id = auth.uid() and da.role = 'global_super_admin' and t.id = (select public.current_tenant_id())
  );
$function$;

create or replace function public.is_pastor_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles where id = auth.uid() and global_role = 'pastor_admin'
  )
  or exists (
    select 1 from public.denomination_admins da
    join public.tenants t on t.denomination_id = da.denomination_id
    where da.user_id = auth.uid() and da.role = 'general_overseer' and t.id = (select public.current_tenant_id())
  );
$function$;

create or replace function public.is_church_secretary()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles where id = auth.uid() and global_role = 'church_secretary'
  )
  or exists (
    select 1 from public.denomination_admins da
    join public.tenants t on t.denomination_id = da.denomination_id
    where da.user_id = auth.uid() and da.role = 'general_secretary' and t.id = (select public.current_tenant_id())
  );
$function$;

commit;
