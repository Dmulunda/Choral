-- Silent Users, Part 1: schema foundation. A Silent user is a real
-- profiles row backed by a real but inert auth.users row (placeholder
-- email + random password nobody is told, created server-side via
-- the Admin API in a new Edge Function) -- NOT a decoupling of
-- profiles.id from auth.users.id, which would require rewriting every
-- RLS policy/helper function in this schema that authorizes off
-- auth.uid() = profiles.id directly. "Upgrading" a Silent user later
-- is just changing that same row's email/password -- zero data
-- migration, since attendance_records.member_id/offerings.member_id/
-- member_cases.subject_user_id etc. never stop pointing at the same id.

alter table public.profiles add column if not exists is_silent boolean not null default false;

create extension if not exists pg_trgm;

-- Pre-auth-callable (anon): both the admin "Add User" flow and the
-- self-serve signup screen need this before a session exists. Returns
-- at most one row (never a list) to keep what a pre-auth visitor can
-- learn about existing people to a minimum.
create or replace function public.find_silent_user_match(p_full_name text)
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.full_name
  from public.profiles p
  where p.is_silent
    and p.removed_at is null
    and similarity(p.full_name, p_full_name) >= 0.5
  order by similarity(p.full_name, p_full_name) desc
  limit 1;
$$;

grant execute on function public.find_silent_user_match(text) to anon, authenticated;

-- Admin-review queue for a self-serve signup that name-matched a
-- Silent user but didn't corroborate with a matching email/phone
-- (upgrade-silent-user Edge Function inserts here, via its
-- service-role client -- RLS below only ever needs to allow the
-- pastoral team to read/decide, never a client-side insert).
create table if not exists public.silent_user_claims (
  id uuid primary key default gen_random_uuid(),
  silent_profile_id uuid not null references public.profiles(id) on delete cascade,
  claimed_full_name text not null,
  claimed_email text,
  claimed_phone text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz
);

alter table public.silent_user_claims enable row level security;

drop policy if exists "silent user claims are readable by the pastoral team" on public.silent_user_claims;
create policy "silent user claims are readable by the pastoral team"
  on public.silent_user_claims for select
  to authenticated
  using (public.is_pastoral_team() or public.is_church_admin());

drop policy if exists "silent user claims are updated by the pastoral team" on public.silent_user_claims;
create policy "silent user claims are updated by the pastoral team"
  on public.silent_user_claims for update
  to authenticated
  using (public.is_pastoral_team() or public.is_church_admin())
  with check (public.is_pastoral_team() or public.is_church_admin());
