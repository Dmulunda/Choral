-- Fixes the root cause of "more than one row returned by a subquery
-- used as an expression" on the Users page (is_admin()), plus five
-- more pre-existing instances of the exact same bug class found while
-- auditing for it.
--
-- The pattern: several functions do "select id from public.departments
-- where key = '<some key>'" with no tenant_id filter at all. This only
-- ever worked because there was, historically, exactly ONE tenant in
-- the whole database -- departments.key is only unique PER TENANT
-- (see departments_key_key: unique (tenant_id, key)), never globally.
-- can_manage_finance()/can_approve_finance() already had this exact bug
-- fixed in 17_budget_v2_reimbursements.sql/18_budget_v3_notes_approval_split.sql
-- (see their comments) -- these are the remaining unfixed ones,
-- surfaced now because Church Extensions is what created a second
-- tenant in this database for the first time ever.
--
-- Two different fixes depending on context:
--  - A SECURITY DEFINER function called by an authenticated end user
--    (mark_prayer_request_prayed, sync_schedule_conflicts_for_unavailable,
--    send_replacement_request): scope by current_tenant_id() or by the
--    specific user_id the function already operates on, matching
--    whatever tenant reference that function already trusts elsewhere.
--  - A trigger function (auto_add_church_program_membership,
--    notify_guest_attendance): scope using NEW's own tenant_id column
--    directly -- both department_memberships and attendance_records
--    already carry one -- rather than depending on session state
--    (current_tenant_id()), which triggers should not need to rely on.

begin;

create or replace function public.is_admin()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select public.can_write_department((
    select id from public.departments where key = 'choir' and tenant_id = public.current_tenant_id()
  ));
$function$;

create or replace function public.auto_add_church_program_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_church_program_id uuid;
begin
  if new.status is distinct from 'approved' then
    return new;
  end if;
  if TG_OP = 'UPDATE' and old.status = 'approved' then
    return new;
  end if;

  select id into v_church_program_id from public.departments where key = 'church_program' and tenant_id = new.tenant_id;
  if v_church_program_id is null or new.department_id = v_church_program_id then
    return new;
  end if;

  insert into public.department_memberships (user_id, department_id, role, status, approved_at)
  values (new.user_id, v_church_program_id, 'member', 'approved', now())
  on conflict (user_id, department_id) do nothing;

  return new;
end;
$function$;

