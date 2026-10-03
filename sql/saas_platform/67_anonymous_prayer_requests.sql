-- Anonymous prayer requests: a submitter can opt out of recording
-- who they are at all (not just hiding it from the queue UI). Makes
-- user_id nullable and relaxes the insert check to allow a null
-- identity. Select/update policies are untouched -- the existing
-- "requester = auth.uid()" clause simply never matches a null row,
-- which is correct: nobody but handlers can see an anonymous request.

alter table public."prayer_requests" alter column "user_id" drop not null;

drop policy if exists "prayer requests are created by the requester" on public."prayer_requests";
create policy "prayer requests are created by the requester" on public."prayer_requests"
  for insert to authenticated
  with check ((user_id = auth.uid()) OR (user_id is null));
