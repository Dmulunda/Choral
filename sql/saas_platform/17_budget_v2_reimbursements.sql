-- Multi-tenant port of Finance: Budget Management v2 (main commit
-- ee85bf4). Every RPC here is SECURITY DEFINER, i.e. bypasses RLS
-- (including the RESTRICTIVE tenant_isolation policy) entirely -- so
-- unlike main, each one needs an explicit tenant_id check, or a Finance
-- admin from one church could approve a request belonging to another.

begin;

-- Pre-existing bug, found while working on this: can_manage_finance()'s
-- subquery for Finance's own department_id had no tenant_id filter --
-- with only one tenant it happened to work, but the moment a second
-- tenant exists with its own Finance department, "select id from
-- departments where key='finance'" returns more than one row, which
-- Postgres raises as an error in a scalar-subquery context -- breaking
-- this function for EVERY tenant, not just leaking data. Fixed in place
-- since this function is now load-bearing for the new cross-department
-- audit read below.
create or replace function public.can_manage_finance()
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select
    public.is_super_admin()
    or public.is_pastor_admin()
    or public.is_church_secretary()
    or public.can_write_department((select id from public.departments where key = 'finance' and tenant_id = public.current_tenant_id()))
    or public.is_department_secretary((select id from public.departments where key = 'finance' and tenant_id = public.current_tenant_id()));
$$;

-- 1. Link a fund request to an existing budget (top-up) instead of
-- always implying a brand-new one.
alter table public.budget_requests add column if not exists budget_id uuid references public.budgets(id);

-- 2. Widen write access to include department secretaries (closing the
-- same admin-only gap as main), and add cross-department audit READ for
-- Finance Admins + Pastor via can_manage_finance() -- both layered
-- under the existing RESTRICTIVE tenant_isolation policy, which stays
-- untouched and still applies to every command regardless.

drop policy "budgets are readable by department members" on public.budgets;
create policy "budgets are readable by department members" on public.budgets
  for select using (public.can_read_department(department_id) or public.can_manage_finance());

drop policy "department admins manage budgets" on public.budgets;
create policy "department admins manage budgets" on public.budgets
  for all using (public.can_write_department(department_id) or public.is_department_secretary(department_id))
  with check (public.can_write_department(department_id) or public.is_department_secretary(department_id));

drop policy "budget transactions are readable by department members" on public.budget_transactions;
create policy "budget transactions are readable by department members" on public.budget_transactions
  for select using (
    exists (select 1 from public.budgets b where b.id = budget_transactions.budget_id
      and (public.can_read_department(b.department_id) or public.can_manage_finance()))
  );

drop policy "department admins manage budget transactions" on public.budget_transactions;
create policy "department admins manage budget transactions" on public.budget_transactions
  for all using (
    exists (select 1 from public.budgets b where b.id = budget_transactions.budget_id
      and (public.can_write_department(b.department_id) or public.is_department_secretary(b.department_id)))
  )
  with check (
    exists (select 1 from public.budgets b where b.id = budget_transactions.budget_id
      and (public.can_write_department(b.department_id) or public.is_department_secretary(b.department_id)))
  );

drop policy "dept admins can submit budget requests" on public.budget_requests;
create policy "dept admins can submit budget requests" on public.budget_requests
  for insert with check (
    requested_by = auth.uid()
    and (public.can_write_department(requesting_department_id) or public.is_department_secretary(requesting_department_id))
  );

-- 3. Reimbursements: standalone, same shape as main, plus tenant_id +
-- RESTRICTIVE tenant_isolation like every other table in this project.
create table public.reimbursement_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id(),
  department_id uuid not null references public.departments(id),
  requested_by uuid references public.profiles(id),
  amount numeric(12,2) not null check (amount > 0),
  note text,
  receipt_path text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id)
);

create index reimbursement_requests_department_id_idx on public.reimbursement_requests(department_id);
create index reimbursement_requests_tenant_id_idx on public.reimbursement_requests(tenant_id);

alter table public.reimbursement_requests enable row level security;

create policy "dept admins can submit reimbursement requests" on public.reimbursement_requests
  for insert with check (
    requested_by = auth.uid()
    and (public.can_write_department(department_id) or public.is_department_secretary(department_id))
  );

create policy "requesters and finance can read reimbursement requests" on public.reimbursement_requests
  for select using (
    requested_by = auth.uid()
    or public.can_write_department(department_id) or public.is_department_secretary(department_id)
    or public.can_manage_finance()
  );

create policy "requesters can attach a receipt while pending" on public.reimbursement_requests
  for update using (requested_by = auth.uid() and status = 'pending')
  with check (requested_by = auth.uid() and status = 'pending');

create policy "finance can reject reimbursement requests" on public.reimbursement_requests
  for update using (public.can_manage_finance())
  with check (public.can_manage_finance());

create policy tenant_isolation on public.reimbursement_requests
  as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

-- 4. Orchestration RPCs. SECURITY DEFINER bypasses RLS entirely --
-- including tenant_isolation -- so both explicitly re-check tenant_id
-- on every row they touch, not just can_manage_finance() (which only
-- proves the caller is *a* Finance admin somewhere, not that this
-- specific request belongs to their own church).

create or replace function public.approve_budget_request(p_request_id uuid)
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
  if not public.can_manage_finance() then
    raise exception 'Only Finance can approve fund requests';
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
    insert into public.budgets (department_id, name, initial_amount, description, created_by)
    values (req.requesting_department_id, req.title, coalesce(req.amount, 0), req.description, req.requested_by)
    returning id into new_budget_id;

    update public.budget_requests set status = 'approved', resolved_at = now(), resolved_by = auth.uid(), budget_id = new_budget_id
    where id = p_request_id and tenant_id = caller_tenant;
  else
    update public.budgets set initial_amount = initial_amount + coalesce(req.amount, 0)
    where id = req.budget_id and tenant_id = caller_tenant;

    update public.budget_requests set status = 'approved', resolved_at = now(), resolved_by = auth.uid()
    where id = p_request_id and tenant_id = caller_tenant;
  end if;
end;
$$;
revoke all on function public.approve_budget_request(uuid) from public, authenticated;
grant execute on function public.approve_budget_request(uuid) to authenticated;

create or replace function public.approve_reimbursement_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  req record;
begin
  if not public.can_manage_finance() then
    raise exception 'Only Finance can approve reimbursement requests';
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

  update public.reimbursement_requests set status = 'approved', resolved_at = now(), resolved_by = auth.uid()
  where id = p_request_id;
end;
$$;
revoke all on function public.approve_reimbursement_request(uuid) from public, authenticated;
grant execute on function public.approve_reimbursement_request(uuid) to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');
