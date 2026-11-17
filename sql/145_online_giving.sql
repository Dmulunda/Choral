-- Online giving (feature 2 of the improvement roadmap).
--
-- Members and visitors give by card through Stripe Checkout, on the
-- CHURCH's own Stripe account (Stripe Connect, Standard accounts): the
-- money goes straight to the church, never through ChurchOnPoint. A
-- church connects its account once from Offerings -> Online giving.
-- Interac e-Transfer and mobile money (M-Pesa, Orange Money, Airtel
-- Money...) are shown as instructions on the giving page and recorded by
-- Finance as usual -- no provider integration (and no cost) yet.
--
-- A paid gift becomes a normal offerings row (payment_method 'online'),
-- so it shows in Offerings, the monthly PDF report, and -- when the
-- giver was signed in -- their year-end tax receipt (offering_tax_sync
-- mirrors member-linked offerings into donation_entries, sql/57).
--
-- Nothing is charged and nothing is live until (1) this file is
-- applied, (2) the online-giving + online-giving-webhook edge functions
-- are deployed with their secrets, and (3) a church connects Stripe and
-- switches giving on.

begin;

alter table public.offerings drop constraint if exists offerings_payment_method_check;
alter table public.offerings add constraint offerings_payment_method_check
  check (payment_method in ('cash', 'transfer', 'check', 'other', 'online'));

-- Main has one church: a single settings row (id = true), same pattern as
-- church_branding.
create table if not exists public.giving_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  stripe_account_id text,
  stripe_charges_enabled boolean not null default false,
  default_currency text not null default 'CAD' check (default_currency in ('CAD', 'USD', 'EUR')),
  interac_email text,
  mobile_money_instructions text,
  thank_you_message text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.giving_settings enable row level security;

drop policy if exists "members read giving settings" on public.giving_settings;
create policy "members read giving settings" on public.giving_settings
  for select to authenticated using (true);
-- No insert/update policy: the church-editable fields go through
-- update_giving_settings() below, and the Stripe fields are written only
-- by the online-giving edge function (service role).

create or replace function public.update_giving_settings(
  p_enabled boolean,
  p_default_currency text,
  p_interac_email text,
  p_mobile_money_instructions text,
  p_thank_you_message text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.is_super_admin() or public.can_delete_offerings()) then
    raise exception 'Only a Super Admin or a Finance admin can change online giving';
  end if;
  insert into public.giving_settings (id, enabled, default_currency, interac_email, mobile_money_instructions, thank_you_message, updated_at, updated_by)
  values (true, coalesce(p_enabled, false), coalesce(p_default_currency, 'CAD'),
          nullif(trim(p_interac_email), ''), nullif(trim(p_mobile_money_instructions), ''), nullif(trim(p_thank_you_message), ''),
          now(), auth.uid())
  on conflict (id) do update set
    enabled = excluded.enabled,
    default_currency = excluded.default_currency,
    interac_email = excluded.interac_email,
    mobile_money_instructions = excluded.mobile_money_instructions,
    thank_you_message = excluded.thank_you_message,
    updated_at = now(),
    updated_by = auth.uid();
end;
$$;
revoke all on function public.update_giving_settings(boolean, text, text, text, text) from public, anon;
grant execute on function public.update_giving_settings(boolean, text, text, text, text) to authenticated;

