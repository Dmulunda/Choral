-- Flyer generator -- Main's version of the same feature as SAAS
-- (sql/saas_platform/82_flyers.sql). No tenant_id anywhere, and the
-- storage path has no tenant prefix (flat {flyer_id}/... , matching
-- the existing church-logo bucket's own flat convention).

create or replace function public.can_manage_flyers()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select
    public.is_super_admin()
    or exists (
      select 1 from public.department_memberships
      where user_id = auth.uid() and role = 'admin' and status = 'approved'
    );
$$;

create table public.flyers (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  canvas_json jsonb not null,
  canvas_width int not null,
  canvas_height int not null,
  thumbnail_path text,
  event_id uuid references public.events(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.flyers enable row level security;

create policy "members read flyers" on public.flyers
  for select to authenticated using (true);
create policy "flyer managers manage flyers" on public.flyers
  for all to authenticated
  using (public.can_manage_flyers())
  with check (public.can_manage_flyers());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('flyers', 'flyers', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy "flyer images are publicly readable" on storage.objects
  for select
  using (bucket_id = 'flyers');

create policy "flyer managers manage flyer images" on storage.objects
  for all to authenticated
  using (bucket_id = 'flyers' and public.can_manage_flyers())
  with check (bucket_id = 'flyers' and public.can_manage_flyers());

select pg_notify('pgrst', 'reload schema');
