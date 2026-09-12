-- Signup flow RPCs for the SaaS platform.
--
-- tenants has no INSERT policy for authenticated/anon by design (see
-- sql/saas_platform/01_schema.sql) -- tenant creation is deliberately a
-- privileged operation. These two SECURITY DEFINER functions are the one
-- controlled path through that restriction.
--
-- Flow: (1) anon calls create_tenant_for_signup() to get a tenant_id
-- before an account exists, (2) client calls auth.signUp() with that
-- tenant_id in options.data (handle_new_user() picks it up), (3) the now-
-- authenticated caller calls claim_tenant_admin() once to become their
-- new tenant's founding admin.

begin;

create or replace function public.create_tenant_for_signup(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Church name is required' using errcode = '22023';
  end if;
  if p_slug !~ '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])$' then
    raise exception 'That URL name isn''t valid -- use lowercase letters, numbers, and hyphens only' using errcode = '22023';
  end if;

  insert into public.tenants (name, slug, status, trial_ends_at)
  values (trim(p_name), p_slug, 'trial', now() + interval '30 days')
  returning id into v_id;

  return v_id;
exception
  when unique_violation then
    raise exception 'That URL name is already taken -- try another' using errcode = '23505';
end;
$$;

-- Callable before login (anon) since this runs before signUp() creates an
-- account, and by authenticated too (harmless -- it only ever creates a
-- brand new trial tenant, never touches an existing one).
revoke execute on function public.create_tenant_for_signup(text, text) from public;
grant execute on function public.create_tenant_for_signup(text, text) to anon, authenticated;

create or replace function public.claim_tenant_admin()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_current_role text;
  v_existing_admin uuid;
begin
  select tenant_id, global_role into v_tenant_id, v_current_role
  from public.profiles where id = auth.uid();

  if v_tenant_id is null then
    raise exception 'No tenant on this account' using errcode = '22023';
  end if;
  if v_current_role is not null then
    raise exception 'This account already has a role' using errcode = '22023';
  end if;

  -- Refuse if someone in this tenant is already the admin -- this is what
  -- makes it safe to let any authenticated user call this: it only ever
  -- succeeds once per tenant, for whoever gets there first (in practice,
  -- the one person who just signed up and created the tenant).
  select id into v_existing_admin
  from public.profiles
  where tenant_id = v_tenant_id and global_role = 'super_admin'
  limit 1;

  if v_existing_admin is not null then
    raise exception 'This church already has an admin' using errcode = '22023';
  end if;

  -- protect_global_role_trigger (pre-existing business rule: only a Super
  -- Admin can change global_role) would otherwise block this UPDATE even
  -- though this function is SECURITY DEFINER -- triggers fire regardless
  -- of the calling role, that's not what SECURITY DEFINER changes (it
  -- only affects RLS/permission checks). The bypass flag below is set
  -- `true` (LOCAL/transaction-scoped) and read by protect_global_role()
  -- (see its own definition further down); it evaporates at the end of
  -- this transaction, and since PostgREST runs each client request in its
  -- own transaction, a client calling set_config() directly gains nothing
  -- in a separate subsequent request.
  perform set_config('app.bypass_global_role_protection', 'on', true);
  update public.profiles set global_role = 'super_admin' where id = auth.uid();
end;
$$;

revoke execute on function public.claim_tenant_admin() from public;
grant execute on function public.claim_tenant_admin() to authenticated;

-- Patched to add the transaction-local bypass claim_tenant_admin() above
-- relies on; everything else is unchanged from the copied original.
create or replace function public.protect_global_role()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if (
    new.global_role is distinct from old.global_role
    or new.can_view_all_departments is distinct from old.can_view_all_departments
    or new.can_manage_pastoral_cases is distinct from old.can_manage_pastoral_cases
    or new.can_post_global_announcements is distinct from old.can_post_global_announcements
    or new.can_message_any_member is distinct from old.can_message_any_member
    or new.can_approve_any_membership is distinct from old.can_approve_any_membership
  ) and auth.uid() is not null and not public.is_super_admin()
    and coalesce(current_setting('app.bypass_global_role_protection', true), '') <> 'on' then
    raise exception 'Only a Super Admin can change global_role or custom admin powers';
  end if;
  return new;
end;
$function$;

commit;
