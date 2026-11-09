-- Matching knowledge-base row for Invite Members (sql/141), same
-- discipline as sql/116_ai_assistant_seed.sql's own comment asks for.

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience) values

('Invite Members', 'The Super Admin menu''s "Invite Members" shows a link to share with people you want to join the church -- opening it takes them straight to the Sign Up tab. A switch there turns open sign-up off, which hides the Sign Up tab entirely and requires every new member''s account to be created by an admin instead (User Manager''s "Add User", one at a time, or bulk import).', 'Le menu Super Admin « Inviter des membres » affiche un lien à partager avec les personnes que vous souhaitez voir rejoindre l''église -- l''ouvrir les amène directement à l''onglet Inscription. Un interrupteur y permet de désactiver l''inscription ouverte, ce qui masque entièrement l''onglet Inscription et exige que chaque nouveau compte membre soit créé par un administrateur à la place (« Ajouter un utilisateur » dans la Gestion des utilisateurs, un à la fois, ou par import en masse).', 'super_admin');
