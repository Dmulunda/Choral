-- Fixes a real bug: "users can read their own availability" (sql/080
-- on the sandbox branch) was meant to let any approved member of a
-- department see teammates' availability in that department, but its
-- EXISTS subquery reads department_memberships directly under the
-- caller's own role. department_memberships' own SELECT policy only
-- allows a member to see THEIR OWN membership row (or an admin's) --
-- so the subquery's dm1 branch (the OTHER person's membership row)
-- silently returned nothing for every non-admin viewer, and the whole
-- policy collapsed to "self or admin only". Confirmed live on the
-- shared main/sandbox DB: a real non-admin member could not see a
-- real teammate's availability despite sharing an approved department.
--
-- Fix: move the shared-department check into a SECURITY DEFINER
-- function (same pattern as is_admin()/can_write_department()), which
-- bypasses department_memberships' RLS for this one internal lookup
-- the same way every other cross-user permission check in this schema
-- already does.

CREATE OR REPLACE FUNCTION public.shares_approved_department_with(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.department_memberships dm1
    join public.department_memberships dm2 on dm2.department_id = dm1.department_id
    where dm1.user_id = target_user_id
      and dm1.status = 'approved'
      and dm2.user_id = auth.uid()
      and dm2.status = 'approved'
  );
$function$
;

DROP POLICY IF EXISTS "users can read their own availability" ON public."availability";
CREATE POLICY "users can read their own availability" ON public."availability"
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = user_id)
    OR is_admin()
    OR public.shares_approved_department_with(user_id)
  );
