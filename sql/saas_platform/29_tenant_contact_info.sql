-- Per-tenant contact email/phone, ported from main. Each church now
-- enters its own contact info in the "Change Info" panel (renamed
-- from "Church Logo" -- tenantLogoModal.js), used as send-booking-
-- email's per-tenant Reply-To and footer contact line so a guest's
-- reply reaches that church, not the shared platform sender.
--
-- No RLS/trigger changes needed: protect_tenant_privileged_columns()
-- (09_tenant_logo.sql) is a blocklist (status/trial_ends_at/plan_id/
-- slug), so these new columns are automatically self-service-writable
-- under the existing "tenant admin can update own tenant" policy --
-- same as logo_url/address already are.

alter table public.tenants
  add column if not exists email text,
  add column if not exists phone text;

select pg_notify('pgrst', 'reload schema');
