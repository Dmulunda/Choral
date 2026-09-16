-- Multi-tenant port of the Budget module punch-list round (main commit
-- 2052f28): review notes, Finance approval-vs-view split, and
-- approved_by/finance_note on budgets. All new/changed RPCs are
-- SECURITY DEFINER, so each re-checks tenant_id explicitly on every row
-- it touches, same reasoning as sandbox2_budget_v2.sql.

begin;

-- 1. New columns.
alter table public.budget_requests add column if not exists review_note text;
alter table public.reimbursement_requests add column if not exists review_note text;
alter table public.budgets add column if not exists finance_note text;
alter table public.budgets add column if not exists approved_by uuid references public.profiles(id);

-- 2. can_approve_finance(): identical to can_manage_finance() minus the
-- Finance-department-secretary branch -- a Finance secretary keeps full
-- cross-department read/audit access (can_manage_finance() unchanged)
-- but loses the ability to approve/reject. Tenant-scoped the same way
-- can_manage_finance() already was fixed in sandbox2_budget_v2.sql.
create or replace function public.can_approve_finance()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or public.can_write_department((select id from public.departments where key = 'finance' and tenant_id = public.current_tenant_id()));
$$;

-- 3. Swap the actual approve/reject RLS policies from can_manage_finance()
-- to can_approve_finance(). Read policies (budgets/budget_transactions'
-- "readable by department members", budget_requests/reimbursement_requests'
-- "requesters and finance can read") stay on can_manage_finance() --
-- unchanged, a Finance secretary still sees everything.

drop policy "finance can update budget requests" on public.budget_requests;
create policy "finance can update budget requests" on public.budget_requests
  for update to authenticated using (public.can_approve_finance()) with check (public.can_approve_finance());

drop policy "finance can reject reimbursement requests" on public.reimbursement_requests;
create policy "finance can reject reimbursement requests" on public.reimbursement_requests
  for update using (public.can_approve_finance())
  with check (public.can_approve_finance());

-- 4. set_budget_finance_note(): a narrow single-column RPC rather than
-- widening the general budgets write policy -- that would also hand
-- Finance rename/status-change rights over every other department's
-- budget, which isn't intended. Uses can_manage_finance() (not
-- can_approve_finance()) -- a Finance secretary CAN annotate, just can't
-- approve/reject requests.
create or replace function public.set_budget_finance_note(p_budget_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_manage_finance() then
    raise exception 'Only Finance can annotate a budget';
  end if;

  update public.budgets set finance_note = p_note
  where id = p_budget_id and tenant_id = public.current_tenant_id();

  if not found then
    raise exception 'Budget not found';
  end if;
end;
$$;
revoke all on function public.set_budget_finance_note(uuid, text) from public, authenticated;
grant execute on function public.set_budget_finance_note(uuid, text) to authenticated;

-- 5. approve_budget_request(): adds p_review_note (persisted on the
-- request either way) and sets approved_by = auth.uid() on the budget
-- it creates or tops up. Approval gate changes to can_approve_finance().
create or replace function public.approve_budget_request(p_request_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  req record;
  new_budget_id uuid;
  caller_tenant uuid;
begin
  if not public.can_approve_finance() then
    raise exception 'Only a Finance admin can approve fund requests';
  end if;
  caller_tenant := public.current_tenant_id();

  select * into req from public.budget_requests where id = p_request_id and tenant_id = caller_tenant;
  if req is null then
    raise exception 'Request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request has already been resolved';
  end if;

  if req.budget_id is null then
    insert into public.budgets (department_id, name, initial_amount, description, created_by, approved_by)
    values (req.requesting_department_id, req.title, coalesce(req.amount, 0), req.description, req.requested_by, auth.uid())
    returning id into new_budget_id;

    update public.budget_requests set status = 'approved', resolved_at = now(), resolved_by = auth.uid(), budget_id = new_budget_id, review_note = p_review_note
    where id = p_request_id and tenant_id = caller_tenant;
  else
    update public.budgets set initial_amount = initial_amount + coalesce(req.amount, 0), approved_by = auth.uid()
    where id = req.budget_id and tenant_id = caller_tenant;

    update public.budget_requests set status = 'approved', resolved_at = now(), resolved_by = auth.uid(), review_note = p_review_note
    where id = p_request_id and tenant_id = caller_tenant;
  end if;
end;
$$;
revoke all on function public.approve_budget_request(uuid, text) from public, authenticated;
grant execute on function public.approve_budget_request(uuid, text) to authenticated;

-- Drop the old single-arg overload -- PostgREST would otherwise see two
-- candidates and refuse to pick one for an RPC call with only p_request_id.
drop function if exists public.approve_budget_request(uuid);

-- 6. approve_reimbursement_request(): adds p_review_note, approval gate
-- changes to can_approve_finance().
create or replace function public.approve_reimbursement_request(p_request_id uuid, p_review_note text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  req record;
begin
  if not public.can_approve_finance() then
    raise exception 'Only a Finance admin can approve reimbursement requests';
  end if;

  select * into req from public.reimbursement_requests where id = p_request_id and tenant_id = public.current_tenant_id();
  if req is null then
    raise exception 'Request not found';
  end if;
  if req.status <> 'pending' then
    raise exception 'This request has already been resolved';
  end if;
  if req.receipt_path is null then
    raise exception 'Cannot approve a reimbursement without an attached receipt';
  end if;

  update public.reimbursement_requests set status = 'approved', resolved_at = now(), resolved_by = auth.uid(), review_note = p_review_note
  where id = p_request_id;
end;
$$;
revoke all on function public.approve_reimbursement_request(uuid, text) from public, authenticated;
grant execute on function public.approve_reimbursement_request(uuid, text) to authenticated;

drop function if exists public.approve_reimbursement_request(uuid);

commit;

select pg_notify('pgrst', 'reload schema');
