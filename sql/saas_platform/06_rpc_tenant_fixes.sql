-- Phase 1.5: tenant-scoping fixes for SECURITY DEFINER RPCs.
--
-- Every function below checks "is the caller an admin/pastoral-team/
-- school-admin" (of their OWN tenant), but several never verified that
-- the ROW being acted on (via its id parameter) actually belongs to that
-- same tenant. Since SECURITY DEFINER functions bypass RLS entirely for
-- their own queries, that check has to be explicit here -- the table's
-- RESTRICTIVE tenant_isolation policy does not help.
--
-- Pattern used throughout: treat "exists in another tenant" the same as
-- "does not exist" (generic "not found"/silent-return), so a caller can't
-- even learn that a given id belongs to someone else's church.
--
-- Functions NOT changed here, and why:
--   refuse_replacement       -- already safe: requires target_singer_id
--                                (a real, tenant-scoped user id) to equal
--                                auth.uid() itself, which a cross-tenant
--                                caller can never satisfy.
--   report_absence           -- self-scoped (auth.uid()'s own data and
--                                own department_memberships) except the
--                                global-role recipients subquery, fixed
--                                below.
--   send_replacement_request,
--   start_direct_call        -- a cross-tenant service_plan_id/recipient
--                                creates orphaned rows invisible to the
--                                other tenant under normal RLS reads (not
--                                a hard leak), but fixed anyway for
--                                hygiene/defense-in-depth.

begin;

