-- =============================================================
-- Migration 118 — Self-service "leave the church"
-- Counterpart to remove_user_from_church() (sql/030_user_removal.sql):
-- same cleanup, but gated on the caller's own auth.uid() instead of
-- is_super_admin(), for a member who no longer wants access.
-- Safe to run more than once.
-- =============================================================

alter table public.profiles add column if not exists removed_reason text;

create or replace function public.leave_church()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.department_memberships where user_id = auth.uid();

  update public.profiles
  set removed_at = now(), removed_by = auth.uid(), removed_reason = 'Left voluntarily', global_role = null
  where id = auth.uid() and removed_at is null;
end;
$$;

grant execute on function public.leave_church() to authenticated;
