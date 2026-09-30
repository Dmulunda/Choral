-- Church Calendar: the church has one shared calendar for its two
-- existing/new concepts --
--   1. Upcoming Events (church_programs/church_program_dates, already
--      existed -- the Church Program department's own flyer/program
--      announcements).
--   2. Church Bookings (new, this file) -- any OTHER department's
--      admin reserving a specific date for their own department's
--      event. The goal: a given date can only ever hold ONE of these,
--      so departments never collide with each other or with an
--      Upcoming Event -- enforced at the database level (a unique
--      index plus two symmetric triggers), not just in the UI, so a
--      race between two admins booking the same day at once still
--      can't produce two bookings.

create table if not exists public.church_bookings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null default public.current_tenant_id() references public.tenants(id) on delete restrict,
  department_id uuid not null references public.departments(id) on delete cascade,
  title text not null,
  notes text,
  date date not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists church_bookings_tenant_date_unique on public.church_bookings (tenant_id, date);
create index if not exists church_bookings_department_id_idx on public.church_bookings (department_id);

alter table public.church_bookings enable row level security;

drop policy if exists "tenant_isolation" on public.church_bookings;
create policy "tenant_isolation" on public.church_bookings as restrictive for all
  using (tenant_id = current_tenant_id());

drop policy if exists "everyone can see church bookings" on public.church_bookings;
create policy "everyone can see church bookings" on public.church_bookings
  for select to authenticated using (true);

-- "all admin and other admin" -- can_write_department() already covers
-- exactly this: is_super_admin() OR a real admin of that specific
-- department (not just any-department-admin, so a booking has to be
-- made by someone who actually administers the department it's filed
-- under).
drop policy if exists "department admins can book their own department" on public.church_bookings;
create policy "department admins can book their own department" on public.church_bookings
  for insert to authenticated with check (created_by = auth.uid() and can_write_department(department_id));

drop policy if exists "creator or super admin can update a booking" on public.church_bookings;
create policy "creator or super admin can update a booking" on public.church_bookings
  for update to authenticated using (created_by = auth.uid() or is_super_admin()) with check (created_by = auth.uid() or is_super_admin());

-- "No one can ever remove a booking without the admin who made it in
-- the first place" -- creator only, plus the Super Admin override
-- every other admin-scoped delete in this app already has.
drop policy if exists "creator or super admin can delete a booking" on public.church_bookings;
create policy "creator or super admin can delete a booking" on public.church_bookings
  for delete to authenticated using (created_by = auth.uid() or is_super_admin());

CREATE OR REPLACE FUNCTION public.prevent_church_booking_date_conflict()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (
    select 1 from public.church_program_dates cpd
    where cpd.date = new.date and cpd.tenant_id = new.tenant_id
  ) then
    raise exception 'DATE_TAKEN_BY_EVENT';
  end if;
  return new;
end;
$function$
;

drop trigger if exists church_booking_conflict_check on public.church_bookings;
create trigger church_booking_conflict_check before insert on public.church_bookings
  for each row execute function prevent_church_booking_date_conflict();

-- Symmetric: Church Program can't post an Upcoming Event on a date a
-- department already booked, either -- same single-date-one-thing
-- invariant from the other direction.
CREATE OR REPLACE FUNCTION public.prevent_church_program_date_conflict()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if exists (
    select 1 from public.church_bookings cb
    where cb.date = new.date and cb.tenant_id = new.tenant_id
  ) then
    raise exception 'DATE_TAKEN_BY_BOOKING';
  end if;
  return new;
end;
$function$
;

drop trigger if exists church_program_date_conflict_check on public.church_program_dates;
create trigger church_program_date_conflict_check before insert on public.church_program_dates
  for each row execute function prevent_church_program_date_conflict();

select pg_notify('pgrst', 'reload schema');
