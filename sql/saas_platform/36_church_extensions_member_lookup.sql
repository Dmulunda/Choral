-- Lets a Global Super Admin grant a cross-extension role (General
-- Overseer/Secretary/another Global Super Admin) to someone who
-- belongs to a DIFFERENT extension than the one they're currently in
-- -- profiles is tenant-scoped by RLS, so there's no other way to
-- resolve "the person with this email" across extensions. Read-only
-- and re-verifies global_super_admin itself (never trusts the caller
-- already having reached this point some other way).

begin;

create or replace function public.find_denomination_member_by_email(p_denomination_id uuid, p_email text)
returns table(user_id uuid, full_name text, tenant_id uuid, tenant_name text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Table-qualified column refs throughout: this function's OUT
  -- parameters (user_id, tenant_id) become plpgsql variables in scope
  -- for the whole body, so an unqualified "user_id" is ambiguous
  -- against denomination_admins.user_id/profiles.id-joined columns.
  if not exists (
    select 1 from public.denomination_admins da
    where da.user_id = auth.uid() and da.denomination_id = p_denomination_id and da.role = 'global_super_admin'
  ) then
    raise exception 'Only a Global Super Admin of this denomination can look up members';
  end if;

  return query
    select p.id, p.full_name, p.tenant_id, t.name
    from public.profile_emails pe
    join public.profiles p on p.id = pe.id
    join public.tenants t on t.id = p.tenant_id
    where lower(pe.email) = lower(trim(p_email))
      and t.denomination_id = p_denomination_id
    limit 1;
end;
$$;

revoke all on function public.find_denomination_member_by_email(uuid, text) from public;
grant execute on function public.find_denomination_member_by_email(uuid, text) to authenticated;

commit;
