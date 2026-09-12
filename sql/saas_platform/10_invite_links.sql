-- Invite links: a church's `slug` doubles as its invite code
-- (?join=<slug> in the app URL). allow_self_signup is a per-tenant,
-- self-service toggle (admin-editable through the same "tenant admin can
-- update own tenant" policy as logo_url -- NOT added to
-- protect_tenant_privileged_columns's blocked-columns list, since unlike
-- status/plan_id/trial_ends_at this one really is meant to be self-service).
--
-- get_tenant_by_slug() is the one place an anonymous (pre-auth) visitor
-- can read anything about a tenant -- deliberately minimal columns, no
-- status/trial_ends_at/plan_id, so an invite link can't be used to probe
-- a church's billing state.

begin;

alter table public.tenants add column if not exists allow_self_signup boolean not null default true;

create or replace function public.get_tenant_by_slug(p_slug text)
returns table(id uuid, name text, slug text, allow_self_signup boolean)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.id, t.name, t.slug, t.allow_self_signup
  from public.tenants t
  where t.slug = p_slug;
$$;

revoke execute on function public.get_tenant_by_slug(text) from public;
grant execute on function public.get_tenant_by_slug(text) to anon, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
