-- Projection themes: named text/background/size presets for the three
-- kinds of thing Projection ever puts on screen (Songs, Bible, Media),
-- picked by Media & Tech rather than hardcoded white-on-black. Ported
-- from SAAS's sql/saas_platform/73+74 (that version is tenant-scoped;
-- this one drops tenant_id entirely -- Main has no multi-tenant
-- concept at all, so there's exactly one set of themes, not one per
-- church).
--
-- background_type/background_value: 'color' -> a hex color string;
-- 'gradient' -> a ready-to-use CSS gradient string; 'image' -> a
-- public URL (uploaded via the new storage bucket below). font_scale
-- mirrors the live control panel's own text-size slider convention
-- (1.0 = 100%).
create table if not exists public.projection_themes (
  id uuid default gen_random_uuid() not null,
  category text not null,
  name text not null,
  text_color text not null default '#ffffff',
  font_family text,
  background_type text not null default 'color',
  background_value text not null default '#000000',
  font_scale numeric not null default 1,
  is_default boolean not null default false,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

alter table public.projection_themes add constraint projection_themes_pkey primary key (id);
alter table public.projection_themes add constraint projection_themes_category_check check (category = any (array['songs', 'bible', 'media']));
alter table public.projection_themes add constraint projection_themes_background_type_check check (background_type = any (array['color', 'gradient', 'image']));
alter table public.projection_themes add constraint projection_themes_font_scale_check check (font_scale > 0);
alter table public.projection_themes add constraint projection_themes_created_by_fkey foreign key (created_by) references public.profiles(id);

-- At most one default per category -- the modal's "Set as default"
-- always goes through set_default_projection_theme() below, which
-- clears the old default first, so this is a backstop.
create unique index projection_themes_default_per_category on public.projection_themes using btree (category) where (is_default);

alter table public.projection_themes enable row level security;

create policy "projection_themes_select" on public.projection_themes for select to authenticated
  using (public.can_read_department((select id from public.departments where key = 'media_tech')));

create policy "projection_themes_write" on public.projection_themes for all to authenticated
  using (public.can_write_department((select id from public.departments where key = 'media_tech')))
  with check (public.can_write_department((select id from public.departments where key = 'media_tech')));

-- Atomically swaps which theme is the default for its own category
-- (clears the old default first, in the same statement set as setting
-- the new one, so the partial unique index above is never briefly
-- violated and never briefly empty either).
create or replace function public.set_default_projection_theme(p_theme_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_category text;
begin
  select category into v_category from projection_themes where id = p_theme_id;
  if v_category is null then
    raise exception 'Theme not found';
  end if;

  if not public.can_write_department((select id from departments where key = 'media_tech')) then
    raise exception 'Not authorized to manage projection themes';
  end if;

  update projection_themes set is_default = false
  where category = v_category and is_default;

  update projection_themes set is_default = true
  where id = p_theme_id;
end;
$$;

grant execute on function public.set_default_projection_theme(uuid) to authenticated;

-- Storage bucket for theme background images: public read (renders as
-- a plain CSS background on the projector display, no signed-URL
-- round trip), write restricted to Media & Tech. Path convention:
-- {theme_id}.<ext> (no tenant prefix -- see header comment).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('projection-theme-backgrounds', 'projection-theme-backgrounds', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "projection theme backgrounds are publicly readable" on storage.objects
  for select
  using (bucket_id = 'projection-theme-backgrounds');

create policy "media tech manages theme backgrounds" on storage.objects
  for all to authenticated
  using (bucket_id = 'projection-theme-backgrounds' and public.can_write_department((select id from public.departments where key = 'media_tech')))
  with check (bucket_id = 'projection-theme-backgrounds' and public.can_write_department((select id from public.departments where key = 'media_tech')));

-- Seed 2-3 built-in presets per category, one default each -- an
-- operator who never touches theming at all still gets something
-- better than hardcoded white-on-black.
insert into public.projection_themes (category, name, text_color, background_type, background_value, is_default) values
  ('songs', 'Classic', '#ffffff', 'color', '#000000', true),
  ('songs', 'Warm', '#fde68a', 'gradient', 'linear-gradient(135deg,#1e1b4b,#78350f)', false),
  ('songs', 'Clean', '#0f172a', 'color', '#f8fafc', false),
  ('bible', 'Classic', '#ffffff', 'color', '#000000', true),
  ('bible', 'Warm', '#fde68a', 'gradient', 'linear-gradient(135deg,#1e1b4b,#78350f)', false),
  ('bible', 'Clean', '#0f172a', 'color', '#f8fafc', false),
  ('media', 'Classic', '#ffffff', 'color', '#000000', true),
  ('media', 'Warm', '#fde68a', 'gradient', 'linear-gradient(135deg,#1e1b4b,#78350f)', false),
  ('media', 'Clean', '#0f172a', 'color', '#f8fafc', false);

select pg_notify('pgrst', 'reload schema');
