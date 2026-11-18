-- 168: Supplies for every department (asked by the church). Was
-- Cleaning-only (policies hard-coded to the Cleaning department). Now
-- each department's admins manage their own department's supplies and
-- its members can read them; Cleaning keeps working exactly as before
-- since its rows already carry its department_id.
drop policy if exists "cleaning admins manage supplies" on public.department_supplies;
drop policy if exists "cleaning members read supplies" on public.department_supplies;
drop policy if exists "department admins manage supplies" on public.department_supplies;
drop policy if exists "department members read supplies" on public.department_supplies;
create policy "department admins manage supplies" on public.department_supplies for all
  using (public.can_write_department(department_id)) with check (public.can_write_department(department_id));
create policy "department members read supplies" on public.department_supplies for select
  using (public.can_read_department(department_id));
