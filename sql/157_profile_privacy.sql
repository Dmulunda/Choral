-- 157: Member privacy (Main).
--
-- Before this, any signed-in account (including someone who just used
-- self sign-up) could read every profile with address, birth place,
-- legal name and saved signature. Now:
--   * Guests (no approved department, no global role, not marked
--     member) only see their own profile.
--   * get_profiles_private() / get_card_pastor_signature(): the only way
--     the app reads address, birth place, legal name and signature once
--     158 locks those columns. Self, the pastoral
--     team, church admins, global-role holders and the department
--     admins/secretaries of the person's departments read them through
--     get_profiles_private().
--   * Small groups (their location is often a home address) are only
--     readable by members.

create or replace function public.is_church_member()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
           select 1 from public.profiles p
           where p.id = auth.uid() and p.removed_at is null
             and (p.global_role is not null or p.user_status = 'member'))
      or exists (
           select 1 from public.department_memberships m
           where m.user_id = auth.uid() and m.status = 'approved')
      or public.is_church_admin();
$$;
revoke all on function public.is_church_member() from public;
grant execute on function public.is_church_member() to authenticated;
revoke execute on function public.is_church_member() from anon;

drop policy if exists "profiles are readable by authenticated users" on public.profiles;
drop policy if exists "members read profiles, guests read only themselves" on public.profiles;
create policy "members read profiles, guests read only themselves"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.is_church_member())
  );


create or replace function public.get_profiles_private(p_ids uuid[])
returns table (id uuid, address text, birth_country text, birth_city text, legal_name text, signature_data text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.id, p.address, p.birth_country, p.birth_city, p.legal_name, p.signature_data
  from public.profiles p
  where p.id = any (p_ids)
    and (
      p.id = auth.uid()
      or public.is_pastoral_team()
      or public.is_church_admin()
      or exists (select 1 from public.profiles me where me.id = auth.uid() and me.global_role is not null)
      or exists (select 1 from public.department_memberships m
                 where m.user_id = p.id and m.status = 'approved' and public.can_manage_department(m.department_id))
    );
$$;
revoke all on function public.get_profiles_private(uuid[]) from public;
grant execute on function public.get_profiles_private(uuid[]) to authenticated;
revoke execute on function public.get_profiles_private(uuid[]) from anon;

-- The principal pastor's signature is printed on every member card.
create or replace function public.get_card_pastor_signature()
returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select p.signature_data from public.profiles p
  where public.is_church_member() and p.member_title = 'pastor_principal' and p.removed_at is null
  limit 1;
$$;
revoke all on function public.get_card_pastor_signature() from public;
grant execute on function public.get_card_pastor_signature() to authenticated;
revoke execute on function public.get_card_pastor_signature() from anon;

drop policy if exists "church reads small groups" on public.small_groups;
drop policy if exists "members read small groups" on public.small_groups;
create policy "members read small groups" on public.small_groups for select to authenticated
  using ((select public.is_church_member()));
