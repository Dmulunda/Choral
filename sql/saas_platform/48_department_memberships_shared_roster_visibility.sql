-- The 47_availability_shared_department_visibility_fix.sql migration
-- fixed the `availability` table's own RLS, but calendar.js's teammate
-- lookup (loadTeammates()) never actually reaches that table for a
-- non-admin: it first queries department_memberships directly to get
-- the roster of who's in the department, and THAT table's read policy
-- only ever let someone see their own row (or an admin's). So for any
-- non-admin, the roster query came back empty and the availability
-- query for teammates was never even run. Confirmed live: a real
-- plain Media & Tech member got zero rows back from
-- `department_memberships` for their own department.
--
-- Fix: same pattern as 47 -- add a SECURITY DEFINER helper (bypasses
-- department_memberships' own RLS for this one internal lookup, same
-- as can_write_department()/is_admin() already do) and widen the read
-- policy so any approved member of a department can see the roster of
-- that same department, not just admins.

CREATE OR REPLACE FUNCTION public.is_approved_member_of_department(dept_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.department_memberships
    where user_id = auth.uid() and department_id = dept_id and status = 'approved'
  );
$function$
;

DROP POLICY IF EXISTS "users can read their own memberships" ON public."department_memberships";
CREATE POLICY "users can read their own memberships" ON public."department_memberships"
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = user_id)
    OR can_approve_department_membership(department_id)
    OR is_super_viewer()
    OR is_church_secretary()
    OR public.is_approved_member_of_department(department_id)
  );
