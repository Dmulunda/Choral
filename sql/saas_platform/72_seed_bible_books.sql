-- Real pre-existing gap found while diagnosing "Bible import isn't
-- working": bible_books (sql/01_schema.sql) was defined with a FK
-- from bible_verses.book_number -> bible_books.number, but no
-- migration ever actually seeded it -- the table has been completely
-- empty since it was created, so EVERY row the import-bible Edge
-- Function tries to upsert into bible_verses has always failed that
-- FK constraint. (The import-bible function itself was also never
-- deployed to this project at all -- fixed separately, no SQL needed
-- for that half.)
--
-- Standard 66-book Protestant canon, numbered to match
-- api.getbible.net's own book.nr (confirmed identical ordering across
-- both translations this app imports -- World English Bible and
-- Louis Segond 1910 -- before writing this). English names from WEB,
-- French names from LSG, both sourced directly from that same API so
-- they're guaranteed to match what bibleImportTool.js is about to
-- import.

begin;

insert into public.bible_books (number, name_en, name_fr) values
  (1, 'Genesis', 'Genèse'),
  (2, 'Exodus', 'Exode'),
  (3, 'Leviticus', 'Lévitique'),
  (4, 'Numbers', 'Nombres'),
  (5, 'Deuteronomy', 'Deutéronome'),
  (6, 'Joshua', 'Josué'),
  (7, 'Judges', 'Juges'),
  (8, 'Ruth', 'Ruth'),
  (9, '1 Samuel', '1 Samuel'),
  (10, '2 Samuel', '2 Samuel'),
  (11, '1 Kings', '1 Rois'),
  (12, '2 Kings', '2 Rois'),
  (13, '1 Chronicles', '1 Chroniques'),
  (14, '2 Chronicles', '2 Chroniques'),
  (15, 'Ezra', 'Esdras'),
  (16, 'Nehemiah', 'Néhémie'),
  (17, 'Esther', 'Esther'),
  (18, 'Job', 'Job'),
  (19, 'Psalms', 'Psaumes'),
  (20, 'Proverbs', 'Proverbes'),
  (21, 'Ecclesiastes', 'Ecclésiaste'),
  (22, 'Song of Songs', 'Cantique des Cantiques'),
  (23, 'Isaiah', 'Ésaïe'),
  (24, 'Jeremiah', 'Jérémie'),
  (25, 'Lamentations', 'Lamentations'),
  (26, 'Ezekiel', 'Ézéchiel'),
  (27, 'Daniel', 'Daniel'),
  (28, 'Hosea', 'Osée'),
  (29, 'Joel', 'Joël'),
  (30, 'Amos', 'Amos'),
  (31, 'Obadiah', 'Abdias'),
  (32, 'Jonah', 'Jonas'),
  (33, 'Micah', 'Michée'),
  (34, 'Nahum', 'Nahum'),
  (35, 'Habakkuk', 'Habacuc'),
  (36, 'Zephaniah', 'Sophonie'),
  (37, 'Haggai', 'Aggée'),
  (38, 'Zechariah', 'Zacharie'),
  (39, 'Malachi', 'Malachie'),
  (40, 'Matthew', 'Matthieu'),
  (41, 'Mark', 'Marc'),
  (42, 'Luke', 'Luc'),
  (43, 'John', 'Jean'),
  (44, 'Acts', 'Actes des Apôtres'),
  (45, 'Romans', 'Romains'),
  (46, '1 Corinthians', '1 Corinthiens'),
  (47, '2 Corinthians', '2 Corinthiens'),
  (48, 'Galatians', 'Galates'),
  (49, 'Ephesians', 'Éphésiens'),
  (50, 'Philippians', 'Philippiens'),
  (51, 'Colossians', 'Colossiens'),
  (52, '1 Thessalonians', '1 Thessaloniciens'),
  (53, '2 Thessalonians', '2 Thessaloniciens'),
  (54, '1 Timothy', '1 Timothée'),
  (55, '2 Timothy', '2 Timothée'),
  (56, 'Titus', 'Tite'),
  (57, 'Philemon', 'Philémon'),
  (58, 'Hebrews', 'Hébreux'),
  (59, 'James', 'Jacques'),
  (60, '1 Peter', '1 Pierre'),
  (61, '2 Peter', '2 Pierre'),
  (62, '1 John', '1 Jean'),
  (63, '2 John', '2 Jean'),
  (64, '3 John', '3 Jean'),
  (65, 'Jude', 'Jude'),
  (66, 'Revelation', 'Apocalypse')
on conflict (number) do update set name_en = excluded.name_en, name_fr = excluded.name_fr;

commit;

select pg_notify('pgrst', 'reload schema');
