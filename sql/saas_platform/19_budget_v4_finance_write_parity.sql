-- Multi-tenant port of Finance-admin write parity (main commit 4dc42b2):
-- a Finance Admin (can_approve_finance() level -- not a Finance
-- secretary) can now fully manage ANY department's budget from the
-- drill-down, same actions that department's own admin/secretary has.
-- Read access (can_manage_finance()) already covered everyone including
-- secretary; this widens WRITE only, to the narrower can_approve_finance()
-- set. No new columns/RPCs -- these RLS policies already carry the
-- tenant_isolation RESTRICTIVE policy layered on top, unchanged.

begin;

drop policy "department admins manage budgets" on public.budgets;
create policy "department admins manage budgets" on public.budgets
  for all using (public.can_write_department(department_id) or public.is_department_secretary(department_id) or public.can_approve_finance())
  with check (public.can_write_department(department_id) or public.is_department_secretary(department_id) or public.can_approve_finance());

drop policy "department admins manage budget transactions" on public.budget_transactions;
create policy "department admins manage budget transactions" on public.budget_transactions
  for all using (
    exists (select 1 from public.budgets b where b.id = budget_transactions.budget_id
      and (public.can_write_department(b.department_id) or public.is_department_secretary(b.department_id) or public.can_approve_finance()))
  )
  with check (
    exists (select 1 from public.budgets b where b.id = budget_transactions.budget_id
      and (public.can_write_department(b.department_id) or public.is_department_secretary(b.department_id) or public.can_approve_finance()))
  );

drop policy "budget receipts are managed by department admins" on storage.objects;
create policy "budget receipts are managed by department admins" on storage.objects
  for all
  using (bucket_id = 'budget-receipts' and (public.can_write_department(((storage.foldername(name))[1])::uuid) or public.can_approve_finance()))
  with check (bucket_id = 'budget-receipts' and (public.can_write_department(((storage.foldername(name))[1])::uuid) or public.can_approve_finance()));

commit;

select pg_notify('pgrst', 'reload schema');
