-- Discipleship path (feature 7 of the improvement roadmap).
--
-- Each church defines its growth steps (first visit, salvation, membership
-- class, baptism, small group, serving, leadership training...). The
-- pastoral team ticks the steps each person in the member database has
-- completed, with the date. Pastors see how many people are at each step
-- and who has stalled; every member sees their own journey.
--
-- Who can do what (RLS):
--   * Pastoral team (is_pastoral_team(), already existing) -- edit the
--     steps, record/undo progress for anyone.
--   * Everyone in the church -- read the list of steps.
--   * A member -- reads only their own progress, through
--     get_my_discipleship() (members rows are pastoral-only).

begin;

create table if not exists public.discipleship_steps (
  id uuid primary key default gen_random_uuid(),
  position smallint not null default 0,
  title_en text not null check (length(trim(title_en)) between 1 and 120),
  title_fr text check (title_fr is null or length(trim(title_fr)) <= 120),
  description text,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists discipleship_steps_position_idx on public.discipleship_steps (position);

create table if not exists public.discipleship_progress (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.members(id) on delete cascade,
  step_id uuid not null references public.discipleship_steps(id) on delete cascade,
  completed_on date not null default current_date,
  note text,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (member_id, step_id)
);
create index if not exists discipleship_progress_step_idx on public.discipleship_progress (step_id);

alter table public.discipleship_steps enable row level security;
alter table public.discipleship_progress enable row level security;

drop policy if exists "church reads discipleship steps" on public.discipleship_steps;
create policy "church reads discipleship steps" on public.discipleship_steps
  for select to authenticated using (true);
drop policy if exists "pastoral team manages discipleship steps" on public.discipleship_steps;
create policy "pastoral team manages discipleship steps" on public.discipleship_steps
  for all to authenticated
  using (public.is_pastoral_team())
  with check (public.is_pastoral_team());

drop policy if exists "pastoral team manages discipleship progress" on public.discipleship_progress;
create policy "pastoral team manages discipleship progress" on public.discipleship_progress
  for all to authenticated
  using (public.is_pastoral_team())
  with check (public.is_pastoral_team());

-- A member's own journey: every active step, with the date they completed
-- it (null = not yet). Matched through members.profile_id.
create or replace function public.get_my_discipleship()
returns table (step_id uuid, title_en text, title_fr text, description text, step_position smallint, completed_on date)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.id, s.title_en, s.title_fr, s.description, s.position,
         (select min(p.completed_on) from public.discipleship_progress p
            join public.members m on m.id = p.member_id
           where p.step_id = s.id and m.profile_id = auth.uid())
  from public.discipleship_steps s
  where s.archived_at is null
  order by s.position, s.created_at;
$$;
revoke all on function public.get_my_discipleship() from public, anon;
grant execute on function public.get_my_discipleship() to authenticated;

-- Starter steps if there are none yet (editable afterwards).
insert into public.discipleship_steps (position, title_en, title_fr)
select v.pos, v.en, v.fr
from (values
  (1, 'First visit', 'Première visite'),
  (2, 'Gave their life to Christ', 'A donné sa vie à Christ'),
  (3, 'Membership class', 'Classe des nouveaux membres'),
  (4, 'Baptism', 'Baptême'),
  (5, 'Joined a small group', 'A rejoint un petit groupe'),
  (6, 'Serving in a department', 'Sert dans un département'),
  (7, 'Leadership training', 'Formation de leaders')
) as v(pos, en, fr)
where not exists (select 1 from public.discipleship_steps);

commit;

select pg_notify('pgrst', 'reload schema');

-- Knowledge-base rows for the discipleship path (sql/154).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience)
select v.topic, v.content_en, v.content_fr, v.audience
from (values
('Discipleship path', 'Discipleship (sidebar) shows "My journey": the church''s growth steps (for example first visit, baptism, membership class, small group, serving) and the ones you have completed, with the date. The pastoral team records the steps; ask a pastor if one is missing.', 'Discipulat (barre latérale) affiche « Mon parcours » : les étapes de croissance de l''église (par exemple première visite, baptême, classe des nouveaux membres, petit groupe, service) et celles que vous avez franchies, avec la date. L''équipe pastorale enregistre les étapes ; demandez à un pasteur s''il en manque une.', 'everyone'),
('Managing the discipleship path', 'The pastoral team opens Discipleship to see how many people have reached each step, and who has stalled (completed a step more than 90 days ago without reaching the next one). Choose a person from the member database to tick the steps they completed and set the date. "Edit steps" renames, reorders, adds or archives steps (English and French titles).', 'L''équipe pastorale ouvre Discipulat pour voir combien de personnes ont atteint chaque étape, et qui stagne (a franchi une étape il y a plus de 90 jours sans atteindre la suivante). Choisissez une personne de la base des membres pour cocher les étapes franchies et en fixer la date. « Modifier les étapes » permet de renommer, réordonner, ajouter ou archiver des étapes (titres en anglais et en français).', 'pastoral')
) as v(topic, content_en, content_fr, audience)
;

commit;
