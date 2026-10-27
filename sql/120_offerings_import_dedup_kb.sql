-- Offering Import now catches duplicates (js/components/offeringsImport.js,
-- see the fix for re-uploading the same spreadsheet/entering a row twice)
-- -- adds the matching assistant_knowledge_base row, same discipline as
-- sql/116_ai_assistant_seed.sql's own comment asks for.

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience) values

('Importing offerings: duplicate rows', 'When you import a spreadsheet on the Offerings page, any row with the exact same donor name, date, and amount as one already on file (or repeated within the same file) is automatically detected and skipped -- shown greyed-out as "Skipped — looks like a duplicate" in the preview instead of being imported again. This protects against accidentally uploading the same file twice or re-uploading an overlapping date range.', 'Lorsque vous importez un tableur sur la page Offrandes, toute ligne ayant exactement le même nom de donateur, la même date et le même montant qu''une entrée déjà enregistrée (ou répétée dans le même fichier) est automatiquement détectée et ignorée -- affichée en gris avec la mention "Ignorée — semble être un doublon" dans l''aperçu au lieu d''être importée à nouveau. Cela protège contre le téléversement accidentel du même fichier deux fois ou un chevauchement de périodes.', 'finance');
