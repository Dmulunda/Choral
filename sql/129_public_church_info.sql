-- Lets a public, unauthenticated page (prayer.html so far; register.html
-- will reuse this too) show the church's own name/logo at the top.
-- Main already has church_branding's logo_url open to anon via its
-- "readable by everyone" policy, but there's no "name" column there
-- (single-tenant, the name is a static i18n string -- memberCard.
-- churchFullName) -- this RPC is just a stable, explicit read surface
-- for a public page to call, same anon-grant pattern as every other
-- public RPC here, rather than depending on a table policy that
-- exists for a different reason.
create or replace function public.get_public_church_info()
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
stable
as $$
  select jsonb_build_object('logo_url', logo_url)
  from public.church_branding
  where id = true;
$$;

revoke all on function public.get_public_church_info() from public;
grant execute on function public.get_public_church_info() to anon, authenticated;

select pg_notify('pgrst', 'reload schema');
