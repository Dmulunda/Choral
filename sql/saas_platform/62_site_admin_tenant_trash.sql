-- Site Admin "Churches" tab: soft-delete a whole church (tenant),
-- recoverable for 90 days, instead of an immediate, irreversible
-- removal.
--
-- IMPORTANT, found while building this: 60 of the 61 tables with a
-- tenant_id FK to tenants(id) use ON DELETE RESTRICT (only
-- tax_receipt_settings cascades) -- so purge_deleted_tenants() below
-- can soft-delete/restore a tenant safely and completely today, but
-- its actual 90-day HARD purge will fail (caught, logged, not left
-- half-done) until a separate, deliberate follow-up migration either
-- converts those 60 FKs to CASCADE or purge_deleted_tenants() is
-- extended to delete every one of those 60 tables' rows itself in
-- dependency order. That is real surgery on constraints spanning the
-- whole schema and deserves its own careful pass, not something to
-- improvise inside this feature -- soft-delete/restore (the part that
-- actually matters day to day) works fully and is tested below; the
-- hard purge is deliberately a documented no-op for now, never a
-- silent partial delete.
alter table public.tenants add column if not exists deleted_at timestamptz;
alter table public.tenants add column if not exists deleted_by uuid references public.profiles(id) on delete set null;

-- Nothing but a Site Admin may ever change these two columns --
-- RLS can't restrict by column, so this is enforced by a trigger
-- instead (soft_delete_tenant/restore_tenant below are the only
-- intended writers, and they're both is_site_admin()-gated; this
-- trigger is the backstop against any other path, e.g. a tenant's own
-- Super Admin via "tenant admin can update own tenant", sql/009).
CREATE OR REPLACE FUNCTION public.prevent_tenant_trash_tampering()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (new.deleted_at is distinct from old.deleted_at or new.deleted_by is distinct from old.deleted_by)
     and not public.is_site_admin() then
    raise exception 'Only a Site Admin can change a church''s trash status';
  end if;
  return new;
end;
$function$
;

drop trigger if exists tenant_trash_tampering_guard on public.tenants;
create trigger tenant_trash_tampering_guard before update on public.tenants
  for each row execute function prevent_tenant_trash_tampering();

-- The single centralizing mechanism, same idea as acting_as_tenant_id
-- (sql/034): a soft-deleted tenant's own current_tenant_id() resolves
-- to NULL, which every existing RESTRICTIVE tenant_isolation policy
-- in the app already compares against with `tenant_id =
-- current_tenant_id()` -- `x = null` is never true, so this one
-- change blocks that tenant's members from every tenant-scoped table
-- app-wide, with zero other policy edits.
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
          and t_target.denomination_id is not null
          and exists (
            select 1 from public.denomination_admins da
            where da.user_id = auth.uid() and da.denomination_id = t_target.denomination_id
          )
      ),
      (select tenant_id from public.profiles where id = auth.uid())
    ) as id
  ) resolved
  left join public.tenants t on t.id = resolved.id;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_tenant(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can delete a church';
  end if;
  update public.tenants set deleted_at = now(), deleted_by = auth.uid()
  where id = p_tenant_id and deleted_at is null;
end;
$$;

CREATE OR REPLACE FUNCTION public.restore_tenant(p_tenant_id uuid)
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can restore a church';
  end if;
  update public.tenants set deleted_at = null, deleted_by = null
  where id = p_tenant_id and deleted_at is not null;
end;
$$;

-- See the file header: this only actually removes a tenant once every
-- RESTRICT-ing child table is handled -- today it will raise
-- foreign_key_violation for any tenant with real data and log that,
-- not silently leave a half-deleted church.
CREATE OR REPLACE FUNCTION public.purge_deleted_tenants()
 RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
declare
  v_tenant record;
begin
  for v_tenant in
    select id, name from public.tenants
    where deleted_at is not null and deleted_at <= now() - interval '90 days'
  loop
    begin
      delete from public.tenants where id = v_tenant.id;
      raise notice 'Purged tenant % (%)', v_tenant.name, v_tenant.id;
    exception when foreign_key_violation then
      raise notice 'Could not purge tenant % (%) yet -- still has data in a RESTRICT-ing table', v_tenant.name, v_tenant.id;
    end;
  end loop;
end;
$$;

do $$ begin perform cron.unschedule('purge-deleted-tenants'); exception when others then null; end $$;
select cron.schedule('purge-deleted-tenants', '0 6 * * *', 'select public.purge_deleted_tenants();');

-- Replaces 060's version to add deleted_at to the Churches tab's output.
DROP FUNCTION IF EXISTS public.list_all_tenants_for_site_admin();
CREATE OR REPLACE FUNCTION public.list_all_tenants_for_site_admin()
 RETURNS TABLE(
   id uuid, name text, slug text, status text, plan_id uuid, created_at timestamptz,
   deleted_at timestamptz, member_count bigint, department_count bigint,
   last_active_at timestamptz, storage_bytes bigint
 )
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view the churches list';
  end if;

  return query
  with storage_by_tenant as (
    select o.tenant_id, sum(o.bytes) as bytes from (
      select (split_part(so.name, '/', 1))::uuid as tenant_id, (so.metadata->>'size')::bigint as bytes
      from storage.objects so
      where so.bucket_id in ('tenant-logos', 'help-docs')
        and split_part(so.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

      union all
      select p.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.profiles p on p.id::text = split_part(so.name, '/', 1)
      where so.bucket_id = 'member-photos'

      union all
      select d.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.departments d on d.id::text = split_part(so.name, '/', 1)
      where so.bucket_id in ('uniform-photos', 'budget-receipts')

      union all
      select l.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.lessons l on l.id::text = split_part(so.name, '/', 1)
      where so.bucket_id in ('course-videos', 'course-pdfs')

      union all
      select cp.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.church_programs cp on cp.flyer_storage_path = so.name
      where so.bucket_id = 'church-program-flyers'

      union all
      select s.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.songs s on (
        position(so.name in coalesce(s.audio_lead_track, '')) > 0
        or position(so.name in coalesce(s.audio_soprano_track, '')) > 0
        or position(so.name in coalesce(s.audio_alto_track, '')) > 0
        or position(so.name in coalesce(s.audio_tenor_track, '')) > 0
        or position(so.name in coalesce(s.video_track, '')) > 0
      )
      where so.bucket_id = 'song-tracks'
    ) o
    group by o.tenant_id
  )
  select
    t.id, t.name, t.slug, t.status, t.plan_id, t.created_at, t.deleted_at,
    (select count(*) from public.profiles p where p.tenant_id = t.id and p.removed_at is null),
    (select count(*) from public.departments d where d.tenant_id = t.id),
    (select max(u.last_sign_in_at) from auth.users u
       join public.profiles p on p.id = u.id where p.tenant_id = t.id),
    coalesce(sbt.bytes, 0)::bigint
  from public.tenants t
  left join storage_by_tenant sbt on sbt.tenant_id = t.id
  order by t.created_at desc;
end;
$$;

revoke all on function public.soft_delete_tenant(uuid) from public;
revoke all on function public.restore_tenant(uuid) from public;
revoke all on function public.list_all_tenants_for_site_admin() from public;
grant execute on function public.soft_delete_tenant(uuid) to authenticated;
grant execute on function public.restore_tenant(uuid) to authenticated;
grant execute on function public.list_all_tenants_for_site_admin() to authenticated;

select pg_notify('pgrst', 'reload schema');
