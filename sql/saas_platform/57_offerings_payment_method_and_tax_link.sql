-- Three additions to Church Offering Registration:
--   1. payment_method (cash/transfer/check/other, with a free-text
--      "specify" field for other) on every offering.
--   2. An optional member_id link -- when Finance records (or
--      imports) an offering under a name that matches a real church
--      member, linking it automatically mirrors that offering into
--      donation_entries (the existing Tax Receipts system, sql/030),
--      so it counts toward that member's annual tax receipt. All five
--      offering types count, per the user's choice. A row with no
--      member_id (guest/visitor giving) behaves exactly as before --
--      recorded, never counted toward anyone's receipt, same as an
--      unmatched donation_entries row already works.
--   3. The mirrored row carries its own offering_id back-reference so
--      editing or deleting the offering keeps the mirrored
--      donation_entries row in sync automatically, and so a receipt
--      can always be traced back to the exact offering that produced it.

alter table public.offerings add column if not exists payment_method text
  not null default 'cash' check (payment_method in ('cash', 'transfer', 'check', 'other'));
alter table public.offerings alter column payment_method drop default;
alter table public.offerings add column if not exists payment_method_other text;
alter table public.offerings add column if not exists member_id uuid references public.profiles(id) on delete set null;

alter table public.donation_entries add column if not exists source_offering_id uuid
  references public.offerings(id) on delete cascade;
create unique index if not exists donation_entries_source_offering_id_key
  on public.donation_entries (source_offering_id) where source_offering_id is not null;

CREATE OR REPLACE FUNCTION public.sync_offering_to_donation_entry()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.member_id is not null then
    insert into public.donation_entries (tenant_id, member_id, raw_name, donation_date, amount, created_by, source_offering_id)
    values (new.tenant_id, new.member_id, new.donor_name, new.offering_date, new.amount_cents / 100.0, new.recorded_by, new.id)
    on conflict (source_offering_id) where source_offering_id is not null do update set
      member_id = excluded.member_id,
      raw_name = excluded.raw_name,
      donation_date = excluded.donation_date,
      amount = excluded.amount;
  else
    delete from public.donation_entries where source_offering_id = new.id;
  end if;
  return new;
end;
$function$
;

drop trigger if exists offering_tax_sync on public.offerings;
create trigger offering_tax_sync after insert or update of member_id, donor_name, offering_date, amount_cents
  on public.offerings for each row execute function sync_offering_to_donation_entry();

-- Deleting an offering already cascades to its mirrored donation_entries
-- row via source_offering_id's own ON DELETE CASCADE above -- no
-- separate delete trigger needed.

select pg_notify('pgrst', 'reload schema');