-- What the public giving page (give.html, no login) may know. Never
-- returns the Stripe account id.
create or replace function public.get_public_giving_info()
returns table (
  tenant_name text, logo_url text, enabled boolean, card_enabled boolean,
  default_currency text, interac_email text, mobile_money_instructions text, thank_you_message text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select 'La Voix de la Puissance Divine'::text,
         (select b.logo_url from public.church_branding b where b.id = true),
         coalesce(g.enabled, false),
         coalesce(g.enabled and g.stripe_charges_enabled and g.stripe_account_id is not null, false),
         coalesce(g.default_currency, 'CAD'),
         case when g.enabled then g.interac_email end,
         case when g.enabled then g.mobile_money_instructions end,
         g.thank_you_message
  from (select 1) one
  left join public.giving_settings g on g.id = true;
$$;
grant execute on function public.get_public_giving_info() to anon, authenticated;

create table if not exists public.online_gifts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  donor_name text not null check (length(trim(donor_name)) between 1 and 200),
  donor_email text,
  amount_cents integer not null check (amount_cents between 100 and 5000000),
  currency text not null check (currency in ('CAD', 'USD', 'EUR')),
  offering_type text not null check (offering_type in ('tithe', 'general', 'sacrifice', 'construction', 'other')),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  stripe_session_id text unique,
  stripe_payment_intent_id text,
  offering_id uuid references public.offerings(id) on delete set null,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index if not exists online_gifts_created_idx on public.online_gifts (created_at desc);
alter table public.online_gifts enable row level security;
drop policy if exists "finance reads online gifts" on public.online_gifts;
create policy "finance reads online gifts" on public.online_gifts
  for select to authenticated using (public.can_record_offerings());
drop policy if exists "givers read their own gifts" on public.online_gifts;
create policy "givers read their own gifts" on public.online_gifts
  for select to authenticated using (user_id = auth.uid());

-- Called by online-giving-webhook (service role) when Stripe confirms a
-- payment. Idempotent: a second call for the same session does nothing.
-- recorded_by: the giver when signed in, otherwise the primary admin.
create or replace function public.record_online_gift_paid(p_session_id text, p_payment_intent_id text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_gift public.online_gifts;
  v_recorder uuid;
  v_offering uuid;
begin
  select * into v_gift from public.online_gifts where stripe_session_id = p_session_id for update;
  if not found then return null; end if;
  if v_gift.status = 'paid' then return v_gift.offering_id; end if;
  v_recorder := v_gift.user_id;
  if v_recorder is null then
    select p.id into v_recorder from public.profiles p
    where p.removed_at is null and (p.is_primary_admin or p.global_role = 'super_admin')
    order by p.is_primary_admin desc nulls last, p.created_at
    limit 1;
  end if;
  if v_recorder is null then raise exception 'No admin found to record online gift %', v_gift.id; end if;
  insert into public.offerings (donor_name, offering_date, amount_cents, offering_type,
                                recorded_by, payment_method, member_id, currency)
  values (v_gift.donor_name, (now() at time zone 'America/Toronto')::date, v_gift.amount_cents,
          v_gift.offering_type, v_recorder, 'online', v_gift.user_id, v_gift.currency)
  returning id into v_offering;
  update public.online_gifts
  set status = 'paid', paid_at = now(), stripe_payment_intent_id = p_payment_intent_id, offering_id = v_offering
  where id = v_gift.id;
  return v_offering;
end;
$$;
revoke all on function public.record_online_gift_paid(text, text) from public, anon, authenticated;

commit;

select pg_notify('pgrst', 'reload schema');

-- Knowledge-base rows for online giving (sql/144).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience)
select v.topic, v.content_en, v.content_fr, v.audience
from (values
('Giving online', 'Members can give from the app (Tax / Impôts → Give online) and anyone can give from the church''s public giving link or QR code. Choose an amount, a type (tithe, offering, sacrifice, construction, other) and pay by card. If the church shows Interac e-Transfer or mobile money instructions, follow them instead. When you give while signed in, the gift counts toward your year-end tax receipt automatically.', 'Les membres peuvent donner depuis l''application (Tax / Impôts → Donner en ligne) et tout le monde peut donner depuis le lien public ou le code QR de l''église. Choisissez un montant, un type (dîme, offrande, sacrifice, construction, autre) et payez par carte. Si l''église affiche des instructions Interac ou mobile money, suivez-les. Quand vous donnez en étant connecté, le don compte automatiquement dans votre reçu fiscal de fin d''année.', 'everyone'),
('Setting up online giving', 'Offerings → Online giving: a Super Admin or Finance admin connects the church''s own Stripe account once (the money goes directly to the church), then switches giving on. Optional: add the Interac e-Transfer email and mobile money instructions to show on the giving page, and a thank-you message. Share the giving link or QR code. Every paid card gift appears in Offerings automatically with the payment method Online.', 'Offrandes → Dons en ligne : un Super Admin ou un administrateur des Finances connecte une fois le compte Stripe de l''église (l''argent va directement à l''église), puis active les dons. Facultatif : ajoutez le courriel Interac et les instructions mobile money à afficher sur la page de dons, et un message de remerciement. Partagez le lien ou le code QR de dons. Chaque don par carte payé apparaît automatiquement dans Offrandes avec le mode de paiement En ligne.', 'finance')
) as v(topic, content_en, content_fr, audience)
;

commit;
