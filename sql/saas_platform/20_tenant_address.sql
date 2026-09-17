-- Per-tenant church address, editable from the same logo modal that
-- already lets a tenant's Super Admin set their logo (tenantLogoModal.js).
-- Not in 09_tenant_logo.sql's privileged-column protection list (only
-- status/trial_ends_at/plan_id/slug are blocked there), so the existing
-- "tenant admin can update own tenant" UPDATE policy already permits
-- writing this column -- no RLS/trigger changes needed.

begin;

alter table public.tenants add column if not exists address text;

commit;

select pg_notify('pgrst', 'reload schema');
