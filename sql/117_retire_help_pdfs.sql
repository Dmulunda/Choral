-- In-App AI Assistant, Part 3: retire the old PDF-upload Help system,
-- fully superseded by the chat assistant from Part 1/2. All uploaded
-- PDFs were downloaded and confirmed backed up locally before this
-- ran.
--
-- The help-docs storage bucket itself is emptied/removed separately
-- via the Storage API (`supabase storage rm`) -- direct SQL deletes
-- against storage.objects/storage.buckets are rejected by Supabase.
drop table if exists public.help_documents;
