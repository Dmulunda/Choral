-- Extends help_documents with per-language docs and a "global default"
-- concept: tenant_id NULL means "shipped by the platform, visible to every
-- tenant" (e.g. the EN/FR training guides), same idea as bible_books being
-- global reference data rather than per-church. Every tenant still sees
-- their own upload (if any) in preference to the global one, per language.
--
-- Safety: WITH CHECK still requires tenant_id = current_tenant_id() -- no
-- authenticated user can ever write a NULL-tenant row through the app,
-- only via direct DB / service-role access. This keeps "who can edit the
-- shared defaults for every tenant" a deliberately narrow, out-of-app path
-- (the spec's own caution about cross-tenant actions needing to be a
-- distinct, audited operation, not a side effect of a normal policy).

begin;

alter table public.help_documents alter column tenant_id drop not null;
alter table public.help_documents alter column tenant_id drop default;
alter table public.help_documents add column if not exists language text not null default 'en' check (language in ('en', 'fr'));

-- Only one "current" doc per (tenant, language) -- coalesce so every NULL
-- (global) row groups together per language too, rather than each being
-- treated as distinct (plain UNIQUE lets multiple NULLs coexist).
drop index if exists help_documents_current_idx;
create unique index help_documents_current_per_tenant_lang_idx
  on public.help_documents (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), language)
  where is_current;

drop policy if exists "tenant_isolation" on public.help_documents;
create policy "tenant_isolation" on public.help_documents as restrictive for all
  using (tenant_id = (select public.current_tenant_id()) or tenant_id is null)
  with check (tenant_id = (select public.current_tenant_id()));

-- Storage: a `_shared/` folder for the global defaults, world-readable
-- (any authenticated user, any tenant), writable only outside the app
-- (no INSERT/UPDATE/DELETE policy granted for it -- service-role or a
-- direct DB/API call bypasses RLS entirely, same trust boundary as above).
create policy "shared help docs are readable by everyone" on storage.objects
  for select to authenticated
  using (bucket_id = 'help-docs' and (storage.foldername(name))[1] = '_shared');

commit;

select pg_notify('pgrst', 'reload schema');
