-- Every new church gets Choir and Preaching & Moderation by default --
-- these are the two departments the "Create Department" tool can't
-- produce on its own: it always inserts kind='lightweight' (see
-- js/components/createDepartmentModal.js), and while a lightweight
-- department named "Preaching" would pick up the special Preaching
-- scheduling UI (deptScheduling.js routes by department.key, not kind),
-- Choir's UI is its own separate tab set entirely (js/app.js's `isChoir`),
-- not reachable through the generic dept-dashboard path a lightweight
-- department gets no matter what it's named.
--
-- Both keys ('choir', 'preaching') already have built-in translated
-- labels in js/i18n.js (department.choir / department.preaching, both
-- languages), so no menu_labels seeding is needed for them to display
-- correctly right away, unlike a name typed through Create Department.

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

  -- Explicit tenant_id -- the caller is anon (no session, so
  -- current_tenant_id()'s default would resolve to NULL) at this point
  -- in the signup flow, before auth.signUp() has even run yet.
  insert into public.departments (key, name, kind, tenant_id) values
    ('choir', 'Choir', 'choir', v_id),
    ('preaching', 'Preaching & Moderation', 'lightweight', v_id);

  return v_id;
exception
  when unique_violation then
    raise exception 'That URL name is already taken -- try another' using errcode = '23505';
end;
$$;

revoke execute on function public.create_tenant_for_signup(text, text) from public;
grant execute on function public.create_tenant_for_signup(text, text) to anon, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
