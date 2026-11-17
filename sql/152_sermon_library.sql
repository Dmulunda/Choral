-- Sermon & media library (feature 9 of the improvement roadmap).
--
-- Every sermon in one searchable place: title, preacher, date, series,
-- Bible passage, language, a short summary, a video link (YouTube,
-- Facebook...), and optional audio and notes (PDF) files kept in a private
-- storage bucket. Members browse and listen; the pastoral team and the
-- Media / Preaching departments add and edit.
--
-- Storage: bucket 'sermon-files' (private, 200 MB per file, audio + PDF).
-- Files live under <sermon_id>/..., readable only by the church's signed-in
-- people (the app uses short-lived signed links).

begin;

create or replace function public.can_manage_sermons()
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.is_pastoral_team()
      or exists (select 1 from public.departments d
                  where d.key in ('media_tech', 'preaching')
                    and public.can_write_department(d.id));
$$;
grant execute on function public.can_manage_sermons() to authenticated;

create table if not exists public.sermons (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  preacher text check (preacher is null or length(preacher) <= 120),
  preached_on date not null default current_date,
  series text check (series is null or length(series) <= 120),
  scripture text check (scripture is null or length(scripture) <= 200),
  language text not null default 'fr' check (language in ('fr', 'en', 'both', 'other')),
  summary text,
  video_url text check (video_url is null or video_url ~* '^https://'),
  audio_path text,
  notes_path text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists sermons_date_idx on public.sermons (preached_on desc);

alter table public.sermons enable row level security;
drop policy if exists "church reads sermons" on public.sermons;
create policy "church reads sermons" on public.sermons
  for select to authenticated using (true);
drop policy if exists "sermon managers write sermons" on public.sermons;
create policy "sermon managers write sermons" on public.sermons
  for all to authenticated
  using (public.can_manage_sermons())
  with check (public.can_manage_sermons());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sermon-files', 'sermon-files', false, 209715200,
        array['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/ogg', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "church reads sermon files" on storage.objects;
create policy "church reads sermon files" on storage.objects
  for select to authenticated
  using (bucket_id = 'sermon-files');
drop policy if exists "sermon managers write sermon files" on storage.objects;
create policy "sermon managers write sermon files" on storage.objects
  for all to authenticated
  using (bucket_id = 'sermon-files' and public.can_manage_sermons())
  with check (bucket_id = 'sermon-files' and public.can_manage_sermons());

commit;

select pg_notify('pgrst', 'reload schema');

-- Knowledge-base rows for the sermon library (sql/158).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience)
select v.topic, v.content_en, v.content_fr, v.audience
from (values
('Sermon library', 'Sermons (sidebar) lists every sermon with its preacher, date, series and Bible passage. Search by any word, filter by series or language, watch the video link, listen to the audio or open the notes (PDF).', 'Prédications (barre latérale) liste toutes les prédications avec le prédicateur, la date, la série et le passage biblique. Cherchez par n''importe quel mot, filtrez par série ou par langue, regardez la vidéo, écoutez l''audio ou ouvrez les notes (PDF).', 'everyone'),
('Adding a sermon', 'The pastoral team and the Media and Preaching departments use Sermons → Add a sermon: title, preacher, date, series, passage, language, summary, a video link (YouTube or Facebook, starting with https://), and optionally an audio file (MP3/M4A, up to 200 MB) and notes (PDF).', 'L''équipe pastorale et les départements Média et Prédication utilisent Prédications → Ajouter une prédication : titre, prédicateur, date, série, passage, langue, résumé, un lien vidéo (YouTube ou Facebook, commençant par https://) et, si voulu, un fichier audio (MP3/M4A, jusqu''à 200 Mo) et des notes (PDF).', 'department_admin')
) as v(topic, content_en, content_fr, audience)
;

commit;
