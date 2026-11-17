-- 160: Cache for the live-status edge function (is the church's YouTube
-- channel live?). One row; written only by the edge function with the
-- service role, never readable through the API.
create table if not exists public.live_status_cache (
  id boolean primary key default true check (id),
  source_url text,
  channel_id text,
  payload jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default 'epoch'
);
alter table public.live_status_cache enable row level security;
revoke all on public.live_status_cache from anon, authenticated;
