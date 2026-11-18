-- 167: the Media & Tech team runs the lyrics on Sunday, but the song
-- library was only readable by Choir members and editable by Choir
-- admins -- so Media saw an empty list and retyped lyrics every week.
-- Approved Media & Tech members can now read the library and add or
-- edit songs (lyrics); deleting stays with Choir admins.
create or replace function public.is_media_tech_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1 from public.department_memberships m
    join public.departments d on d.id = m.department_id
    where m.user_id = auth.uid() and d.key = 'media_tech' and m.status = 'approved'
  );
$$;
revoke all on function public.is_media_tech_member() from public, anon;
grant execute on function public.is_media_tech_member() to authenticated;

drop policy if exists "media team reads songs" on public.songs;
create policy "media team reads songs" on public.songs for select using (public.is_media_tech_member());

drop policy if exists "media team adds songs" on public.songs;
create policy "media team adds songs" on public.songs for insert with check (public.is_media_tech_member());

drop policy if exists "media team edits songs" on public.songs;
create policy "media team edits songs" on public.songs for update using (public.is_media_tech_member()) with check (public.is_media_tech_member());
