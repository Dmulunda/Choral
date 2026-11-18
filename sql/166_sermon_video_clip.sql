-- 166: a sermon can point at a full livestream and say which part to
-- show. video_start_seconds / video_end_seconds are where the sermon
-- starts and ends inside video_url; YouTube's embedded player plays only
-- that part (js/utils/videoClip.js). Both optional.
alter table public.sermons
  add column if not exists video_start_seconds integer,
  add column if not exists video_end_seconds integer;
alter table public.sermons drop constraint if exists sermons_video_clip_check;
alter table public.sermons add constraint sermons_video_clip_check check (
  (video_start_seconds is null or video_start_seconds >= 0)
  and (video_end_seconds is null or video_end_seconds > 0)
  and (video_start_seconds is null or video_end_seconds is null or video_end_seconds > video_start_seconds)
);
comment on column public.sermons.video_start_seconds is 'Where the sermon starts inside video_url (e.g. a full livestream), in seconds.';
comment on column public.sermons.video_end_seconds is 'Where the sermon ends inside video_url, in seconds.';
