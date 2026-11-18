-- 161: AI writing helper (Main, single church).
-- Usage log for the 'ai-writer' edge function: 40 requests per person per
-- 24 hours, token counts for cost tracking. Written only by the edge
-- function (service role); super admins can read it.
create table if not exists public.ai_usage_log (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  task text not null,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_log_user_day_idx on public.ai_usage_log (user_id, created_at desc);

alter table public.ai_usage_log enable row level security;
drop policy if exists "super admins read ai usage" on public.ai_usage_log;
create policy "super admins read ai usage" on public.ai_usage_log
  for select to authenticated using (public.is_super_admin());

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience)
select 'AI writing help',
  'Leaders (pastoral team, department admins and secretaries) see "✨ AI help" under some text boxes: in the Communication hub (Translate FR ⇄ EN, Improve wording), in meeting minutes (Turn notes into minutes, Translate) and in sermons (Summarise, Translate). The suggestion appears in a purple box; nothing changes until you click "Use this", and "Undo" restores your text. AI can make mistakes, so read it before saving. Each person can use it 40 times a day.',
  'Les responsables (équipe pastorale, administrateurs et secrétaires de département) voient « ✨ Aide IA » sous certaines zones de texte : dans le Centre de communication (Traduire FR ⇄ EN, Améliorer le texte), dans les procès-verbaux (Notes → procès-verbal, Traduire) et dans les prédications (Résumer, Traduire). La suggestion apparaît dans un encadré violet ; rien ne change tant que vous ne cliquez pas sur « Utiliser », et « Annuler » remet votre texte. L''IA peut se tromper : relisez avant d''enregistrer. Chaque personne peut l''utiliser 40 fois par jour.',
  'department_admin'
where not exists (select 1 from public.assistant_knowledge_base where topic = 'AI writing help');
