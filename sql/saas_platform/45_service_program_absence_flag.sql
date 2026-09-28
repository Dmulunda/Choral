-- Adds an is_absent flag to each get_service_program() roster row, so
-- the Service Program view can show a red "reported absence on this
-- day" note next to anyone who's both scheduled AND reported absent
-- for that date (the warn-and-allow flow in report_absence() lets that
-- combination exist now -- see 44_absence_warn_instead_of_block.sql).
-- Port of main's sql/45_service_program_absence_flag.sql, with the
-- same tenant_id scoping every join in this function already has.

begin;

create or replace function public.get_service_program(p_date date)
returns jsonb
language sql
security definer
set search_path to 'public', 'pg_temp'
as $function$
  select jsonb_build_object(
    'date', p_date,
    'roster', coalesce((select jsonb_agg(x) from (
      select 'preaching' dept_key, d.name dept_name, 'moderator' role_label,
             p.full_name person_name, ps.moderator_id person_user_id, ps.moderator_status status,
             exists (
               select 1 from availability a
               where a.user_id = ps.moderator_id and a.date = p_date and a.status = 'unavailable' and a.tenant_id = current_tenant_id()
             ) is_absent
      from preaching_schedule ps
      join departments d on d.key='preaching' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = ps.moderator_id and p.tenant_id = current_tenant_id()
      where ps.date = p_date and ps.tenant_id = current_tenant_id() and ps.moderator_id is not null
      union all
      select 'preaching', d.name, 'preacher', coalesce(p.full_name, ps.guest_name), ps.preacher_id, null,
             exists (
               select 1 from availability a
               where a.user_id = ps.preacher_id and a.date = p_date and a.status = 'unavailable' and a.tenant_id = current_tenant_id()
             )
      from preaching_schedule ps
      join departments d on d.key='preaching' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = ps.preacher_id and p.tenant_id = current_tenant_id()
      where ps.date = p_date and ps.tenant_id = current_tenant_id()
        and (ps.preacher_id is not null or ps.guest_name is not null)
      union all
      select 'choir', d.name, 'lead', p.full_name, sp.choir_leader_id, null,
             exists (
               select 1 from availability a
               where a.user_id = sp.choir_leader_id and a.date = p_date and a.status = 'unavailable' and a.tenant_id = current_tenant_id()
             )
      from service_plans sp
      join departments d on d.key='choir' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = sp.choir_leader_id and p.tenant_id = current_tenant_id()
      where sp.date = p_date and sp.tenant_id = current_tenant_id() and sp.choir_leader_id is not null
      union all
      select 'choir', d.name, sps.voice_part::text, p.full_name, sps.singer_id, sr.status::text,
             exists (
               select 1 from availability a
               where a.user_id = sps.singer_id and a.date = p_date and a.status = 'unavailable' and a.tenant_id = current_tenant_id()
             )
      from service_plan_singers sps
      join service_plans sp on sp.id = sps.service_plan_id and sp.tenant_id = current_tenant_id()
      join departments d on d.key='choir' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = sps.singer_id and p.tenant_id = current_tenant_id()
      left join service_rsvps sr on sr.service_plan_id = sp.id and sr.singer_id = sps.singer_id
        and sr.tenant_id = current_tenant_id()
      where sp.date = p_date and sps.tenant_id = current_tenant_id()
      union all
      select 'media_tech', d.name, mta.role::text, p.full_name, mta.user_id, mta.status,
             exists (
               select 1 from availability a
               where a.user_id = mta.user_id and a.date = p_date and a.status = 'unavailable' and a.tenant_id = current_tenant_id()
             )
      from media_tech_assignments mta
      join departments d on d.key='media_tech' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = mta.user_id and p.tenant_id = current_tenant_id()
      where mta.date = p_date and mta.tenant_id = current_tenant_id()
      union all
      select 'ecodem', d.name, es.age_group::text, p.full_name, esw.user_id, esw.status,
             exists (
               select 1 from availability a
               where a.user_id = esw.user_id and a.date = p_date and a.status = 'unavailable' and a.tenant_id = current_tenant_id()
             )
      from ecodem_sessions es
      join ecodem_session_workers esw on esw.session_id = es.id and esw.tenant_id = current_tenant_id()
      join departments d on d.key='ecodem' and d.tenant_id = current_tenant_id()
      left join profiles p on p.id = esw.user_id and p.tenant_id = current_tenant_id()
      where es.date = p_date and es.tenant_id = current_tenant_id()
      union all
      select d.key, d.name, ds.title, p.full_name, dsa.user_id, dsa.status,
             exists (
               select 1 from availability a
               where a.user_id = dsa.user_id and a.date = p_date and a.status = 'unavailable' and a.tenant_id = current_tenant_id()
             )
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
$function$;

commit;

select pg_notify('pgrst', 'reload schema');
