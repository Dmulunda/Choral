-- Equipment & inventory for every department (feature 14 of the roadmap).
--
-- Until now only Media & Tech had an Equipment tab (sql/84).
-- This opens it to every department (each manages its own items) and adds
-- what a church inventory needs: quantity, serial number, purchase date and
-- value, warranty end, next maintenance date, loans to people without an
-- account (borrower_name), and a maintenance log. The pastoral team sees and
-- manages every department's items from one Inventory page.
--
-- Existing rows and the Media & Tech tab keep working unchanged.

begin;

alter table public.equipment_items
  add column if not exists quantity integer not null default 1 check (quantity between 0 and 100000),
  add column if not exists serial_number text check (serial_number is null or length(serial_number) <= 120),
  add column if not exists purchased_on date,
  add column if not exists value_cents bigint check (value_cents is null or value_cents >= 0),
  add column if not exists warranty_until date,
  add column if not exists next_maintenance_on date,
  add column if not exists borrower_name text check (borrower_name is null or length(borrower_name) <= 160);

-- Media-tech-only policies -> per-department (+ pastoral team). The
-- other existing policies stay as they are.
drop policy if exists "media tech admins manage equipment" on public.equipment_items;
drop policy if exists "media tech members read equipment" on public.equipment_items;
drop policy if exists "department members read equipment" on public.equipment_items;
create policy "department members read equipment" on public.equipment_items
  for select to authenticated
  using (public.can_read_department(department_id) or public.is_pastoral_team());
drop policy if exists "department admins manage equipment" on public.equipment_items;
create policy "department admins manage equipment" on public.equipment_items
  for all to authenticated
  using (public.can_write_department(department_id) or public.is_pastoral_team())
  with check (public.can_write_department(department_id) or public.is_pastoral_team());

create table if not exists public.equipment_maintenance (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.equipment_items(id) on delete cascade,
  done_on date not null default current_date,
  kind text not null default 'check' check (kind in ('check', 'repair', 'cleaning', 'replacement', 'other')),
  cost_cents bigint check (cost_cents is null or cost_cents >= 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists equipment_maintenance_item_idx on public.equipment_maintenance (item_id, done_on desc);

alter table public.equipment_maintenance enable row level security;
drop policy if exists "read maintenance with the item" on public.equipment_maintenance;
create policy "read maintenance with the item" on public.equipment_maintenance
  for select to authenticated
  using (exists (select 1 from public.equipment_items i where i.id = item_id
                       and (public.can_read_department(i.department_id) or public.is_pastoral_team())));
drop policy if exists "manage maintenance with the item" on public.equipment_maintenance;
create policy "manage maintenance with the item" on public.equipment_maintenance
  for all to authenticated
  using (exists (select 1 from public.equipment_items i where i.id = item_id
                       and (public.can_write_department(i.department_id) or public.is_pastoral_team())))
  with check (exists (select 1 from public.equipment_items i where i.id = item_id
                       and (public.can_write_department(i.department_id) or public.is_pastoral_team())));

commit;

select pg_notify('pgrst', 'reload schema');

-- Knowledge-base rows for equipment & inventory (sql/166).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience)
select v.topic, v.content_en, v.content_fr, v.audience
from (values
('Department equipment', 'Every department has an Equipment tab listing its items, where they are stored and their condition. Department admins add and edit items (quantity, serial number, value, purchase date, warranty, next maintenance), lend them (to themselves or to any name, with a return date), check them back in, and keep a maintenance log (check, repair, cleaning…). Overdue loans show in red; maintenance due in the next two weeks shows in orange.', 'Chaque département a un onglet Équipement qui liste ses articles, leur lieu de rangement et leur état. Les administrateurs du département ajoutent et modifient les articles (quantité, numéro de série, valeur, date d''achat, garantie, prochain entretien), les prêtent (à eux-mêmes ou à n''importe quel nom, avec une date de retour), les reprennent et tiennent un journal d''entretien (vérification, réparation, nettoyage…). Les prêts en retard s''affichent en rouge ; l''entretien prévu dans les deux semaines en orange.', 'department_admin'),
('Church inventory', 'Inventory (sidebar, pastoral team) shows every department''s equipment in one list with totals: number of items, total value, overdue loans, items to repair or missing, and maintenance due. Filter by department, category or "Needs attention", search by name or serial number, and download the list as CSV (for insurance, for example).', 'Inventaire (barre latérale, équipe pastorale) montre l''équipement de tous les départements dans une seule liste avec des totaux : nombre d''articles, valeur totale, prêts en retard, articles à réparer ou manquants, et entretien à faire. Filtrez par département, catégorie ou « À surveiller », cherchez par nom ou numéro de série, et téléchargez la liste en CSV (pour l''assurance, par exemple).', 'pastoral')
) as v(topic, content_en, content_fr, audience)
;

commit;
