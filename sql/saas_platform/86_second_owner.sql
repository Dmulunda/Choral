-- Adds a second Platform Owner account alongside the one seeded in
-- sql/saas_platform/83_platform_owner.sql -- platform_owner has no
-- uniqueness constraint beyond its own primary key, so more than one
-- row is already schema-supported; this just seeds the second one.

begin;

insert into public.platform_owner (user_id)
select p.id from public.profiles p
join auth.users u on u.id = p.id
where lower(u.email) = lower('vpdottawa@gmail.com')
on conflict (user_id) do nothing;

commit;
