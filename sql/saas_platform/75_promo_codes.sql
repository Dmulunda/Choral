-- Promo codes: percentage-discount codes platform staff (Site Admins)
-- create and manage, redeemed by churches at checkout. The real
-- discount, global redemption limit, expiry, and new-customer
-- restriction are all enforced by Stripe's own Coupon + Promotion
-- Code objects (supabase/functions/stripe-billing/index.ts) rather
-- than reimplemented here, per the feature's own technical note.
-- These tables are a local mirror for the admin tracking view, plus
-- the one thing Stripe genuinely has no concept of: a real
-- per-CHURCH "already used this code" check (Stripe's own limits are
-- global across every customer, not per-customer).

create table if not exists public.promo_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_percent int not null check (discount_percent between 1 and 100),
  applies_to_plan_groups text[],  -- null = all plans (plans.plan_group values, e.g. 'pro'/'premium'/'max')
  duration text not null check (duration in ('once', 'repeating', 'forever')),
  duration_in_months int check (duration <> 'repeating' or duration_in_months > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  usage_limit int check (usage_limit > 0),
  one_use_per_church boolean not null default true,
  new_customers_only boolean not null default false,
  status text not null default 'active' check (status in ('active', 'paused')),
  stripe_coupon_id text not null,
  stripe_promotion_code_id text not null,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per completed (paid) checkout that had a promo code
-- attached -- never written for an abandoned checkout, see
-- stripe-webhook's checkout.session.completed handler.
create table if not exists public.promo_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  promo_code_id uuid not null references public.promo_codes(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stripe_subscription_id text not null unique,
  discount_percent int not null,
  original_price_cents int not null,
  discounted_price_cents int not null,
  duration text not null,
  duration_in_months int,
  redeemed_at timestamptz not null default now(),
  -- Only ever set for duration='repeating' -- see
  -- send_promo_discount_ending_emails() below. 'once'/'forever'
  -- redemptions never need a reminder (one already shows the normal
  -- price again next invoice with no surprise; the other never
  -- reverts at all).
  reminder_emailed_at timestamptz
);

create index if not exists promo_code_redemptions_promo_code_id_idx on public.promo_code_redemptions (promo_code_id);
create index if not exists promo_code_redemptions_tenant_id_idx on public.promo_code_redemptions (tenant_id);

alter table public.promo_codes enable row level security;
alter table public.promo_code_redemptions enable row level security;

-- Site Admins only -- the checkout-side validate/apply flow never
-- queries these tables directly from the client; it always goes
-- through stripe-billing's service-role client, same as every other
-- cross-tenant table Site Admin manages.
drop policy if exists "site admins manage promo codes" on public.promo_codes;
create policy "site admins manage promo codes" on public.promo_codes
  for all to authenticated using (public.is_site_admin()) with check (public.is_site_admin());

drop policy if exists "site admins read promo code redemptions" on public.promo_code_redemptions;
create policy "site admins read promo code redemptions" on public.promo_code_redemptions
  for select to authenticated using (public.is_site_admin());

-- ---- Discount-ending reminder email ----
-- Mirrors 55_offering_report_automation.sql's cron pattern exactly: a
-- daily pg_cron job calls this function, which finds redemptions
-- entering their last 7 days of discount and asks stripe-billing
-- (over the SAME shared cron secret already used for offering
-- emails -- not a new secret of its own) to send one reminder each,
-- marking reminder_emailed_at so it's never sent twice.
create or replace function public.send_promo_discount_ending_emails()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_redemption record;
  v_secret text;
  v_base_url text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'offering_cron_secret';
  v_base_url := 'https://towlqbxvhftzjfrtepsy.supabase.co/functions/v1/stripe-billing';

  for v_redemption in
    select id from public.promo_code_redemptions
    where duration = 'repeating'
      and duration_in_months is not null
      and reminder_emailed_at is null
      and redeemed_at + (duration_in_months || ' months')::interval - interval '7 days' <= now()
      and redeemed_at + (duration_in_months || ' months')::interval > now()
  loop
    perform net.http_post(
      url := v_base_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := jsonb_build_object('action', 'send_discount_ending_email', 'redemption_id', v_redemption.id)
    );
  end loop;
end;
$function$;

do $$ begin perform cron.unschedule('send-promo-discount-ending-emails'); exception when others then null; end $$;
select cron.schedule('send-promo-discount-ending-emails', '0 6 * * *', 'select public.send_promo_discount_ending_emails();');
