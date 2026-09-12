-- Per-tenant logo branding. Free for every tenant regardless of plan or
-- trial status (per product decision) -- not gated behind has_feature(),
-- unlike VPD Academy in the previous migration. Storage path convention:
-- tenant-logos/{tenant_id}/logo.<ext>.

begin;

alter table public.tenants add column if not exists logo_url text;

-- tenants has no general UPDATE policy (tenant mutation is deliberately
-- privileged -- see 01_schema.sql). Add one now, scoped to the tenant's
-- own super_admin, then use a trigger (same bypass-flag pattern as
-- protect_global_role in 03_signup_rpcs.sql) to keep status/trial_ends_at/
-- plan_id/slug off-limits through this same policy -- only logo_url and
-- name are meant to be self-service.
create policy "tenant admin can update own tenant" on public.tenants
  for update to authenticated
  using (id = (select public.current_tenant_id()) and public.is_super_admin())
  with check (id = (select public.current_tenant_id()) and public.is_super_admin());

create or replace function public.protect_tenant_privileged_columns()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (
    new.status is distinct from old.status
    or new.trial_ends_at is distinct from old.trial_ends_at
    or new.plan_id is distinct from old.plan_id
    or new.slug is distinct from old.slug
  ) and coalesce(current_setting('app.bypass_tenant_column_protection', true), '') <> 'on' then
    raise exception 'Only billing/platform operations can change status, trial_ends_at, plan_id, or slug';
  end if;
  return new;
end;
$function$;

drop trigger if exists protect_tenant_privileged_columns_trigger on public.tenants;
create trigger protect_tenant_privileged_columns_trigger
  before update on public.tenants
  for each row execute function public.protect_tenant_privileged_columns();

-- Storage bucket: public read (the logo needs to render in plain <img>
-- tags throughout the app without a signed-URL round trip), write
-- restricted to that tenant's own super_admin.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tenant-logos', 'tenant-logos', true, 2097152, array['image/png','image/jpeg','image/svg+xml','image/webp'])
on conflict (id) do nothing;

create policy "tenant logos are publicly readable" on storage.objects
  for select
  using (bucket_id = 'tenant-logos');

create policy "tenant admin manages own tenant logo" on storage.objects
  for all to authenticated
  using (bucket_id = 'tenant-logos' and ((storage.foldername(name))[1])::uuid = (select public.current_tenant_id()) and public.is_super_admin())
  with check (bucket_id = 'tenant-logos' and ((storage.foldername(name))[1])::uuid = (select public.current_tenant_id()) and public.is_super_admin());

commit;

select pg_notify('pgrst', 'reload schema');
