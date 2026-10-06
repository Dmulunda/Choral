-- Projection themes: each theme now also carries its own text size
-- (font_scale, same 1.0 = 100% convention as the live control panel's
-- own slider) and can use an actual uploaded image as its background,
-- not just a solid color or gradient. Applying a theme now sets the
-- live font-scale slider to that theme's value too (see
-- projectionControl.js's broadcastTheme()) -- the manual slider still
-- works as a per-service nudge on top of whatever the theme set.

alter table public.projection_themes add column if not exists font_scale numeric not null default 1;
alter table public.projection_themes add constraint projection_themes_font_scale_check check (font_scale > 0);

-- Storage bucket for theme background images: public read (the image
-- needs to render as a plain CSS background on the projector display
-- with no signed-URL round trip), write restricted to the tenant's
-- own Media & Tech members (same RLS shape as the projection_themes
-- table itself). Path convention: {tenant_id}/{theme_id}.<ext>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('projection-theme-backgrounds', 'projection-theme-backgrounds', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "projection theme backgrounds are publicly readable" on storage.objects
  for select
  using (bucket_id = 'projection-theme-backgrounds');

create policy "media tech manages own tenant theme backgrounds" on storage.objects
  for all to authenticated
  using (bucket_id = 'projection-theme-backgrounds' and ((storage.foldername(name))[1])::uuid = (select public.current_tenant_id()) and (public.is_super_admin() or public.can_read_department((select id from public.departments where key = 'media_tech'))))
  with check (bucket_id = 'projection-theme-backgrounds' and ((storage.foldername(name))[1])::uuid = (select public.current_tenant_id()) and (public.is_super_admin() or public.can_read_department((select id from public.departments where key = 'media_tech'))));

select pg_notify('pgrst', 'reload schema');
