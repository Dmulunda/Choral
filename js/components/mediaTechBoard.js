// Media & Tech duty board: named service roles (stream, sound, media
// inventory, camera, slides, video/content creation, photo editing —
// sql/018, sql/060), assigned per service date. Each role gets its own
// multi-select so more than one person can cover a role if needed
// (e.g. a second camera operator). Each assignee then approves or
// declines their own slot (sql/049), same as every other department
// now.
import { t, mediaTechRoleLabel } from '../i18n.js';
import { renderMyAssignmentsPanel } from './myAssignmentsPanel.js';
import { renderAssigneeBadge } from './assignmentStatusBadge.js';
import { todayLocal } from '../utils/date.js';
import { getGlobalRole } from '../departments.js';
import { notifyDepartment } from '../utils/notifyDepartment.js';

const ROLES = ['stream_operator', 'sound_operator', 'media_inventory', 'camera_operator', 'slides_operator', 'video_content_creator', 'photo_editor'];

export function renderMediaTechBoard(container, { supabase, departmentId, canAdminister, userId }) {
  // Super Admin keeps the ability to correct an already-past assignment;
  // every other department admin is hard-blocked (sql/052's DB trigger
  // enforces the same rule), so the picker shouldn't even let them try.
  const dateMinAttr = getGlobalRole() === 'super_admin' ? '' : `min="${todayLocal()}"`;

  container.innerHTML = `
    <div data-el="my-assignments"></div>
    <div data-el="program-panel"></div>
    ${canAdminister ? `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('mediaTech.assignForDate')}</h2>
        <form data-el="form" class="space-y-4">
          <div class="max-w-xs">
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
            <input type="date" name="date" required ${dateMinAttr} class="w-full border border-slate-300 rounded-lg px-3 py-2" />
          </div>
          <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            ${ROLES.map((role) => `
              <div>
                <label class="block text-sm font-medium text-slate-600 mb-1">${mediaTechRoleLabel(role)}</label>
                <select multiple size="4" data-role-select="${role}"
                        class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm"></select>
              </div>
            `).join('')}
          </div>
          <div class="flex items-center gap-3">
            <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
              ${t('mediaTech.save')}
            </button>
            <span data-el="form-status" class="text-sm text-slate-500"></span>
          </div>
        </form>
      </div>
    ` : ''}
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h2 class="text-lg font-semibold mb-4">${t('mediaTech.upcoming')}</h2>
      <div data-el="list" class="space-y-3"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');

  if (userId) {
    renderMyAssignmentsPanel(container.querySelector('[data-el="my-assignments"]'), {
      departmentId,
      fetchMyAssignments: async () => {
        const { data, error } = await supabase
          .from('media_tech_assignments')
          .select('id, date, role, status, reason, working_department_id')
          .eq('user_id', userId)
          .order('date', { ascending: true });
        if (error) return { error };
        return {
          data: (data || []).map((r) => ({
            id: r.id,
            label: mediaTechRoleLabel(r.role),
            date: r.date,
            status: r.status,
            reason: r.reason,
            workingDepartmentId: r.working_department_id,
          })),
        };
      },
      updateAssignment: async (id, patch) => {
        const update = {};
        if ('status' in patch) { update.status = patch.status; update.responded_at = new Date().toISOString(); }
        if ('reason' in patch) update.reason = patch.reason;
        if ('workingDepartmentId' in patch) update.working_department_id = patch.workingDepartmentId;
        const { error } = await supabase.from('media_tech_assignments').update(update).eq('id', id);
        if (!error) load();
        return { error };
      },
    });
  }

  if (form) {
    loadMemberOptions();
    form.elements.date.addEventListener('change', () => prefillFromDate(form.elements.date.value));
    form.addEventListener('submit', handleSubmit);
  }

  load();
  initProgramPanel();

  // "Today's Program" — Choir's song list and Preaching's Bible verse
  // for the next upcoming service. Shown to every Media & Tech member
  // (sql/063 grants read access to the whole department, not just
  // admins/the scheduled Slides Operator) — anyone who can reach this
  // board at all is already an approved member.
  async function initProgramPanel() {
    if (!userId) return;
    renderProgramPanel(container.querySelector('[data-el="program-panel"]'));
  }

  async function renderProgramPanel(el) {
    el.innerHTML = `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('mediaTech.todaysProgram')}</h2>
        <div data-el="program-body" class="text-sm text-slate-500">${t('common.loading')}</div>
      </div>
    `;
    const bodyEl = el.querySelector('[data-el="program-body"]');

    const [{ data: plan }, { data: preaching }] = await Promise.all([
      supabase.from('service_plans').select('id, date, title').gte('date', todayLocal()).order('date', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('preaching_schedule').select('date, sermon_theme, bible_verse').gte('date', todayLocal()).order('date', { ascending: true }).limit(1).maybeSingle(),
    ]);

    let songsHtml = `<p class="text-slate-400">${t('mediaTech.noUpcomingProgram')}</p>`;
    if (plan) {
      const { data: planSongs } = await supabase
        .from('service_plan_songs')
        .select('category, note, songs ( title )')
        .eq('service_plan_id', plan.id)
        .order('position');
      const praise = (planSongs || []).filter((r) => r.category === 'praise' && r.songs).map((r) => r.songs.title);
      const worship = (planSongs || []).filter((r) => r.category === 'worship' && r.songs).map((r) => r.songs.title);
      songsHtml = `
        <div class="font-medium text-slate-800">${escapeHtml(plan.title || '')} <span class="text-slate-400 font-normal">— ${escapeHtml(plan.date)}</span></div>
        <div class="grid sm:grid-cols-2 gap-3 mt-2">
          <div>
            <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${t('requests.praiseSongs')}</div>
            ${praise.length > 0 ? `<ul class="list-disc list-inside text-slate-700">${praise.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : `<p class="text-slate-400">${t('dashboard.noSongsYet')}</p>`}
          </div>
          <div>
            <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${t('requests.worshipSongs')}</div>
            ${worship.length > 0 ? `<ul class="list-disc list-inside text-slate-700">${worship.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>` : `<p class="text-slate-400">${t('dashboard.noSongsYet')}</p>`}
          </div>
        </div>
      `;
    }

    const verseHtml = preaching?.bible_verse
      ? `<div class="font-medium text-indigo-700">${escapeHtml(preaching.bible_verse)}</div>${preaching.sermon_theme ? `<div class="text-slate-500 text-xs mt-0.5">${escapeHtml(preaching.sermon_theme)}</div>` : ''}`
      : `<p class="text-slate-400">${t('mediaTech.noUpcomingVerse')}</p>`;

    bodyEl.innerHTML = `
      <div class="mb-4">${songsHtml}</div>
      <div class="pt-3 border-t border-slate-100">
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">${t('preaching.bibleVerse')}</div>
        ${verseHtml}
      </div>
    `;
  }

  let allMembers = [];

  async function loadMemberOptions() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name, media_tech_skills )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');

    allMembers = (data || []).filter((m) => m.member);
    renderRoleOptions(new Set());
  }

  // Not every Media & Tech member can run every role — each role's
  // select only offers people whose skills (set in the Users tab,
  // sql/050) actually include it, mirroring how Choir only assigns
  // singers to their own voice part. Also excludes anyone who reported
  // themselves unavailable for the selected date, so scheduling someone
  // who already said they can't make it isn't even possible.
  function renderRoleOptions(unavailableIds) {
    ROLES.forEach((role) => {
      const options = allMembers
        .filter((m) => (m.member.media_tech_skills || []).includes(role) && !unavailableIds.has(m.user_id))
        .map((m) => `<option value="${m.user_id}">${escapeHtml(m.member.full_name)}</option>`)
        .join('');
      container.querySelector(`[data-role-select="${role}"]`).innerHTML = options;
    });
  }

  async function prefillFromDate(dateStr) {
    if (!dateStr) { renderRoleOptions(new Set()); return; }

    const [{ data }, { data: unavailableRows }] = await Promise.all([
      supabase
        .from('media_tech_assignments')
        .select('role, user_id, assignee:profiles!user_id ( full_name )')
        .eq('date', dateStr),
      supabase.from('availability').select('user_id').eq('date', dateStr).eq('status', 'unavailable'),
    ]);

    renderRoleOptions(new Set((unavailableRows || []).map((r) => r.user_id)));

    (data || []).forEach((row) => {
      const select = container.querySelector(`[data-role-select="${row.role}"]`);
      if (!select) return;
      let option = select.querySelector(`option[value="${row.user_id}"]`);
      if (!option && row.assignee?.full_name) {
        // Already assigned here but no longer skilled/available for
        // this role — keep them visible and selected so resaving this
        // form doesn't silently drop them; an admin has to deliberately
        // deselect them instead.
        option = document.createElement('option');
        option.value = row.user_id;
        option.textContent = row.assignee.full_name;
        select.appendChild(option);
      }
      if (option) option.selected = true;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const date = form.elements.date.value;
    if (!date) return;

    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('common.saving');

    const { data: { user } } = await supabase.auth.getUser();

    const desired = ROLES.flatMap((role) => {
      const select = container.querySelector(`[data-role-select="${role}"]`);
      return Array.from(select.selectedOptions).map((opt) => ({ role, user_id: opt.value }));
    });
    const desiredKeys = new Set(desired.map((d) => `${d.role}:${d.user_id}`));

    const { data: existing, error: existingError } = await supabase
      .from('media_tech_assignments')
      .select('id, role, user_id')
      .eq('date', date);
    if (existingError) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('mediaTech.saveFailed', { message: existingError.message });
      return;
    }

    // Diff against what's already there rather than delete-everything-
    // then-reinsert — an assignment someone already approved or
    // declined must keep that status if it's still in the desired set;
    // only rows that actually change need to move.
    const existingKeys = new Set((existing || []).map((r) => `${r.role}:${r.user_id}`));
    const toDeleteIds = (existing || []).filter((r) => !desiredKeys.has(`${r.role}:${r.user_id}`)).map((r) => r.id);
    const toInsert = desired.filter((d) => !existingKeys.has(`${d.role}:${d.user_id}`)).map((d) => ({ ...d, date, created_by: user.id }));

    if (toDeleteIds.length > 0) {
      const { error: deleteError } = await supabase.from('media_tech_assignments').delete().in('id', toDeleteIds);
      if (deleteError) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('mediaTech.saveFailed', { message: deleteError.message });
        return;
      }
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from('media_tech_assignments').insert(toInsert);
      if (insertError) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('mediaTech.saveFailed', { message: insertError.message });
        return;
      }
    }

    formStatusEl.textContent = '';
    load();
    if (toInsert.length > 0 || toDeleteIds.length > 0) {
      notifyDepartment(supabase, departmentId, t('notifications.newSchedule'), t('notifications.newScheduleBodyDate', { date }));
    }
  }

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('media_tech_assignments')
      .select('date, role, status, reason, assignee:profiles!user_id ( full_name ), working_department:departments!working_department_id ( key )')
      .order('date', { ascending: true });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('mediaTech.loadFailed', { message: error.message })}</p>`;
      return;
    }

    if (data.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('mediaTech.none')}</p>`;
      return;
    }

    const byDate = new Map();
    data.forEach((row) => {
      if (!byDate.has(row.date)) byDate.set(row.date, new Map());
      const roleMap = byDate.get(row.date);
      if (!roleMap.has(row.role)) roleMap.set(row.role, []);
      if (row.assignee?.full_name) roleMap.get(row.role).push(row);
    });

    listEl.innerHTML = Array.from(byDate.entries()).map(([date, roleMap]) => `
      <div class="border border-slate-200 rounded-lg p-3">
        <div class="text-sm font-semibold text-slate-800 mb-2">${escapeHtml(date)}</div>
        <div class="grid sm:grid-cols-2 gap-2">
          ${ROLES.filter((role) => roleMap.has(role)).map((role) => `
            <div class="text-sm">
              <span class="text-slate-500">${mediaTechRoleLabel(role)}:</span>
              ${roleMap.get(role).length > 0
                ? roleMap.get(role).map((row) => renderAssigneeBadge({
                    name: row.assignee.full_name,
                    status: row.status,
                    reason: row.reason,
                    workingDepartmentKey: row.working_department?.key,
                  })).join(' ')
                : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`
              }
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
