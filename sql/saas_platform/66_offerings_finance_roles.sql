-- Two separate Finance capabilities where today there was only one
-- (can_manage_finance(), gating both reading/recording AND deleting
-- identically): recording an offering should be open to any approved
-- Finance team member (admin/secretary/member alike), but *deleting*
-- one should stay admin-only (department admin, or one of the three
-- global oversight roles that already bypass per-department role
-- checks everywhere else in this app) -- and requires a reason.

-- ---- Two new helper functions, same style as every other
-- can_xxx()/is_xxx() check in this app ----
CREATE OR REPLACE FUNCTION public.can_record_offerings()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.can_read_department((select id from public.departments where key = 'finance' and tenant_id = public.current_tenant_id()));
$function$
;

CREATE OR REPLACE FUNCTION public.can_delete_offerings()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or public.can_write_department((select id from public.departments where key = 'finance' and tenant_id = public.current_tenant_id()));
$function$
;

grant execute on function public.can_record_offerings() to authenticated;
grant execute on function public.can_delete_offerings() to authenticated;

-- ---- A reason is required whenever an offering is removed ----
alter table public.offerings add column if not exists removed_reason text;
alter table public.offerings drop constraint if exists offerings_removed_reason_required_check;
alter table public.offerings add constraint offerings_removed_reason_required_check
  check (removed_at is null or removed_reason is not null);

-- ---- Widen who can record; existing insert policy (sql/054) was
-- can_manage_finance() -- replaced, not layered, so there's exactly
-- one insert policy with one clear rule. ----
drop policy if exists "finance team can record offerings" on public.offerings;
create policy "finance team can record offerings" on public.offerings
  for insert to authenticated with check (recorded_by = auth.uid() and public.can_record_offerings());

drop policy if exists "finance team can read offerings" on public.offerings;
create policy "finance team can read offerings" on public.offerings
  for select to authenticated using (public.can_record_offerings());

-- ---- Editing (including soft-delete, which is just an update of
-- removed_at) stays available to whoever recorded it, or a Super
-- Admin -- same as before, just widened from can_manage_finance() to
-- can_record_offerings() so a plain Finance member can edit their own
-- entries. The actual delete-specific restriction is a trigger below,
-- not this policy -- RLS alone can't distinguish "which columns are
-- changing". ----
drop policy if exists "recorder or super admin can update an offering" on public.offerings;
create policy "recorder or super admin can update an offering" on public.offerings
  for update to authenticated using ((recorded_by = auth.uid() or is_super_admin()) and public.can_record_offerings())
  with check ((recorded_by = auth.uid() or is_super_admin()) and public.can_record_offerings());

-- ---- Trigger guard: only can_delete_offerings() may actually change
-- removed_at/removed_reason, regardless of who recorded the row or
-- what the broader update policy above allows -- same proven pattern
-- as prevent_tenant_trash_tampering() (sql/062). ----
CREATE OR REPLACE FUNCTION public.prevent_unauthorized_offering_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if (new.removed_at is distinct from old.removed_at or new.removed_reason is distinct from old.removed_reason)
     and not public.can_delete_offerings() then
    raise exception 'Only a Finance Admin can remove an offering';
  end if;
  return new;
end;
$function$
;

drop trigger if exists offering_removal_guard on public.offerings;
create trigger offering_removal_guard before update on public.offerings
  for each row execute function prevent_unauthorized_offering_removal();

select pg_notify('pgrst', 'reload schema');
