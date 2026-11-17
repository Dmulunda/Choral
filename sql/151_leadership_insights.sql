-- Leadership insights (feature 8 of the improvement roadmap).
--
-- One read-only function that gathers the church's health numbers for the
-- last N weeks so pastors see trends on one page instead of opening six
-- tools: Sunday headcount (Ushers), children (Sunday School), people checked
-- in, new guests, volunteers who served, giving, plus period totals (new
-- members, people who left, open prayer requests, guests waiting for
-- follow-up, small-group attendance).
--
-- Access: pastoral team (is_pastoral_team()). Giving figures are included
-- only for people who already see every offering (can_delete_offerings()),
-- so the page never shows more than the Offerings tool would.
-- Nothing is stored; no new tables.

begin;

create or replace function public.get_leadership_insights(p_weeks integer default 12)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_weeks integer := least(greatest(coalesce(p_weeks, 12), 4), 52);
  v_from date := (date_trunc('week', current_date)::date - (v_weeks - 1) * 7);
  v_giving boolean := public.can_delete_offerings();
  v_ushers uuid;
  v_ecodem uuid;
  v_weekly jsonb;
  v_totals jsonb;
  v_sg bigint;
begin
  if auth.uid() is null or not public.is_pastoral_team() then
    raise exception 'NOT_ALLOWED';
  end if;

  select id into v_ushers from public.departments where key = 'ushers' limit 1;
  select id into v_ecodem from public.departments where key = 'ecodem' limit 1;

  select jsonb_agg(jsonb_build_object(
           'week', w.wk,
           'headcount', (select max(h.total_count) from public.department_headcounts h
                          where h.department_id = v_ushers and h.date >= w.wk and h.date < w.wk + 7),
           'children', (select max(h.total_count) from public.department_headcounts h
                          where h.department_id = v_ecodem and h.date >= w.wk and h.date < w.wk + 7),
           'checked_in', (select count(distinct coalesce(a.member_id::text, lower(a.guest_name)))
                            from public.attendance_records a
                           where a.service_date >= w.wk and a.service_date < w.wk + 7),
           'new_guests', (select count(*) from public.guest_follow_ups g
                           where g.removed_at is null
                             and g.created_at >= w.wk and g.created_at < w.wk + 7),
           'volunteers', (select count(distinct sa.user_id)
                            from public.department_shift_assignments sa
                            join public.department_shifts s on s.id = sa.shift_id
                           where s.date >= w.wk and s.date < w.wk + 7
                             and coalesce(sa.status, '') not in ('declined', 'cancelled')),
           'giving_cents', case when v_giving then
                             (select coalesce(sum(o.amount_cents), 0) from public.offerings o
                               where true
                                 and o.offering_date >= w.wk and o.offering_date < w.wk + 7)
                           end
         ) order by w.wk)
    into v_weekly
    from (select generate_series(v_from, date_trunc('week', current_date)::date, interval '7 days')::date as wk) w;

  -- Small groups (sql 148) may not be applied yet: query it dynamically.
  if to_regclass('public.small_group_meetings') is not null then
    execute 'select coalesce(sum(coalesce(array_length(attendee_ids, 1), 0) + guest_count), 0)
               from public.small_group_meetings where meeting_date >= $1'
      into v_sg using v_from;
  end if;

  v_totals := jsonb_build_object(
    'small_group_attendance', v_sg,
    'new_members', (select count(*) from public.members m
                     where coalesce(m.registered_at, m.created_at) >= v_from),
    'members_total', (select count(*) from public.members m),
    'members_left', (select count(*) from public.member_exits e
                      where e.date_left >= v_from),
    'guests_waiting', (select count(*) from public.guest_follow_ups g
                        where g.removed_at is null
                          and g.follow_up_completed_at is null and g.status = 'new_guest'),
    'prayer_open', (select count(*) from public.prayer_requests p
                     where p.handled_at is null),
    'giving_visible', v_giving,
    'from', v_from,
    'weeks', v_weeks
  );

  return jsonb_build_object('weekly', coalesce(v_weekly, '[]'::jsonb), 'totals', v_totals);
end;
$$;

revoke all on function public.get_leadership_insights(integer) from public, anon;
grant execute on function public.get_leadership_insights(integer) to authenticated;

commit;

select pg_notify('pgrst', 'reload schema');

-- Knowledge-base row for leadership insights (sql/156).

begin;

insert into public.assistant_knowledge_base (topic, content_en, content_fr, audience)
select v.topic, v.content_en, v.content_fr, v.audience
from (values
('Leadership insights', 'Leadership Insights (sidebar, pastoral team only) shows church health on one page: Sunday headcount from Ushers, children from Sunday School, people checked in, new guests, volunteers who served and, for people who can see all offerings, giving — week by week for 8, 12, 26 or 52 weeks. Arrows compare the last 4 weeks with the 4 before. Below are totals for the period: new members, people who left, guests waiting for a call, prayer requests not yet handled and small-group attendance. A dash means nothing was recorded that week.', 'Indicateurs de l''église (barre latérale, équipe pastorale seulement) montre la santé de l''église sur une page : présence du dimanche (Protocole), enfants (École du dimanche), personnes pointées, nouveaux invités, bénévoles ayant servi et, pour ceux qui voient toutes les offrandes, les dons — semaine par semaine sur 8, 12, 26 ou 52 semaines. Les flèches comparent les 4 dernières semaines aux 4 précédentes. En dessous : nouveaux membres, départs, invités en attente d''un appel, demandes de prière non traitées et présence aux petits groupes. Un tiret signifie que rien n''a été enregistré cette semaine-là.', 'pastoral')
) as v(topic, content_en, content_fr, audience)
;

commit;