create or replace function public.mark_prayer_request_prayed(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (
    public.is_pastoral_team()
    or public.can_manage_department((select id from public.departments where key = 'intercession' and tenant_id = public.current_tenant_id()))
  ) then
    raise exception 'You do not have access to handle prayer requests';
  end if;
  if (select tenant_id from public.prayer_requests where id = p_request_id) is distinct from public.current_tenant_id() then
    raise exception 'Request not found';
  end if;

  update public.prayer_requests
  set status = 'prayed', handled_by = auth.uid(), handled_at = now()
  where id = p_request_id;
end;
$function$;

create or replace function public.notify_guest_attendance()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead_id uuid;
  v_welcoming_dept_id uuid;
begin
  if new.guest_name is not null and not exists (
    select 1 from public.guest_follow_ups
    where lower(trim(full_name)) = lower(trim(new.guest_name))
      and status <> 'assigned_to_department'
      and created_at > now() - interval '30 days'
  ) then
    select id into v_welcoming_dept_id from public.departments where key = 'welcoming_socialisation' and tenant_id = new.tenant_id;

    insert into public.guest_follow_ups (
      full_name, phone, email, city, referral_source, referred_by_name,
      age_range, prayer_request, wants_pastor_meeting, home_church,
      assigned_department_id, source, created_by
    )
    values (
      new.guest_name, new.guest_phone, new.guest_email, new.guest_city,
      new.guest_referral_source, new.guest_referred_by_name,
      new.guest_age_range, new.guest_prayer_request,
      new.guest_wants_pastor_meeting, new.guest_home_church,
      v_welcoming_dept_id, 'attendance_checkin', new.recorded_by
    )
    returning id into v_lead_id;

    if v_welcoming_dept_id is not null then
      insert into public.guest_follow_up_transfers (guest_follow_up_id, from_department_id, to_department_id, note, transferred_by)
      values (v_lead_id, null, v_welcoming_dept_id, 'Initial intake', new.recorded_by);
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.sync_schedule_conflicts_for_unavailable(p_user_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_full_name text;
  v_tenant_id uuid;
  v_choir_id uuid;
  v_conflict record;
  v_replacement_id uuid;
begin
  select full_name, tenant_id into v_full_name, v_tenant_id from public.profiles where id = p_user_id;
  select id into v_choir_id from public.departments where key = 'choir' and tenant_id = v_tenant_id;

  for v_conflict in
    select sps.service_plan_id, sps.voice_part
    from public.service_plan_singers sps
    join public.service_plans sp on sp.id = sps.service_plan_id
    where sps.singer_id = p_user_id and sp.date = p_date and sp.status <> 'draft'
  loop
    insert into public.replacement_requests (service_plan_id, requested_by, voice_part, target_singer_id)
    values (v_conflict.service_plan_id, p_user_id, v_conflict.voice_part, null)
    returning id into v_replacement_id;

    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    select dm.user_id, 'absence',
      v_full_name || ' needs a replacement (auto-opened)',
      v_full_name || ' is unavailable on ' || p_date::text || ' and was scheduled for ' || v_conflict.voice_part::text
        || ' — a replacement request was opened automatically.',
      p_user_id
    from public.department_memberships dm
    where dm.department_id = v_choir_id
      and dm.role in ('admin', 'secretary') and dm.status = 'approved' and dm.user_id <> p_user_id;
  end loop;

  for v_conflict in
    select id from public.departments where key = 'preaching' and tenant_id = v_tenant_id
    and exists (select 1 from public.preaching_schedule where moderator_id = p_user_id and date = p_date)
  loop
    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    select dm.user_id, 'absence',
      v_full_name || ' — scheduling conflict on ' || p_date::text,
      v_full_name || ' is unavailable and is scheduled as moderator on ' || p_date::text || '. A replacement needs to be arranged.',
      p_user_id
    from public.department_memberships dm
    where dm.department_id = v_conflict.id
      and dm.role in ('admin', 'secretary') and dm.status = 'approved' and dm.user_id <> p_user_id;
  end loop;

  for v_conflict in
    select mta.role, d.id as department_id
    from public.media_tech_assignments mta
    cross join (select id from public.departments where key = 'media_tech' and tenant_id = v_tenant_id) d
    where mta.user_id = p_user_id and mta.date = p_date
  loop
    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    select dm.user_id, 'absence',
      v_full_name || ' — scheduling conflict on ' || p_date::text,
      v_full_name || ' is unavailable and is assigned as ' || v_conflict.role::text || ' on ' || p_date::text || '. A replacement needs to be arranged.',
      p_user_id
    from public.department_memberships dm
    where dm.department_id = v_conflict.department_id
      and dm.role in ('admin', 'secretary') and dm.status = 'approved' and dm.user_id <> p_user_id;
  end loop;

  for v_conflict in
    select es.age_group, d.id as department_id
    from public.ecodem_session_workers esw
    join public.ecodem_sessions es on es.id = esw.session_id
    cross join (select id from public.departments where key = 'ecodem' and tenant_id = v_tenant_id) d
    where esw.user_id = p_user_id and es.date = p_date
  loop
    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    select dm.user_id, 'absence',
      v_full_name || ' — scheduling conflict on ' || p_date::text,
      v_full_name || ' is unavailable and is assigned to ' || v_conflict.age_group::text || ' on ' || p_date::text || '. A replacement worker needs to be arranged.',
      p_user_id
    from public.department_memberships dm
    where dm.department_id = v_conflict.department_id
      and dm.role in ('admin', 'secretary') and dm.status = 'approved' and dm.user_id <> p_user_id;
  end loop;

  for v_conflict in
    select ds.title, ds.department_id
    from public.department_shift_assignments dsa
    join public.department_shifts ds on ds.id = dsa.shift_id
    where dsa.user_id = p_user_id and ds.date = p_date
  loop
    insert into public.notifications (recipient_id, type, title, body, source_user_id)
    select dm.user_id, 'absence',
      v_full_name || ' — scheduling conflict on ' || p_date::text,
      v_full_name || ' is unavailable and is assigned to "' || v_conflict.title || '" on ' || p_date::text || '. A replacement needs to be arranged.',
      p_user_id
    from public.department_memberships dm
    where dm.department_id = v_conflict.department_id
      and dm.role in ('admin', 'secretary') and dm.status = 'approved' and dm.user_id <> p_user_id;
  end loop;
end;
$function$;

create or replace function public.send_replacement_request(p_service_plan_id uuid, p_voice_part voice_part, p_target_singer_id uuid, p_message text)
returns replacement_requests
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_request public.replacement_requests;
  v_choir_id uuid;
  v_full_name text;
  v_plan_title text;
  v_plan_date date;
begin
  if (select tenant_id from public.service_plans where id = p_service_plan_id) is distinct from public.current_tenant_id() then
    raise exception 'Service plan not found';
  end if;
  if p_target_singer_id is not null
     and (select tenant_id from public.profiles where id = p_target_singer_id) is distinct from public.current_tenant_id() then
    raise exception 'Member not found';
  end if;

  insert into public.replacement_requests (service_plan_id, requested_by, voice_part, target_singer_id)
  values (p_service_plan_id, auth.uid(), p_voice_part, p_target_singer_id)
  returning * into v_request;

  select full_name into v_full_name from public.profiles where id = auth.uid();
  select title, date into v_plan_title, v_plan_date from public.service_plans where id = p_service_plan_id;

  if p_target_singer_id is not null then
    insert into public.direct_messages (sender_id, recipient_id, body, related_replacement_request_id)
    values (
      auth.uid(),
      p_target_singer_id,
      coalesce(
        nullif(p_message, ''),
        v_full_name || ' asked you to cover ' || coalesce(v_plan_title, 'a service') || ' on ' || v_plan_date::text || '.'
      ),
      v_request.id
    );
  end if;

  select id into v_choir_id from public.departments where key = 'choir' and tenant_id = public.current_tenant_id();

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  select dm.user_id, 'replacement_request',
    v_full_name || ' requested a replacement',
    v_full_name || ' needs coverage for ' || coalesce(v_plan_title, 'a service') || ' on ' || v_plan_date::text || '.',
    auth.uid()
  from public.department_memberships dm
  where dm.department_id = v_choir_id
    and dm.role in ('admin', 'secretary')
    and dm.status = 'approved'
    and dm.user_id <> auth.uid();

  return v_request;
end;
$function$;

commit;
