-- The marketing page's "Talk to us" form (Schedule a Demo / General /
-- Support) currently has no backend at all -- it only opens a mailto:
-- draft in the visitor's own email client, which they still have to
-- manually send, and which silently does nothing if that device has
-- no configured email app. This gives it a real, reliably-captured
-- landing place: any anonymous visitor can insert a row (no account,
-- no tenant -- this is pre-signup, unlike support_requests/
-- app_suggestions which are for existing members of an existing
-- church), and every Site Admin is notified and can triage it,
-- exactly like the other two inbound channels.

create table if not exists public.website_inquiries (
  id uuid primary key default gen_random_uuid(),
  topic text not null check (topic in ('demo', 'general', 'support')),
  name text not null,
  email text not null,
  phone text not null,
  church_name text,
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'closed')),
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.website_inquiries enable row level security;

drop policy if exists "anyone can submit a website inquiry" on public.website_inquiries;
create policy "anyone can submit a website inquiry" on public.website_inquiries
  for insert to anon, authenticated with check (true);

drop policy if exists "site admins can read website inquiries" on public.website_inquiries;
create policy "site admins can read website inquiries" on public.website_inquiries
  for select to authenticated using (public.is_site_admin());

drop policy if exists "site admins can triage website inquiries" on public.website_inquiries;
create policy "site admins can triage website inquiries" on public.website_inquiries
  for update to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

-- No tenant_isolation policy on purpose -- this table has no tenant_id
-- at all, the same as platform_admins (sql/049): a pre-signup lead
-- isn't scoped to any church yet.

CREATE OR REPLACE FUNCTION public.notify_site_admins_of_website_inquiry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.notify_site_admins(
    coalesce(new.name, 'Someone') || ' submitted a website inquiry (' || new.topic || ')',
    coalesce(new.message, ''),
    null
  );
  return new;
end;
$function$
;

drop trigger if exists website_inquiry_notify on public.website_inquiries;
create trigger website_inquiry_notify after insert on public.website_inquiries
  for each row execute function notify_site_admins_of_website_inquiry();

CREATE OR REPLACE FUNCTION public.list_website_inquiries_for_site_admin()
 RETURNS TABLE(id uuid, topic text, name text, email text, phone text, church_name text,
               message text, status text, admin_note text, created_at timestamptz)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
begin
  if not public.is_site_admin() then
    raise exception 'Only a Site Admin can view website inquiries';
  end if;
  return query
    select w.id, w.topic, w.name, w.email, w.phone, w.church_name, w.message, w.status, w.admin_note, w.created_at
    from public.website_inquiries w
    order by w.created_at desc;
end;
$$;

revoke all on function public.list_website_inquiries_for_site_admin() from public;
grant execute on function public.list_website_inquiries_for_site_admin() to authenticated;

select pg_notify('pgrst', 'reload schema');
