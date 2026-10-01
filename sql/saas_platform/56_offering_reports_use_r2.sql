-- Switches offering report PDF storage from Supabase Storage (set up
-- in 055) to Cloudflare R2 -- same reasoning and pattern as
-- course-video-r2 (sql/079/R2 for course videos): no egress fees, and
-- the offering-reports Edge Function now talks to R2 directly via
-- aws4fetch instead of admin.storage. Nothing was ever actually
-- stored in the Supabase bucket (the function was never deployed), so
-- there's no data migration needed -- just removing the now-unused
-- policy. The empty bucket row itself is left in place: Supabase
-- blocks direct SQL deletes on storage.buckets ("Use the Storage API
-- instead") -- it's harmless and empty, so not worth a dashboard trip
-- to remove.

drop policy if exists "offering report pdfs are managed by finance team" on storage."objects";
