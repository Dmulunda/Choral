-- Storage buckets, storage policies, and the auth.users -> profiles trigger.
-- These live in schemas (storage, auth) that every new Supabase project already
-- has by default -- but the specific buckets/policies/trigger below are this
-- project's own customization on top of those defaults, and are NOT copied by
-- anything else in this directory. Apply after generated_schema.sql.

begin;

-- ---- buckets ----
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('church-program-flyers', 'church-program-flyers', false, null, null)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-pdfs', 'course-pdfs', false, null, null)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('course-videos', 'course-videos', false, null, null)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('member-photos', 'member-photos', false, null, null)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('projection-media', 'projection-media', true, null, null)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rules', 'rules', false, null, null)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('song-tracks', 'song-tracks', true, null, null)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('uniform-photos', 'uniform-photos', false, null, null)
on conflict (id) do nothing;

-- ---- storage policies ----
create policy "admins can delete song tracks" on storage."objects" for delete to authenticated using (((bucket_id = 'song-tracks'::text) AND is_admin()));
create policy "admins can replace song tracks" on storage."objects" for update to authenticated using (((bucket_id = 'song-tracks'::text) AND is_admin()));
create policy "admins can upload song tracks" on storage."objects" for insert to authenticated with check (((bucket_id = 'song-tracks'::text) AND is_admin()));
create policy "church program flyers are managed by department admins" on storage."objects" for all to authenticated using (((bucket_id = 'church-program-flyers'::text) AND (is_super_admin() OR can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'church_program'::text)))))) with check (((bucket_id = 'church-program-flyers'::text) AND (is_super_admin() OR can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'church_program'::text))))));
create policy "church program flyers are readable by authenticated users" on storage."objects" for select to authenticated using ((bucket_id = 'church-program-flyers'::text));
create policy "course pdfs are managed by school admins" on storage."objects" for all to authenticated using (((bucket_id = 'course-pdfs'::text) AND is_school_admin())) with check (((bucket_id = 'course-pdfs'::text) AND is_school_admin()));
create policy "course pdfs are readable if course is readable" on storage."objects" for select to authenticated using (((bucket_id = 'course-pdfs'::text) AND (EXISTS ( SELECT 1
   FROM (lessons l
     JOIN course_modules m ON ((m.id = l.module_id)))
  WHERE ((l.pdf_storage_path = objects.name) AND has_approved_enrollment(m.course_id))))));
create policy "course videos are managed by school admins" on storage."objects" for all to authenticated using (((bucket_id = 'course-videos'::text) AND is_school_admin())) with check (((bucket_id = 'course-videos'::text) AND is_school_admin()));
create policy "course videos are readable if course is readable" on storage."objects" for select to authenticated using (((bucket_id = 'course-videos'::text) AND (EXISTS ( SELECT 1
   FROM (lessons l
     JOIN course_modules m ON ((m.id = l.module_id)))
  WHERE ((l.video_storage_path = objects.name) AND has_approved_enrollment(m.course_id))))));
create policy "media tech manages projection media" on storage."objects" for all to authenticated using (((bucket_id = 'projection-media'::text) AND (is_super_admin() OR can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text)))))) with check (((bucket_id = 'projection-media'::text) AND (is_super_admin() OR can_write_department(( SELECT departments.id
   FROM departments
  WHERE (departments.key = 'media_tech'::text))))));
create policy "member photos are managed by the member or their admins" on storage."objects" for all to authenticated using (((bucket_id = 'member-photos'::text) AND ((((storage.foldername(name))[1])::uuid = auth.uid()) OR is_pastoral_team() OR (EXISTS ( SELECT 1
   FROM department_memberships dm
  WHERE ((dm.user_id = ((storage.foldername(objects.name))[1])::uuid) AND (dm.status = 'approved'::membership_status) AND can_write_department(dm.department_id))))))) with check (((bucket_id = 'member-photos'::text) AND ((((storage.foldername(name))[1])::uuid = auth.uid()) OR is_pastoral_team() OR (EXISTS ( SELECT 1
   FROM department_memberships dm
  WHERE ((dm.user_id = ((storage.foldername(objects.name))[1])::uuid) AND (dm.status = 'approved'::membership_status) AND can_write_department(dm.department_id)))))));
create policy "projection media is publicly readable" on storage."objects" for select using ((bucket_id = 'projection-media'::text));
create policy "rules files are deleted by those with write access" on storage."objects" for delete to authenticated using (((bucket_id = 'rules'::text) AND ((((storage.foldername(name))[1] = 'church'::text) AND is_super_admin()) OR (((storage.foldername(name))[1] ~~ 'dept-%'::text) AND (is_super_admin() OR can_write_department((SUBSTRING((storage.foldername(name))[1] FROM 6))::uuid))))));
create policy "rules files are readable by those with access" on storage."objects" for select to authenticated using (((bucket_id = 'rules'::text) AND (((storage.foldername(name))[1] = 'church'::text) OR can_read_department((SUBSTRING((storage.foldername(name))[1] FROM 6))::uuid))));
create policy "rules files are replaced by those with write access" on storage."objects" for update to authenticated using (((bucket_id = 'rules'::text) AND ((((storage.foldername(name))[1] = 'church'::text) AND is_super_admin()) OR (((storage.foldername(name))[1] ~~ 'dept-%'::text) AND (is_super_admin() OR can_write_department((SUBSTRING((storage.foldername(name))[1] FROM 6))::uuid))))));
create policy "rules files are uploaded by those with write access" on storage."objects" for insert to authenticated with check (((bucket_id = 'rules'::text) AND ((((storage.foldername(name))[1] = 'church'::text) AND is_super_admin()) OR (((storage.foldername(name))[1] ~~ 'dept-%'::text) AND (is_super_admin() OR can_write_department((SUBSTRING((storage.foldername(name))[1] FROM 6))::uuid))))));
create policy "song tracks are publicly readable" on storage."objects" for select using ((bucket_id = 'song-tracks'::text));
create policy "uniform photos are managed by department admins" on storage."objects" for all to authenticated using (((bucket_id = 'uniform-photos'::text) AND can_write_department(((storage.foldername(name))[1])::uuid))) with check (((bucket_id = 'uniform-photos'::text) AND can_write_department(((storage.foldername(name))[1])::uuid)));
create policy "uniform photos are readable if department is readable" on storage."objects" for select to authenticated using (((bucket_id = 'uniform-photos'::text) AND can_read_department(((storage.foldername(name))[1])::uuid)));

-- ---- auth.users trigger(s) (e.g. auto-create profiles row on signup) ----
-- NOTE: trigger *functions* referenced here must already exist -- check whether
-- they are defined in the public schema (already in generated_schema.sql) or in
-- the auth schema itself (would need to be added here manually; not auto-detected).
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
CREATE TRIGGER on_auth_user_login AFTER UPDATE ON auth.users FOR EACH ROW WHEN ((new.last_sign_in_at IS DISTINCT FROM old.last_sign_in_at)) EXECUTE FUNCTION log_user_login();

-- ---- pg_cron scheduled jobs ----
-- Not captured anywhere else: cron.job rows live outside the public schema
-- and outside any function body (registered directly via cron.schedule()),
-- so they're invisible to both the DDL above and a plain function dump.
select cron.schedule(
  'hard-delete-expired-removed-users',
  '0 3 * * *',
  'select public.hard_delete_expired_removed_users();'
);

commit;