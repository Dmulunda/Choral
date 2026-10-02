-- Record-level trash for offerings -- offeringsBoard.js's delete
-- button today does a real, permanent `delete from offerings`.
-- Mirrors the proven profiles.removed_at/restore/purge shape
-- (01_schema.sql) instead: a deleted offering is recoverable for 90
-- days by that same church's own Finance team, then purged for good.
-- Deliberately stays within can_manage_finance()'s existing per-tenant
-- gate -- Site Admin has no part in this (see 062's header: giving
-- Site Admin reach into any one church's actual records would
-- contradict the "without seeing other church's internal information"
-- requirement this whole console was built around).
alter table public.offerings add column if not exists removed_at timestamptz;
alter table public.offerings add column if not exists removed_by uuid references public.profiles(id) on delete set null;

-- Soft-deleted rows should no longer satisfy the normal "current
-- period" listing (already true -- that query filters on
-- report_period_id is null, unrelated) but a deletED row needs to
-- actually disappear from that AND the history views, only
-- reappearing via a dedicated "recently removed" list -- so read
-- access is still full (the UI filters removed_at itself, same
-- pattern as profiles' own removed_at) rather than narrowed in SQL,
-- since the Finance team restoring a row needs to see it to restore it.

drop policy if exists "recorder or super admin can delete an offering" on public.offerings;
-- No more hard DELETE policy for this table's normal workflow -- a
-- soft delete is just an UPDATE, already covered by the existing
-- "recorder or super admin can update an offering" policy (sql/054).
-- The policy is dropped rather than kept-but-unused so nothing can
-- still hard-delete a financial record through this table directly.

-- 90-day purge, same idempotent "not yet processed" shape as
-- hard_delete_expired_removed_users() (01_schema.sql, 60 days for
-- members) -- offerings has no "anonymize" step worth doing (it's
-- already just numbers/a name, no account to scrub), so this is a
-- plain hard delete once the window passes.
CREATE OR REPLACE FUNCTION public.purge_expired_removed_offerings()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from public.offerings
  where removed_at is not null
    and removed_at < now() - interval '90 days';
end;
$function$
;

do $$ begin perform cron.unschedule('purge-expired-removed-offerings'); exception when others then null; end $$;
select cron.schedule('purge-expired-removed-offerings', '0 7 * * *', 'select public.purge_expired_removed_offerings();');

select pg_notify('pgrst', 'reload schema');
