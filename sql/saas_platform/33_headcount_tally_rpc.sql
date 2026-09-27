-- Additive headcount tally: unlike headcountBoard.js's admin form
-- (a plain overwrite upsert -- an admin setting/correcting the exact
-- total for a date), this is for live tap-counting during a service --
-- several ushers each counting one group (Men/Women/Kids) on their
-- own phone and submitting independently as families come in. Each
-- submission ADDS to whatever total already exists for that
-- department+date (or starts from 0 if nothing does yet), rather than
-- replacing it, so concurrent submissions from different ushers never
-- clobber each other. Deliberately broader access than
-- can_manage_department() (admin/secretary only, used by the
-- overwrite form) -- any approved member of the department can add a
-- tally, matching can_read_department()'s existing "any approved
-- member" shape, since counting people at the door isn't an admin-only
-- task.

begin;

create or replace function public.add_headcount_tally(
  p_department_id uuid,
  p_date date,
  p_men int default 0,
  p_women int default 0,
  p_kids int default 0
)
returns public.department_headcounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dept_tenant uuid;
  v_row public.department_headcounts;
begin
  if p_men < 0 or p_women < 0 or p_kids < 0 then
    raise exception 'Counts cannot be negative';
  end if;
  if p_men = 0 and p_women = 0 and p_kids = 0 then
    raise exception 'Nothing to add';
  end if;
  if not public.can_read_department(p_department_id) then
    raise exception 'Not authorized for this department';
  end if;

  select tenant_id into v_dept_tenant from public.departments where id = p_department_id;
  if v_dept_tenant is null or v_dept_tenant <> public.current_tenant_id() then
    raise exception 'Department not found';
  end if;

  insert into public.department_headcounts (department_id, date, men_count, women_count, kids_count, recorded_by, tenant_id)
  values (p_department_id, p_date, p_men, p_women, p_kids, auth.uid(), v_dept_tenant)
  on conflict (department_id, date) do update
    set men_count = public.department_headcounts.men_count + excluded.men_count,
        women_count = public.department_headcounts.women_count + excluded.women_count,
        kids_count = public.department_headcounts.kids_count + excluded.kids_count,
        updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.add_headcount_tally(uuid, date, int, int, int) from public;
grant execute on function public.add_headcount_tally(uuid, date, int, int, int) to authenticated;

commit;