create or replace function public.answer_course_question(p_question_id uuid, p_answer_text text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_school_admin() then
    raise exception 'Only a School Admin can answer a course question';
  end if;
  if (select tenant_id from public.course_questions where id = p_question_id) is distinct from public.current_tenant_id() then
    raise exception 'Question not found';
  end if;

  update public.course_questions
  set answer_text = p_answer_text, answered_by = auth.uid(), answered_at = now()
  where id = p_question_id;
end;
$function$;

create or replace function public.claim_replacement(request_id uuid)
 returns replacement_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  req public.replacement_requests;
  caller_voice_parts public.voice_part[];
  v_full_name text;
begin
  select voice_parts into caller_voice_parts from public.profiles where id = auth.uid();

  select * into req from public.replacement_requests where id = request_id for update;

  if req.id is null or req.tenant_id is distinct from public.current_tenant_id() then
    raise exception 'Request not found';
  end if;

  if req.status <> 'open' then
    raise exception 'This request has already been resolved';
  end if;

  if req.requested_by = auth.uid() then
    raise exception 'You cannot claim your own request';
  end if;

  if req.target_singer_id is not null and req.target_singer_id <> auth.uid() then
    raise exception 'This request is targeted at a specific member';
  end if;

  if caller_voice_parts is null or not (req.voice_part = any (caller_voice_parts)) then
    raise exception 'You do not cover this voice part';
  end if;

  update public.replacement_requests
    set status = 'claimed', claimed_by = auth.uid(), resolved_at = now()
    where id = request_id
    returning * into req;

  update public.service_plan_singers
    set singer_id = auth.uid()
    where service_plan_id = req.service_plan_id
      and singer_id = req.requested_by
      and voice_part = req.voice_part;

  select full_name into v_full_name from public.profiles where id = auth.uid();
  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  values (
    req.requested_by,
    'replacement_response',
    v_full_name || ' accepted your replacement request',
    v_full_name || ' will cover for you.',
    auth.uid()
  );

  return req;
end;
$function$;

create or replace function public.get_quiz_questions_for_student(p_lesson_id uuid)
 returns TABLE(id uuid, question_text text, type quiz_question_type, options jsonb, "position" integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_course_id uuid;
begin
  if (select tenant_id from public.lessons where id = p_lesson_id) is distinct from public.current_tenant_id() then
    raise exception 'Lesson not found';
  end if;

  select m.course_id into v_course_id
  from public.lessons l join public.course_modules m on m.id = l.module_id
  where l.id = p_lesson_id;

  if v_course_id is null or not public.has_approved_enrollment(v_course_id) then
    raise exception 'Lesson not found';
  end if;

  return query
    select qq.id, qq.question_text, qq.type, qq.options, qq.position
    from public.quiz_questions qq
    join public.quizzes qz on qz.id = qq.quiz_id
    where qz.lesson_id = p_lesson_id
    order by qq.position;
end;
$function$;

create or replace function public.get_recent_login_activity()
 returns TABLE(user_id uuid, full_name text, logged_in_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select p.id, p.full_name, le.logged_in_at
  from (
    select user_id, logged_in_at,
           row_number() over (partition by user_id order by logged_in_at desc) as rn,
           max(logged_in_at) over (partition by user_id) as most_recent
    from public.login_events
    where tenant_id = public.current_tenant_id()
  ) le
  join public.profiles p on p.id = le.user_id
  where le.rn <= 3
    and public.is_pastoral_team()
  order by le.most_recent desc, p.full_name, le.logged_in_at desc;
$function$;

create or replace function public.get_user_schedule_conflicts(p_user_id uuid, p_date date, p_exclude_department_id uuid)
 returns TABLE(department_name text, context text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if (select tenant_id from public.profiles where id = p_user_id) is distinct from public.current_tenant_id() then
    return;
  end if;

  if not (
    public.is_super_admin()
    or exists (
      select 1 from public.department_memberships
      where user_id = auth.uid() and department_id = p_exclude_department_id
        and role in ('admin', 'secretary') and status = 'approved'
    )
  ) then
    return;
  end if;

  return query
  select d.name, 'Choir (' || sps.voice_part::text || ')'
  from public.service_plan_singers sps
  join public.service_plans sp on sp.id = sps.service_plan_id
  join public.departments d on d.key = 'choir'
  where sps.singer_id = p_user_id and sp.date = p_date and sp.status <> 'draft'
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, 'Preaching (moderator)'
  from public.preaching_schedule ps
  join public.departments d on d.key = 'preaching'
  where ps.moderator_id = p_user_id and ps.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, 'Media & Tech (' || mta.role::text || ')'
  from public.media_tech_assignments mta
  join public.departments d on d.key = 'media_tech'
  where mta.user_id = p_user_id and mta.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, 'Ecodem (' || es.age_group::text || ')'
  from public.ecodem_session_workers esw
  join public.ecodem_sessions es on es.id = esw.session_id
  join public.departments d on d.key = 'ecodem'
  where esw.user_id = p_user_id and es.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select d.name, ds.title
  from public.department_shift_assignments dsa
  join public.department_shifts ds on ds.id = dsa.shift_id
  join public.departments d on d.id = ds.department_id
  where dsa.user_id = p_user_id and ds.date = p_date
    and d.id is distinct from p_exclude_department_id

  union all

  select null::text, 'reported absent'
  where exists (
    select 1 from public.absence_reports
    where user_id = p_user_id and absence_date = p_date
  );
end;
$function$;

create or replace function public.grant_lesson_credit(p_user_id uuid, p_lesson_id uuid, p_score integer DEFAULT NULL::integer)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_course_id uuid;
  v_quiz_id uuid;
  v_passing_score integer;
  v_final_score integer;
begin
  if not public.is_school_admin() then
    raise exception 'Only a School Admin can grant course credit';
  end if;
  if (select tenant_id from public.profiles where id = p_user_id) is distinct from public.current_tenant_id() then
    raise exception 'User not found';
  end if;
  if (select tenant_id from public.lessons where id = p_lesson_id) is distinct from public.current_tenant_id() then
    raise exception 'Lesson not found';
  end if;

  select m.course_id into v_course_id
  from public.lessons l join public.course_modules m on m.id = l.module_id
  where l.id = p_lesson_id;
  if v_course_id is null then
    raise exception 'Lesson not found';
  end if;

  select id, passing_score into v_quiz_id, v_passing_score from public.quizzes where lesson_id = p_lesson_id;
  v_final_score := case when v_quiz_id is not null then coalesce(p_score, v_passing_score) else null end;

  insert into public.course_enrollments (user_id, course_id, status, decided_by, decided_at)
  values (p_user_id, v_course_id, 'approved', auth.uid(), now())
  on conflict (user_id, course_id) do update set
    status = 'approved', decided_by = auth.uid(), decided_at = now()
  where public.course_enrollments.status is distinct from 'approved';

  insert into public.lesson_progress (user_id, lesson_id, watched_ratio, quiz_score, quiz_attempts, completed, completed_at)
  values (p_user_id, p_lesson_id, 1, v_final_score, case when v_quiz_id is not null then 1 else 0 end, true, now())
  on conflict (user_id, lesson_id) do update set
    watched_ratio = 1,
    quiz_score = coalesce(v_final_score, public.lesson_progress.quiz_score),
    quiz_attempts = greatest(public.lesson_progress.quiz_attempts, case when v_quiz_id is not null then 1 else 0 end),
    completed = true,
    completed_at = coalesce(public.lesson_progress.completed_at, now());

  perform public.check_course_completion(v_course_id, p_user_id);
end;
$function$;

create or replace function public.mark_lesson_viewed(p_lesson_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_course_id uuid;
  v_has_quiz boolean;
  v_has_video boolean;
  v_watched_ratio numeric;
begin
  if (select tenant_id from public.lessons where id = p_lesson_id) is distinct from public.current_tenant_id() then
    raise exception 'Lesson not found';
  end if;

  select m.course_id, exists (select 1 from public.quizzes where lesson_id = p_lesson_id), l.video_source is not null
  into v_course_id, v_has_quiz, v_has_video
  from public.lessons l join public.course_modules m on m.id = l.module_id
  where l.id = p_lesson_id;

  if v_course_id is null or not public.has_approved_enrollment(v_course_id) then
    raise exception 'Lesson not found';
  end if;
  if v_has_quiz then
    raise exception 'This lesson has a quiz — complete it to finish the lesson';
  end if;

  if v_has_video then
    select watched_ratio into v_watched_ratio from public.lesson_progress where user_id = auth.uid() and lesson_id = p_lesson_id;
    if coalesce(v_watched_ratio, 0) < 0.9 then
      raise exception 'Watch at least 90%% of the video first';
    end if;
  end if;

  insert into public.lesson_progress (user_id, lesson_id, completed, completed_at)
  values (auth.uid(), p_lesson_id, true, now())
  on conflict (user_id, lesson_id) do update set
    completed = true,
    completed_at = coalesce(public.lesson_progress.completed_at, now());

  perform public.check_course_completion(v_course_id);
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
    or public.can_manage_department((select id from public.departments where key = 'intercession'))
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

create or replace function public.reassign_department_admin(department_id uuid, new_admin_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can reassign a department admin';
  end if;
  if (select tenant_id from public.departments where id = reassign_department_admin.department_id) is distinct from public.current_tenant_id() then
    raise exception 'Department not found';
  end if;
  if (select tenant_id from public.profiles where id = new_admin_user_id) is distinct from public.current_tenant_id() then
    raise exception 'User not found';
  end if;

  update public.department_memberships
  set role = 'admin'
  where department_memberships.department_id = reassign_department_admin.department_id
    and department_memberships.user_id = new_admin_user_id
    and department_memberships.status = 'approved';

  if not found then
    raise exception 'That user does not have an approved membership in this department';
  end if;
end;
$function$;

create or replace function public.reinstate_user(target_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can reinstate a user';
  end if;
  if (select tenant_id from public.profiles where id = target_user_id) is distinct from public.current_tenant_id() then
    raise exception 'User not found';
  end if;

  if exists (select 1 from public.profiles where id = target_user_id and permanently_deleted_at is not null) then
    raise exception 'This user was permanently deleted after the 60-day grace period and can no longer be reinstated';
  end if;

  update public.profiles
  set removed_at = null, removed_by = null
  where id = target_user_id;
end;
$function$;

create or replace function public.remove_user_from_church(target_user_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_super_admin() then
    raise exception 'Only a Super Admin can remove a user from the church';
  end if;
  if (select tenant_id from public.profiles where id = target_user_id) is distinct from public.current_tenant_id() then
    raise exception 'User not found';
  end if;

  delete from public.department_memberships where user_id = target_user_id;

  update public.profiles
  set removed_at = now(), removed_by = auth.uid(), global_role = null
  where id = target_user_id;
end;
$function$;

create or replace function public.report_absence(p_dates date[], p_reason text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_report_id uuid;
  v_first_report_id uuid;
  v_full_name text;
  v_title text;
  v_body text;
  v_date date;
  v_dates date[];
begin
  if p_dates is null or array_length(p_dates, 1) is null then
    raise exception 'At least one date is required';
  end if;
  if array_length(p_dates, 1) > 180 then
    raise exception 'Cannot report more than 180 dates at once';
  end if;

  select array_agg(distinct d order by d) into v_dates from unnest(p_dates) as d;

  select full_name into v_full_name from public.profiles where id = auth.uid();

  v_title := case when array_length(v_dates, 1) = 1
    then v_full_name || ' reported an absence'
    else v_full_name || ' reported ' || array_length(v_dates, 1)::text || ' days unavailable' end;
  v_body := v_full_name || ' will be unavailable on: '
    || (select string_agg(d::text, ', ' order by d) from unnest(v_dates) as d)
    || case when p_reason is not null and p_reason <> '' then '. Reason: ' || p_reason else '' end;

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  select recipient_id, 'absence', v_title, v_body, auth.uid()
  from (
    select dm2.user_id as recipient_id
    from public.department_memberships dm1
    join public.department_memberships dm2
      on dm2.department_id = dm1.department_id
     and dm2.role in ('admin', 'secretary')
     and dm2.status = 'approved'
    where dm1.user_id = auth.uid() and dm1.status = 'approved'
    union
    select id as recipient_id
    from public.profiles
    where global_role in ('super_admin', 'pastor_admin', 'church_secretary')
      and tenant_id = public.current_tenant_id()
  ) recipients
  where recipient_id <> auth.uid();

  foreach v_date in array v_dates loop
    insert into public.absence_reports (user_id, absence_date, reason)
    values (auth.uid(), v_date, p_reason)
    returning id into v_report_id;

    if v_first_report_id is null then
      v_first_report_id := v_report_id;
    end if;

    insert into public.availability (user_id, date, status)
    values (auth.uid(), v_date, 'unavailable')
    on conflict (user_id, date) do update set status = 'unavailable';
  end loop;

  return v_first_report_id;
end;
$function$;

create or replace function public.request_course_enrollment(p_course_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.courses where id = p_course_id and published and tenant_id = public.current_tenant_id()) then
    raise exception 'Course not found';
  end if;

  insert into public.course_enrollments (user_id, course_id, status, requested_at, decided_by, decided_at)
  values (auth.uid(), p_course_id, 'pending', now(), null, null)
  on conflict (user_id, course_id) do update set
    status = 'pending', requested_at = now(), decided_by = null, decided_at = null
  where public.course_enrollments.status is distinct from 'approved';
end;
$function$;

create or replace function public.respond_to_pastor_meeting_request(p_request_id uuid, p_status pastor_meeting_status)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not (public.is_church_secretary() or public.is_super_admin()) then
    raise exception 'Only the Church Secretary can respond to a pastor meeting request';
  end if;
  if (select tenant_id from public.pastor_meeting_requests where id = p_request_id) is distinct from public.current_tenant_id() then
    raise exception 'Request not found';
  end if;
  if p_status = 'pending' then
    raise exception 'Cannot set a request back to pending';
  end if;

  update public.pastor_meeting_requests
  set status = p_status, confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_request_id;
end;
$function$;

create or replace function public.review_course_approval(p_approval_id uuid, p_status course_approval_status)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_school_admin() then
    raise exception 'Only a School Admin can review course approvals';
  end if;
  if (select tenant_id from public.course_approvals where id = p_approval_id) is distinct from public.current_tenant_id() then
    raise exception 'Approval not found';
  end if;

  update public.course_approvals
  set status = p_status, approved_by = auth.uid(), approved_at = now()
  where id = p_approval_id;
end;
$function$;

create or replace function public.review_course_enrollment(p_enrollment_id uuid, p_status course_enrollment_status)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not public.is_school_admin() then
    raise exception 'Only a School Admin can review enrollment requests';
  end if;
  if (select tenant_id from public.course_enrollments where id = p_enrollment_id) is distinct from public.current_tenant_id() then
    raise exception 'Enrollment not found';
  end if;
  if p_status = 'pending' then
    raise exception 'Cannot set an enrollment back to pending';
  end if;

  update public.course_enrollments
  set status = p_status, decided_by = auth.uid(), decided_at = now()
  where id = p_enrollment_id;
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

  select id into v_choir_id from public.departments where key = 'choir';

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

create or replace function public.start_direct_call(p_recipient_id uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_room text;
  v_caller_name text;
begin
  if not public.is_any_admin() then
    raise exception 'Only an admin can start a direct call';
  end if;
  if p_recipient_id = auth.uid() then
    raise exception 'Cannot call yourself';
  end if;
  if (select tenant_id from public.profiles where id = p_recipient_id) is distinct from public.current_tenant_id() then
    raise exception 'Member not found';
  end if;

  v_room := 'choir-app-call-' || gen_random_uuid()::text;
  select full_name into v_caller_name from public.profiles where id = auth.uid();

  insert into public.direct_calls (caller_id, recipient_id, room)
  values (auth.uid(), p_recipient_id, v_room);

  insert into public.notifications (recipient_id, type, title, body, source_user_id)
  values (p_recipient_id, 'call_invite', coalesce(v_caller_name, 'Someone') || ' is calling you', v_room, auth.uid());

  return v_room;
end;
$function$;

create or replace function public.submit_quiz_attempt(p_lesson_id uuid, p_answers jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_course_id uuid;
  v_watched_ratio numeric;
  v_passing_score integer;
  v_quiz_id uuid;
  v_total integer := 0;
  v_correct integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_q record;
  v_submitted text;
  v_is_correct boolean;
  v_passed boolean;
begin
  if (select tenant_id from public.lessons where id = p_lesson_id) is distinct from public.current_tenant_id() then
    raise exception 'Lesson not found';
  end if;

  select c.id into v_course_id
  from public.lessons l join public.course_modules m on m.id = l.module_id join public.courses c on c.id = m.course_id
  where l.id = p_lesson_id;

  if v_course_id is null or not public.has_approved_enrollment(v_course_id) then
    raise exception 'Lesson not found';
  end if;

  select id, passing_score into v_quiz_id, v_passing_score from public.quizzes where lesson_id = p_lesson_id;
  if v_quiz_id is null then
    raise exception 'This lesson has no quiz';
  end if;

  select watched_ratio into v_watched_ratio from public.lesson_progress where user_id = auth.uid() and lesson_id = p_lesson_id;
  if coalesce(v_watched_ratio, 0) < 0.9 and exists (select 1 from public.lessons where id = p_lesson_id and video_source is not null) then
    raise exception 'Watch at least 90%% of the video before taking the quiz';
  end if;

  for v_q in select id, correct_answer from public.quiz_questions where quiz_id = v_quiz_id order by position loop
    v_total := v_total + 1;
    select value ->> 'answer' into v_submitted
    from jsonb_array_elements(p_answers) as value
    where value ->> 'question_id' = v_q.id::text;

    v_is_correct := v_submitted is not null and lower(trim(v_submitted)) = lower(trim(v_q.correct_answer));
    if v_is_correct then v_correct := v_correct + 1; end if;

    v_results := v_results || jsonb_build_object('question_id', v_q.id, 'correct', v_is_correct);
  end loop;

  v_passed := v_correct >= v_passing_score;

  insert into public.lesson_progress (user_id, lesson_id, quiz_score, quiz_attempts, completed, completed_at)
  values (auth.uid(), p_lesson_id, v_correct, 1, v_passed, case when v_passed then now() else null end)
  on conflict (user_id, lesson_id) do update set
    quiz_score = v_correct,
    quiz_attempts = public.lesson_progress.quiz_attempts + 1,
    completed = public.lesson_progress.completed or v_passed,
    completed_at = case when public.lesson_progress.completed then public.lesson_progress.completed_at when v_passed then now() else null end;

  if v_passed then
    perform public.check_course_completion(v_course_id);
  end if;

  return jsonb_build_object('score', v_correct, 'total', v_total, 'passed', v_passed, 'results', v_results);
end;
$function$;

create or replace function public.transfer_guest_to_department(p_guest_follow_up_id uuid, p_department_id uuid, p_note text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_current_department_id uuid;
begin
  if (select tenant_id from public.guest_follow_ups where id = p_guest_follow_up_id) is distinct from public.current_tenant_id() then
    raise exception 'Case not found';
  end if;
  if (select tenant_id from public.departments where id = p_department_id) is distinct from public.current_tenant_id() then
    raise exception 'Department not found';
  end if;

  select assigned_department_id into v_current_department_id
  from public.guest_follow_ups where id = p_guest_follow_up_id;

  if not (
    public.is_pastoral_team()
    or (v_current_department_id is not null and public.can_write_department(v_current_department_id))
  ) then
    raise exception 'You do not currently hold this case';
  end if;

  update public.guest_follow_ups
  set assigned_department_id = p_department_id, updated_at = now()
  where id = p_guest_follow_up_id;

  insert into public.guest_follow_up_transfers (guest_follow_up_id, from_department_id, to_department_id, note, transferred_by)
  values (p_guest_follow_up_id, v_current_department_id, p_department_id, nullif(p_note, ''), auth.uid());
end;
$function$;

create or replace function public.transfer_member_case_to_department(p_member_case_id uuid, p_department_id uuid, p_note text DEFAULT NULL::text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_current_department_id uuid;
begin
  if (select tenant_id from public.member_cases where id = p_member_case_id) is distinct from public.current_tenant_id() then
    raise exception 'Case not found';
  end if;
  if (select tenant_id from public.departments where id = p_department_id) is distinct from public.current_tenant_id() then
    raise exception 'Department not found';
  end if;

  select assigned_department_id into v_current_department_id
  from public.member_cases where id = p_member_case_id;

  if not (
    public.is_pastoral_team()
    or (v_current_department_id is not null and public.can_write_department(v_current_department_id))
  ) then
    raise exception 'You do not currently hold this case';
  end if;

  update public.member_cases
  set assigned_department_id = p_department_id, updated_at = now()
  where id = p_member_case_id;

  insert into public.member_case_transfers (member_case_id, from_department_id, to_department_id, note, transferred_by)
  values (p_member_case_id, v_current_department_id, p_department_id, nullif(p_note, ''), auth.uid());
end;
$function$;

create or replace function public.update_watch_progress(p_lesson_id uuid, p_ratio numeric)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_course_id uuid;
begin
  if (select tenant_id from public.lessons where id = p_lesson_id) is distinct from public.current_tenant_id() then
    raise exception 'Lesson not found';
  end if;

  select m.course_id into v_course_id
  from public.lessons l join public.course_modules m on m.id = l.module_id
  where l.id = p_lesson_id;

  if v_course_id is null or not public.has_approved_enrollment(v_course_id) then
    raise exception 'Lesson not found';
  end if;

  insert into public.lesson_progress (user_id, lesson_id, watched_ratio)
  values (auth.uid(), p_lesson_id, greatest(0, least(1, p_ratio)))
  on conflict (user_id, lesson_id)
  do update set watched_ratio = greatest(public.lesson_progress.watched_ratio, excluded.watched_ratio), updated_at = now();
end;
$function$;

commit;

select pg_notify('pgrst', 'reload schema');
