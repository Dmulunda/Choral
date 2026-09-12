-- Help / training document: one current PDF per tenant, viewable by any
-- signed-in member of that tenant, replaceable only by that tenant's
-- super_admin. Mirrors rules_documents' versioning shape (old versions
-- kept, not deleted, via is_current) and rulesModal.js's bucket/signed-URL
-- pattern -- see js/components/rulesModal.js.

begin;

create table if not exists public.help_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  storage_path text not null,
  file_name text not null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.profiles(id) on delete set null,
  version integer not null default 1,
  is_current boolean not null default true,
  tenant_id uuid not null default public.current_tenant_id()
);

alter table public.help_documents
  add constraint help_documents_tenant_id_fkey foreign key (tenant_id) references public.tenants(id) on delete restrict;

create index if not exists help_documents_tenant_id_idx on public.help_documents (tenant_id);
create index if not exists help_documents_current_idx on public.help_documents (tenant_id, is_current);

alter table public.help_documents enable row level security;

-- Any signed-in member of the tenant can read; only that tenant's
-- super_admin can insert/update/delete. Tenant scoping itself is enforced
-- by the RESTRICTIVE tenant_isolation policy below, same as every other
-- table -- these two are the permissive layer it ANDs against.
create policy "help documents are readable by tenant members" on public.help_documents
  for select to authenticated using (true);

create policy "help documents are managed by super admin" on public.help_documents
  for all to authenticated using (is_super_admin()) with check (is_super_admin());

create policy "tenant_isolation" on public.help_documents as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- Storage bucket + policies. Path convention: {tenant_id}/{filename} --
-- same folder-per-scope idea as the 'rules' bucket, but the scope here is
-- always the whole tenant (no per-department help docs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('help-docs', 'help-docs', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;

create policy "help docs are readable by tenant members" on storage.objects
  for select to authenticated
  using (bucket_id = 'help-docs' and ((storage.foldername(name))[1])::uuid = (select public.current_tenant_id()));

create policy "help docs are managed by super admin" on storage.objects
  for all to authenticated
  using (bucket_id = 'help-docs' and ((storage.foldername(name))[1])::uuid = (select public.current_tenant_id()) and is_super_admin())
  with check (bucket_id = 'help-docs' and ((storage.foldername(name))[1])::uuid = (select public.current_tenant_id()) and is_super_admin());

commit;

select pg_notify('pgrst', 'reload schema');
