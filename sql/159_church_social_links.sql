-- 159: Church social media links (Main), shown on the public welcome
-- page (welcome.html, through the public-portal edge function) and
-- edited by admins in Settings -> Church logo & contact info.
-- Public information on purpose; only https:// links are accepted.
alter table public.church_branding
  add column if not exists website_url text,
  add column if not exists facebook_url text,
  add column if not exists youtube_url text,
  add column if not exists instagram_url text,
  add column if not exists tiktok_url text,
  add column if not exists whatsapp_url text;

alter table public.church_branding drop constraint if exists church_branding_social_https;
alter table public.church_branding add constraint church_branding_social_https check (
      (website_url   is null or website_url   ~ '^https://[^\s]+$')
  and (facebook_url  is null or facebook_url  ~ '^https://[^\s]+$')
  and (youtube_url   is null or youtube_url   ~ '^https://[^\s]+$')
  and (instagram_url is null or instagram_url ~ '^https://[^\s]+$')
  and (tiktok_url    is null or tiktok_url    ~ '^https://[^\s]+$')
  and (whatsapp_url  is null or whatsapp_url  ~ '^https://[^\s]+$'));
