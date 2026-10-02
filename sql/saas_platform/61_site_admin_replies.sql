-- A Site Admin's status/admin_note edit on an app_suggestion/
-- support_request/website_inquiry (siteAdminModal.js's wireCards())
-- is currently invisible to whoever submitted it -- admin_note is an
-- internal-only note, and there's no notification back to the
-- submitter at all. This adds a distinct, submitter-facing
-- site_admin_reply field plus the notification wiring to actually
-- deliver it.
--
-- website_inquiries submitters are anonymous (no account) -- their
-- reply is delivered by email from the site-admin-usage... no, from
-- a new action on an Edge Function, not a DB trigger (needs
-- RESEND_API_KEY). app_suggestions/support_requests submitters are
-- signed-in members -- their reply is delivered the same way
-- notify_site_admins() already delivers notifications (sql/049),
-- just reversed: recipient_id = the submitter, tenant_id = the
-- SUBMITTER's own tenant (not the site admin's) -- same cross-tenant
-- notifications gotcha as 049, mirrored in the other direction.

-- Real pre-existing gap, found while building this: app_suggestions'
-- own read policy (049) never let the submitter read back their own
-- row (only support_requests' did) -- "is_super_admin() OR
-- is_site_admin()", no submitted_by clause at all. Harmless until now
-- since nothing tried to read a suggestion back as its own submitter,
-- but it's exactly what the new "My Suggestions" view (and even a
-- plain INSERT ... RETURNING) needs.
drop policy if exists "super admins and site admins can read suggestions" on public.app_suggestions;
create policy "submitters, super admins and site admins can read suggestions" on public.app_suggestions
  for select to authenticated using (submitted_by = auth.uid() OR is_super_admin() OR public.is_site_admin());

alter table public.app_suggestions add column if not exists site_admin_reply text;
alter table public.app_suggestions add column if not exists replied_at timestamptz;
alter table public.support_requests add column if not exists site_admin_reply text;
alter table public.support_requests add column if not exists replied_at timestamptz;
alter table public.website_inquiries add column if not exists site_admin_reply text;
alter table public.website_inquiries add column if not exists replied_at timestamptz;

do $$ begin
  alter type public.notification_type add value if not exists 'suggestion_reply';
exception when others then null; end $$;
do $$ begin
  alter type public.notification_type add value if not exists 'support_reply';
exception when others then null; end $$;

CREATE OR REPLACE FUNCTION public.notify_submitter_of_suggestion_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid;
begin
  if new.site_admin_reply is null or new.site_admin_reply is not distinct from old.site_admin_reply then
    return new;
  end if;
  if new.submitted_by is null then
    return new;
  end if;
  select tenant_id into v_tenant_id from public.profiles where id = new.submitted_by;
  if v_tenant_id is null then
    return new;
  end if;
  insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
  values (new.submitted_by, 'suggestion_reply'::notification_type,
          'A Site Admin replied to your suggestion', new.site_admin_reply, null, v_tenant_id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_submitter_of_support_reply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant_id uuid;
begin
  if new.site_admin_reply is null or new.site_admin_reply is not distinct from old.site_admin_reply then
    return new;
  end if;
  if new.submitted_by is null then
    return new;
  end if;
  select tenant_id into v_tenant_id from public.profiles where id = new.submitted_by;
  if v_tenant_id is null then
    return new;
  end if;
  insert into public.notifications (recipient_id, type, title, body, source_user_id, tenant_id)
  values (new.submitted_by, 'support_reply'::notification_type,
          'A Site Admin replied to your support request', new.site_admin_reply, null, v_tenant_id);
  return new;
end;
$function$
;

drop trigger if exists suggestion_reply_notify on public.app_suggestions;
create trigger suggestion_reply_notify after update of site_admin_reply on public.app_suggestions
  for each row execute function notify_submitter_of_suggestion_reply();

drop trigger if exists support_reply_notify on public.support_requests;
create trigger support_reply_notify after update of site_admin_reply on public.support_requests
  for each row execute function notify_submitter_of_support_reply();

select pg_notify('pgrst', 'reload schema');
