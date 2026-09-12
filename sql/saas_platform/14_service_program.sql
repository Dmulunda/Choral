-- Multi-tenant port of the live single-church app's get_service_program()
-- (sql/ port, main commit d556313). Every source table here carries
-- tenant_id -- this SECURITY DEFINER function deliberately widens read
-- access across departments WITHIN one tenant (same as the live app),
-- but every single table reference is explicitly scoped to
-- current_tenant_id(), matching the pattern already used throughout
-- 06_rpc_tenant_fixes.sql. Missing even one of these scopes here would
-- leak one church's roster into another's -- this function bypasses RLS
-- entirely, so it is the only thing standing between tenants for this
-- one read.

create or replace function public.get_service_program(p_date date)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'date', p_date,
    'roster', coalesce((select jsonb_agg(x) from (
      -- Preaching: moderator (has its own status/reason already)
      select 'preaching' dept_key, d.name dept_name, 'moderator' role_label,
             p.full_name person_name, ps.moderator_id person_user_id, ps.moderator_status status
      from preaching_schedule ps
      join departments d on d.key='preaching' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = ps.moderator_id and p.tenant_id = current_tenant_id()
      where ps.date = p_date and ps.tenant_id = current_tenant_id() and ps.moderator_id is not null
      union all
      -- Preaching: preacher (member or guest name, no status today)
      select 'preaching', d.name, 'preacher', coalesce(p.full_name, ps.guest_name), ps.preacher_id, null
      from preaching_schedule ps
      join departments d on d.key='preaching' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = ps.preacher_id and p.tenant_id = current_tenant_id()
      where ps.date = p_date and ps.tenant_id = current_tenant_id()
        and (ps.preacher_id is not null or ps.guest_name is not null)
      union all
      -- Choir: leader + singers by voice part (status via service_rsvps)
      select 'choir', d.name, 'lead', p.full_name, sp.choir_leader_id, null
      from service_plans sp
      join departments d on d.key='choir' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = sp.choir_leader_id and p.tenant_id = current_tenant_id()
      where sp.date = p_date and sp.tenant_id = current_tenant_id() and sp.choir_leader_id is not null
      union all
      select 'choir', d.name, sps.voice_part::text, p.full_name, sps.singer_id, sr.status::text
      from service_plan_singers sps
      join service_plans sp on sp.id = sps.service_plan_id and sp.tenant_id = current_tenant_id()
      join departments d on d.key='choir' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = sps.singer_id and p.tenant_id = current_tenant_id()
      left join service_rsvps sr on sr.service_plan_id = sp.id and sr.singer_id = sps.singer_id
        and sr.tenant_id = current_tenant_id()
      where sp.date = p_date and sps.tenant_id = current_tenant_id()
      union all
      -- Media & Tech
      select 'media_tech', d.name, mta.role::text, p.full_name, mta.user_id, mta.status
      from media_tech_assignments mta
      join departments d on d.key='media_tech' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = mta.user_id and p.tenant_id = current_tenant_id()
      where mta.date = p_date and mta.tenant_id = current_tenant_id()
      union all
      -- Ecodem
      select 'ecodem', d.name, es.age_group::text, p.full_name, esw.user_id, esw.status
      from ecodem_sessions es
      join ecodem_session_workers esw on esw.session_id = es.id and esw.tenant_id = current_tenant_id()
      join departments d on d.key='ecodem' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = esw.user_id and p.tenant_id = current_tenant_id()
      where es.date = p_date and es.tenant_id = current_tenant_id()
      union all
      -- Every generic-shift department: Interpreting, Ushers, Cleaning, Security, etc.
      select d.key, d.name, ds.title, p.full_name, dsa.user_id, dsa.status
      from department_shifts ds
      join departments d on d.id = ds.department_id and d.tenant_id = current_tenant_id()
      join department_shift_assignments dsa on dsa.shift_id = ds.id and dsa.tenant_id = current_tenant_id()
      left join profiles p on p.id = dsa.user_id and p.tenant_id = current_tenant_id()
      where ds.date = p_date and ds.tenant_id = current_tenant_id()
    ) x), '[]'::jsonb),
    'attendance', (
      select jsonb_build_object('men_count', men_count, 'women_count', women_count,
                                 'kids_count', kids_count, 'total_count', total_count)
      from department_headcounts dh
      join departments d on d.id = dh.department_id and d.key = 'ushers' and d.tenant_id = current_tenant_id()
      where dh.date = p_date and dh.tenant_id = current_tenant_id()
    )
  );
$$;

revoke all on function public.get_service_program(date) from public;
grant execute on function public.get_service_program(date) to authenticated;

select pg_notify('pgrst', 'reload schema');
