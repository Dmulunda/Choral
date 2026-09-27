-- Fixes a real bug in 34_church_extensions.sql: denomination_admins'
-- own SELECT policy referenced denomination_admins again inside its
-- own USING clause (the "...or denomination_id in (select ... from
-- denomination_admins where user_id = auth.uid())" clause, meant to
-- let peers in the same denomination see each other's rows) -- Postgres
-- detects that as infinite recursion and refuses the query outright.
--
-- js/denominationExtensions.js's loadMyDenominationInfo() queries this
-- table directly on every page load for every signed-in user, so this
-- was firing constantly (silently -- that call doesn't check `error`,
-- so it just meant Global Super Admin/General Overseer/General
-- Secretary status silently failed to load rather than crashing
-- visibly). The "peers" clause was never actually used by any client
-- code (only "my own rows" is ever queried directly) -- removed rather
-- than reworked through a helper function, since nothing needs it.

begin;

drop policy "denomination admins are readable by themselves and their peers" on public.denomination_admins;

create policy "denomination admins are readable by themselves" on public.denomination_admins
  for select using (user_id = auth.uid());

-- Also hardens is_super_admin()/is_pastor_admin()/is_church_secretary(),
-- which joined denomination_admins to tenants on denomination_id (a
-- one-to-many relationship once a denomination has more than one
-- extension) and then filtered by t.id = current_tenant_id() --
-- correct in every case tested, but structurally more fragile than
-- necessary. Rewritten to compare against current_tenant_id()'s own
-- denomination_id directly (a single scalar value, since tenants.id is
-- unique) instead of joining and filtering after the fact.

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
    where da.user_id = auth.uid()
      and da.role = 'global_super_admin'
      and da.denomination_id = (select denomination_id from public.tenants where id = public.current_tenant_id())
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
    where da.user_id = auth.uid()
      and da.role = 'general_overseer'
      and da.denomination_id = (select denomination_id from public.tenants where id = public.current_tenant_id())
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
    where da.user_id = auth.uid()
      and da.role = 'general_secretary'
      and da.denomination_id = (select denomination_id from public.tenants where id = public.current_tenant_id())
  );
$function$;

commit;
