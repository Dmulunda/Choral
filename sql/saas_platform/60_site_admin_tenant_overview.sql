-- Site Admin "Churches" tab: platform-wide tenant list with basic
-- usage (member/department counts, last active) and Supabase Storage
-- usage attributed back to each tenant. R2 usage (course-video-r2,
-- offering-reports buckets) is NOT covered here -- R2 lives outside
-- Postgres entirely, so that half is a separate Edge Function
-- (site-admin-usage) that lists R2 objects directly via S3 API and
-- merges its numbers with this function's client-side.
--
-- Storage attribution, bucket by bucket (see each bucket's own
-- upload code for the exact path shape this mirrors):
--   tenant-logos, help-docs      -- first path segment IS the tenant id
--   member-photos                -- first segment is a profiles.id -> join
--   uniform-photos, budget-receipts -- first segment is a departments.id -> join
--   course-videos, course-pdfs   -- first segment is a lessons.id -> join
--   church-program-flyers        -- exact match against church_programs.flyer_storage_path
--   song-tracks                  -- substring match against songs.*_track columns
--                                    (those are stored as full public URLs, not raw paths)
-- Anything that doesn't resolve this way (e.g. help-docs' shared
-- "_shared/" prefix, not a real tenant) is counted only in the
-- platform-wide total, never attributed to a specific church.

-- Note: this function is replaced again in 62 (tenant trash) to add
-- deleted_at to its output once that column exists -- keeping this
-- file's own concern (overview + usage) separate from 62's
-- (soft-delete/restore).
DROP FUNCTION IF EXISTS public.list_all_tenants_for_site_admin();
CREATE OR REPLACE FUNCTION public.list_all_tenants_for_site_admin()
 RETURNS TABLE(
   id uuid, name text, slug text, status text, plan_id uuid, created_at timestamptz,
   member_count bigint, department_count bigint,
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
      -- tenant-logos, help-docs: first path segment is the tenant id
      select (split_part(so.name, '/', 1))::uuid as tenant_id, (so.metadata->>'size')::bigint as bytes
      from storage.objects so
      where so.bucket_id in ('tenant-logos', 'help-docs')
        and split_part(so.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

      union all
      -- member-photos: first segment is a profiles.id
      select p.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.profiles p on p.id::text = split_part(so.name, '/', 1)
      where so.bucket_id = 'member-photos'

      union all
      -- uniform-photos, budget-receipts: first segment is a departments.id
      select d.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.departments d on d.id::text = split_part(so.name, '/', 1)
      where so.bucket_id in ('uniform-photos', 'budget-receipts')

      union all
      -- course-videos, course-pdfs: first segment is a lessons.id
      select l.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.lessons l on l.id::text = split_part(so.name, '/', 1)
      where so.bucket_id in ('course-videos', 'course-pdfs')

      union all
      -- church-program-flyers: exact path match
      select cp.tenant_id, (so.metadata->>'size')::bigint
      from storage.objects so
      join public.church_programs cp on cp.flyer_storage_path = so.name
      where so.bucket_id = 'church-program-flyers'

      union all
      -- song-tracks: stored as full public URLs, substring-match the object name
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
    t.id, t.name, t.slug, t.status, t.plan_id, t.created_at,
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

revoke all on function public.list_all_tenants_for_site_admin() from public;
grant execute on function public.list_all_tenants_for_site_admin() to authenticated;

select pg_notify('pgrst', 'reload schema');
