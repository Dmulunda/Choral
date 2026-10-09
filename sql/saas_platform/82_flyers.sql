-- Flyer generator -- a real drag-and-drop editor (Fabric.js, loaded
-- client-side only, see js/components/flyerEditor.js) rather than
-- fixed templates with just text/photo swap, per the feature spec's
-- own "move, resize or delete elements" requirement. This migration
-- is just the storage: one row per saved flyer (its whole canvas as
-- Fabric's own JSON serialization) plus a bucket for the flyer's
-- thumbnail and any photos uploaded into it.
--
-- Who can manage flyers: the same population who can create an event
-- (department admin of some department, or Super Admin) -- flyers are
-- promotional church material, not a general member tool.

begin;

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
  tenant_id uuid not null references public.tenants(id) on delete cascade,
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
create index flyers_tenant_id_idx on public.flyers (tenant_id);

alter table public.flyers enable row level security;
create policy "tenant_isolation" on public.flyers as restrictive for all
  using (tenant_id = (select public.current_tenant_id()))
  with check (tenant_id = (select public.current_tenant_id()));

create policy "tenant members read flyers" on public.flyers
  for select to authenticated using (tenant_id = (select public.current_tenant_id()));
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
  using (bucket_id = 'flyers' and ((storage.foldername(name))[1])::uuid = (select public.current_tenant_id()) and public.can_manage_flyers())
  with check (bucket_id = 'flyers' and ((storage.foldername(name))[1])::uuid = (select public.current_tenant_id()) and public.can_manage_flyers());

commit;

select pg_notify('pgrst', 'reload schema');
