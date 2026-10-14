// Ecodem (Children's Ministry / Sunday School) board: three internal
// sub-tabs. Sessions (original content, unchanged except for the new
// "registered children" line/manage toggle) -- three age groups, each
// with a lesson topic and up to two assigned workers per scheduled
// date, at least one required. Children (sql/saas_platform/85) -- a
// roster with allergies/medical/emergency-contact info, visible to
// this department's own approved members only (can_read_department),
// hidden from the rest of the church -- that's already "authorized
// teachers and leaders," no extra narrower gate needed. Parent
// Requests -- leader-recorded tracking of which children's parents
// have acknowledged a request (permission forms, reminders); no
// parent login/portal exists, acknowledgement is recorded by a leader.
import { t, ecodemAgeGroupLabel } from '../i18n.js';
import { renderMyAssignmentsPanel } from './myAssignmentsPanel.js';
import { renderAssigneeBadge } from './assignmentStatusBadge.js';
import { confirmDialog } from './confirmDialog.js';
import { todayLocal } from '../utils/date.js';
import { getGlobalRole } from '../departments.js';
import { notifyDepartment } from '../utils/notifyDepartment.js';
import { checkAndConfirmBatchAssignment } from '../utils/schedulingConflicts.js';

const AGE_GROUPS = ['group_1', 'group_2', 'group_3'];
const SUB_TABS = ['sessions', 'children', 'parent-requests'];

export function renderEcodemBoard(container, { supabase, departmentId, canAdminister, userId }) {
  container.innerHTML = `
    <div class="flex items-center gap-1 mb-4 border-b border-slate-200">
      <button type="button" data-subtab="sessions" class="px-3 py-2 text-sm font-medium border-b-2 -mb-px">${t('ecodem.tabSessions')}</button>
      <button type="button" data-subtab="children" class="px-3 py-2 text-sm font-medium border-b-2 -mb-px">${t('ecodem.tabChildren')}</button>
      <button type="button" data-subtab="parent-requests" class="px-3 py-2 text-sm font-medium border-b-2 -mb-px">${t('ecodem.tabParentRequests')}</button>
    </div>
    <div data-el="subtab-content"></div>
  `;

  const subtabButtons = container.querySelectorAll('[data-subtab]');
  const contentEl = container.querySelector('[data-el="subtab-content"]');

  function activateSubtab(name) {
    subtabButtons.forEach((btn) => {
      const active = btn.dataset.subtab === name;
      btn.classList.toggle('border-indigo-600', active);
      btn.classList.toggle('text-indigo-600', active);
      btn.classList.toggle('border-transparent', !active);
      btn.classList.toggle('text-slate-500', !active);
    });
    if (name === 'sessions') renderSessionsSubTab(contentEl);
    else if (name === 'children') renderChildrenSubTab(contentEl);
    else renderParentRequestsSubTab(contentEl);
  }
  subtabButtons.forEach((btn) => btn.addEventListener('click', () => activateSubtab(btn.dataset.subtab)));
  activateSubtab(SUB_TABS[0]);

  // ---- Sessions (original content) ----
  function renderSessionsSubTab(sessionsContainer) {
    const dateMinAttr = getGlobalRole() === 'super_admin' ? '' : `min="${todayLocal()}"`;

    sessionsContainer.innerHTML = `
      <div data-el="my-assignments"></div>
      ${canAdminister ? `
        <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
          <h2 class="text-lg font-semibold mb-4">${t('ecodem.scheduleSession')}</h2>
          <form data-el="form" class="space-y-6">
            <div class="max-w-xs">
              <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
              <input type="date" name="date" required ${dateMinAttr} class="w-full border border-slate-300 rounded-lg px-3 py-2" />
            </div>
            <div class="grid sm:grid-cols-3 gap-4">
              ${AGE_GROUPS.map((group) => `
                <div class="border border-slate-200 rounded-lg p-3" data-group-block="${group}">
                  <div class="text-sm font-semibold text-slate-700 mb-2">${ecodemAgeGroupLabel(group)}</div>
                  <label class="block text-xs font-medium text-slate-500 mb-1">${t('ecodem.topic')}</label>
                  <input type="text" data-group-topic="${group}" placeholder="${t('ecodem.topicPlaceholder')}"
                         class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mb-2" />
                  <label class="block text-xs font-medium text-slate-500 mb-1">${t('ecodem.worker1')}</label>
                  <select data-group-worker="${group}-1" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mb-2">
                    <option value="">—</option>
                  </select>
                  <label class="block text-xs font-medium text-slate-500 mb-1">${t('ecodem.worker2')} <span class="font-normal text-slate-400">(${t('ecodem.optional')})</span></label>
                  <select data-group-worker="${group}-2" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                    <option value="">—</option>
                  </select>
                </div>
              `).join('')}
            </div>
            <div class="flex items-center gap-3">
              <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
                ${t('ecodem.save')}
              </button>
              <span data-el="form-status" class="text-sm text-slate-500"></span>
            </div>
          </form>
        </div>
      ` : ''}
      <div class="bg-white rounded-xl shadow p-4 sm:p-6">
        <h2 class="text-lg font-semibold mb-4">${t('ecodem.upcoming')}</h2>
        <div data-el="list" class="space-y-3"></div>
      </div>
    `;

    const form = sessionsContainer.querySelector('[data-el="form"]');
    const formStatusEl = sessionsContainer.querySelector('[data-el="form-status"]');
    const listEl = sessionsContainer.querySelector('[data-el="list"]');

    if (userId) {
      renderMyAssignmentsPanel(sessionsContainer.querySelector('[data-el="my-assignments"]'), {
        departmentId,
        fetchMyAssignments: async () => {
          const { data, error } = await supabase
            .from('ecodem_session_workers')
            .select('id, status, reason, working_department_id, session:ecodem_sessions ( date, age_group )')
            .eq('user_id', userId)
            .order('date', { foreignTable: 'ecodem_sessions', ascending: true });
          if (error) return { error };
          return {
            data: (data || []).filter((r) => r.session).map((r) => ({
              id: r.id,
              label: ecodemAgeGroupLabel(r.session.age_group),
              date: r.session.date,
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
          const { error } = await supabase.from('ecodem_session_workers').update(update).eq('id', id);
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

    let allMembers = [];
    let allChildren = [];

    async function loadMemberOptions() {
      const { data } = await supabase
        .from('department_memberships')
        .select('user_id, member:profiles!user_id ( full_name )')
        .eq('department_id', departmentId)
        .eq('status', 'approved');

      allMembers = (data || []).filter((m) => m.member);
      renderWorkerOptions(new Set());
    }

    function renderWorkerOptions(unavailableIds, conflictMap = new Map()) {
      const options = allMembers
        .filter((m) => !unavailableIds.has(m.user_id))
        .map((m) => {
          const conflictDept = conflictMap.get(m.user_id);
          const note = conflictDept ? ` (${t('deptScheduling.alreadyAssignedTo', { department: conflictDept })})` : '';
          return `<option value="${m.user_id}">${escapeHtml(m.member.full_name)}${note}</option>`;
        })
        .join('');

      AGE_GROUPS.forEach((group) => {
        ['1', '2'].forEach((slot) => {
          const select = sessionsContainer.querySelector(`[data-group-worker="${group}-${slot}"]`);
          select.innerHTML = `<option value="">—</option>` + options;
        });
      });
    }

    async function prefillFromDate(dateStr) {
      if (!dateStr) {
        renderWorkerOptions(new Set());
        AGE_GROUPS.forEach((group) => {
          sessionsContainer.querySelector(`[data-group-topic="${group}"]`).value = '';
        });
        return;
      }

      const [{ data: sessions }, { data: unavailableRows }, { data: conflictRows }] = await Promise.all([
        supabase
          .from('ecodem_sessions')
          .select('id, age_group, topic, ecodem_session_workers ( user_id, worker:profiles!user_id ( full_name ) )')
          .eq('date', dateStr),
        supabase.from('availability').select('user_id').eq('date', dateStr).eq('status', 'unavailable'),
        supabase.rpc('get_all_schedule_conflicts_for_date', { p_date: dateStr, p_exclude_department_id: departmentId }),
      ]);

      renderWorkerOptions(
        new Set((unavailableRows || []).map((r) => r.user_id)),
        new Map((conflictRows || []).map((r) => [r.user_id, r.department_name])),
      );

      AGE_GROUPS.forEach((group) => { sessionsContainer.querySelector(`[data-group-topic="${group}"]`).value = ''; });

      (sessions || []).forEach((session) => {
        sessionsContainer.querySelector(`[data-group-topic="${session.age_group}"]`).value = session.topic || '';
        (session.ecodem_session_workers || []).forEach((worker, idx) => {
          if (idx > 1) return;
          const select = sessionsContainer.querySelector(`[data-group-worker="${session.age_group}-${idx + 1}"]`);
          if (!select) return;
          if (!select.querySelector(`option[value="${worker.user_id}"]`) && worker.worker?.full_name) {
            const option = document.createElement('option');
            option.value = worker.user_id;
            option.textContent = worker.worker.full_name;
            select.appendChild(option);
          }
          select.value = worker.user_id;
        });
      });
    }

    async function handleSubmit(e) {
      e.preventDefault();
      const date = form.elements.date.value;
      if (!date) return;

      const groupsToSave = [];
      for (const group of AGE_GROUPS) {
        const topic = sessionsContainer.querySelector(`[data-group-topic="${group}"]`).value.trim();
        const worker1 = sessionsContainer.querySelector(`[data-group-worker="${group}-1"]`).value;
        const worker2 = sessionsContainer.querySelector(`[data-group-worker="${group}-2"]`).value;

        if (!topic && !worker1 && !worker2) continue;

        if (!worker1) {
          formStatusEl.className = 'text-sm text-rose-600';
          formStatusEl.textContent = `${ecodemAgeGroupLabel(group)} ${t('ecodem.atLeastOneWorkerRequired')}`;
          return;
        }

        const worker1Label = sessionsContainer.querySelector(`[data-group-worker="${group}-1"]`).selectedOptions[0]?.textContent || worker1;
        const worker2Label = sessionsContainer.querySelector(`[data-group-worker="${group}-2"]`).selectedOptions[0]?.textContent || worker2;
        const pairs = [[worker1, worker1Label], [worker2, worker2Label]].filter(([userId2]) => !!userId2);
        groupsToSave.push({ group, topic: topic || null, workers: pairs.map(([userId2]) => userId2), workerLabels: pairs.map(([, label]) => label) });
      }

      const allWorkerAssignments = groupsToSave.flatMap(({ workers, workerLabels }) =>
        workers.map((userId2, i) => ({ userId: userId2, userLabel: workerLabels[i], date })));
      if (allWorkerAssignments.length > 0) {
        const proceed = await checkAndConfirmBatchAssignment({ supabase, departmentId, assignments: allWorkerAssignments });
        if (!proceed) return;
      }

      formStatusEl.className = 'text-sm text-slate-500';
      formStatusEl.textContent = t('common.saving');

      const { data: { user } } = await supabase.auth.getUser();

      for (const { group, topic, workers } of groupsToSave) {
        const { data: session, error: upsertError } = await supabase
          .from('ecodem_sessions')
          .upsert({ date, age_group: group, topic, created_by: user.id }, { onConflict: 'date,age_group' })
          .select('id')
          .single();

        if (upsertError) {
          formStatusEl.className = 'text-sm text-rose-600';
          formStatusEl.textContent = t('ecodem.saveFailed', { message: upsertError.message });
          return;
        }

        const { data: existingWorkers, error: existingError } = await supabase
          .from('ecodem_session_workers')
          .select('id, user_id')
          .eq('session_id', session.id);
        if (existingError) {
          formStatusEl.className = 'text-sm text-rose-600';
          formStatusEl.textContent = t('ecodem.saveFailed', { message: existingError.message });
          return;
        }

        const existingUserIds = new Set((existingWorkers || []).map((w) => w.user_id));
        const toDeleteIds = (existingWorkers || []).filter((w) => !workers.includes(w.user_id)).map((w) => w.id);
        const toInsert = workers.filter((user_id) => !existingUserIds.has(user_id)).map((user_id) => ({ session_id: session.id, user_id }));

        if (toDeleteIds.length > 0) {
          const { error: deleteError } = await supabase.from('ecodem_session_workers').delete().in('id', toDeleteIds);
          if (deleteError) {
            formStatusEl.className = 'text-sm text-rose-600';
            formStatusEl.textContent = t('ecodem.saveFailed', { message: deleteError.message });
            return;
          }
        }

        const { error: insertError } = toInsert.length > 0
          ? await supabase.from('ecodem_session_workers').insert(toInsert)
          : { error: null };

        if (insertError) {
          formStatusEl.className = 'text-sm text-rose-600';
          formStatusEl.textContent = t('ecodem.saveFailed', { message: insertError.message });
          return;
        }
      }

      form.reset();
      formStatusEl.textContent = '';
      load();
      if (groupsToSave.length > 0) {
        notifyDepartment(supabase, departmentId, t('notifications.newSchedule'), t('notifications.newScheduleBodyDate', { date }));
      }
    }

    async function load() {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

      const [{ data: children }, listResult] = await Promise.all([
        supabase.from('ecodem_children').select('id, full_name, age_group').order('full_name'),
        (() => {
          let listQuery = supabase
            .from('ecodem_sessions')
            .select('id, date, age_group, topic, ecodem_session_workers ( status, reason, worker:profiles!user_id ( full_name ), working_department:departments!working_department_id ( key ) ), ecodem_session_registrations ( child_id )');
          if (getGlobalRole() !== 'super_admin') listQuery = listQuery.gte('date', todayLocal());
          return listQuery.order('date', { ascending: true });
        })(),
      ]);
      const { data, error } = listResult;
      allChildren = children || [];

      if (error) {
        listEl.innerHTML = `<p class="text-sm text-rose-600">${t('ecodem.loadFailed', { message: error.message })}</p>`;
        return;
      }

      if (data.length === 0) {
        listEl.innerHTML = `<p class="text-sm text-slate-500">${t('ecodem.none')}</p>`;
        return;
      }

      const byDate = new Map();
      data.forEach((session) => {
        if (!byDate.has(session.date)) byDate.set(session.date, []);
        byDate.get(session.date).push(session);
      });

      listEl.innerHTML = Array.from(byDate.entries()).map(([date, sessions]) => `
        <div class="border border-slate-200 rounded-lg p-3">
          <div class="text-sm font-semibold text-slate-800 mb-2">${escapeHtml(date)}</div>
          <div class="grid sm:grid-cols-3 gap-3">
            ${sessions.map((session) => {
              const workers = (session.ecodem_session_workers || []).filter((w) => w.worker?.full_name);
              const registeredIds = new Set((session.ecodem_session_registrations || []).map((r) => r.child_id));
              return `
                <div class="text-sm" data-session-card="${session.id}">
                  <div class="flex items-baseline justify-between gap-2">
                    <div class="font-medium text-slate-700">${ecodemAgeGroupLabel(session.age_group)}</div>
                    ${canAdminister ? `<button type="button" data-action="delete" data-session-id="${session.id}" class="text-xs font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap">${t('ecodem.delete')}</button>` : ''}
                  </div>
                  <div class="text-slate-600">${session.topic ? escapeHtml(session.topic) : `<span class="text-slate-400">${t('ecodem.noTopic')}</span>`}</div>
                  <div class="text-slate-500 mt-1 flex flex-wrap gap-1">${workers.length > 0
                    ? workers.map((w) => renderAssigneeBadge({
                        name: w.worker.full_name,
                        status: w.status,
                        reason: w.reason,
                        workingDepartmentKey: w.working_department?.key,
                      })).join('')
                    : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}</div>
                  <div class="mt-2 text-xs">
                    <button type="button" data-action="toggle-registrations" data-session-id="${session.id}" data-age-group="${session.age_group}" class="text-indigo-600 hover:text-indigo-700 font-medium">
                      ${t('ecodem.registeredCount', { count: registeredIds.size })}
                    </button>
                    <div data-el="registrations-panel" class="hidden mt-1 border border-slate-200 rounded-lg p-2 space-y-1"></div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `).join('');
    }

    listEl.addEventListener('click', async (e) => {
      const deleteBtn = e.target.closest('[data-action="delete"]');
      if (deleteBtn) {
        const sessionId = deleteBtn.dataset.sessionId;
        if (!(await confirmDialog({ message: t('ecodem.confirmDelete') }))) return;
        const { error } = await supabase.from('ecodem_sessions').delete().eq('id', sessionId);
        if (error) {
          window.alert(t('ecodem.deleteFailed', { message: error.message }));
          return;
        }
        load();
        return;
      }

      const toggleBtn = e.target.closest('[data-action="toggle-registrations"]');
      if (toggleBtn) {
        const sessionId = toggleBtn.dataset.sessionId;
        const ageGroup = toggleBtn.dataset.ageGroup;
        const card = toggleBtn.closest('[data-session-card]');
        const panel = card.querySelector('[data-el="registrations-panel"]');
        const isHidden = panel.classList.contains('hidden');
        panel.classList.toggle('hidden');
        if (isHidden) await renderRegistrationsPanel(panel, sessionId, ageGroup);
        return;
      }

      const toggleChildBtn = e.target.closest('[data-action="toggle-child-registration"]');
      if (toggleChildBtn) {
        const sessionId = toggleChildBtn.dataset.sessionId;
        const childId = toggleChildBtn.dataset.childId;
        const panel = toggleChildBtn.closest('[data-el="registrations-panel"]');
        if (toggleChildBtn.checked) {
          await supabase.from('ecodem_session_registrations').insert({ session_id: sessionId, child_id: childId });
        } else {
          await supabase.from('ecodem_session_registrations').delete().eq('session_id', sessionId).eq('child_id', childId);
        }
        const toggleCountBtn = panel.closest('[data-session-card]').querySelector('[data-action="toggle-registrations"]');
        const { count } = await supabase.from('ecodem_session_registrations').select('*', { count: 'exact', head: true }).eq('session_id', sessionId);
        toggleCountBtn.textContent = t('ecodem.registeredCount', { count: count || 0 });
      }
    });

    async function renderRegistrationsPanel(panel, sessionId, ageGroup) {
      panel.innerHTML = `<p class="text-slate-400">${t('common.loading')}</p>`;
      const { data: registered } = await supabase.from('ecodem_session_registrations').select('child_id').eq('session_id', sessionId);
      const registeredIds = new Set((registered || []).map((r) => r.child_id));
      const candidates = allChildren.filter((c) => c.age_group === ageGroup);
      if (candidates.length === 0) {
        panel.innerHTML = `<p class="text-slate-400">${t('ecodem.noChildrenInGroup')}</p>`;
        return;
      }
      panel.innerHTML = candidates.map((c) => `
        <label class="flex items-center gap-2">
          <input type="checkbox" data-action="toggle-child-registration" data-session-id="${sessionId}" data-child-id="${c.id}" ${registeredIds.has(c.id) ? 'checked' : ''} />
          ${escapeHtml(c.full_name)}
        </label>
      `).join('');
    }
  }

  // ---- Children roster ----
  function renderChildrenSubTab(el) {
    el.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    loadChildren();

    async function loadChildren() {
      const { data: children, error } = await supabase.from('ecodem_children').select('*').order('full_name');
      if (error) {
        el.innerHTML = `<p class="text-rose-600">${t('ecodem.loadChildrenFailed', { message: error.message })}</p>`;
        return;
      }

      el.innerHTML = `
        ${canAdminister ? `<button type="button" data-action="add-child" class="mb-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('ecodem.addChild')}</button>` : ''}
        <div data-el="children-list" class="space-y-2"></div>
      `;

      const listEl = el.querySelector('[data-el="children-list"]');
      if ((children || []).length === 0) {
        listEl.innerHTML = `<p class="text-sm text-slate-400">${t('ecodem.noChildren')}</p>`;
      } else {
        listEl.innerHTML = children.map((c) => `
          <div class="border border-slate-200 rounded-lg p-3" data-child-id="${c.id}">
            <div class="flex items-center gap-3">
              ${c.photo_url ? `<img src="${escapeAttr(c.photo_url)}" alt="" class="w-10 h-10 rounded-full object-cover" />` : ''}
              <div class="flex-1">
                <p class="text-sm font-medium text-slate-700">${escapeHtml(c.full_name)} ${c.age_group ? `<span class="text-xs text-slate-400">(${ecodemAgeGroupLabel(c.age_group)})</span>` : ''}</p>
                ${c.parent_name ? `<p class="text-xs text-slate-500">${t('ecodem.parent')}: ${escapeHtml(c.parent_name)} ${c.parent_phone ? `— ${escapeHtml(c.parent_phone)}` : ''}</p>` : ''}
              </div>
              ${canAdminister ? `<button type="button" data-action="delete-child" class="text-xs text-rose-600 hover:text-rose-700">${t('ecodem.delete')}</button>` : ''}
            </div>
            ${c.allergies ? `<p class="text-xs text-rose-600 mt-1">⚠ ${t('ecodem.allergies')}: ${escapeHtml(c.allergies)}</p>` : ''}
            ${c.medical_notes ? `<p class="text-xs text-slate-500 mt-1">${t('ecodem.medicalNotes')}: ${escapeHtml(c.medical_notes)}</p>` : ''}
          </div>
        `).join('');

        listEl.querySelectorAll('[data-action="delete-child"]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const card = btn.closest('[data-child-id]');
            const id = card.dataset.childId;
            const child = children.find((c) => c.id === id);
            const ok = await confirmDialog({ message: t('ecodem.confirmDeleteChild', { name: child.full_name }), danger: true });
            if (!ok) return;
            await supabase.from('ecodem_children').delete().eq('id', id);
            loadChildren();
          });
        });
      }

      el.querySelector('[data-action="add-child"]')?.addEventListener('click', () => {
        const formHtml = `
          <div data-el="add-child-form" class="mb-4 border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-2">
            <input type="text" data-el="full-name" placeholder="${t('ecodem.childNamePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
            <select data-el="age-group" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm">
              <option value="">${t('ecodem.selectAgeGroup')}</option>
              ${AGE_GROUPS.map((g) => `<option value="${g}">${ecodemAgeGroupLabel(g)}</option>`).join('')}
            </select>
            <input type="text" data-el="parent-name" placeholder="${t('ecodem.parentNamePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
            <input type="text" data-el="parent-phone" placeholder="${t('ecodem.parentPhonePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
            <textarea data-el="allergies" placeholder="${t('ecodem.allergiesPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"></textarea>
            <textarea data-el="medical-notes" placeholder="${t('ecodem.medicalNotesPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"></textarea>
            <div class="flex gap-2">
              <button type="button" data-action="save-child" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t("ecodem.saveGeneric")}</button>
              <button type="button" data-action="cancel-child" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('common.cancel')}</button>
            </div>
          </div>
        `;
        el.querySelector('[data-action="add-child"]').insertAdjacentHTML('afterend', formHtml);
        const formEl = el.querySelector('[data-el="add-child-form"]');
        formEl.querySelector('[data-action="cancel-child"]').addEventListener('click', () => formEl.remove());
        formEl.querySelector('[data-action="save-child"]').addEventListener('click', async () => {
          const fullName = formEl.querySelector('[data-el="full-name"]').value.trim();
          if (!fullName) return;
          const { data: { user } } = await supabase.auth.getUser();
          await supabase.from('ecodem_children').insert({
            full_name: fullName,
            age_group: formEl.querySelector('[data-el="age-group"]').value || null,
            parent_name: formEl.querySelector('[data-el="parent-name"]').value.trim() || null,
            parent_phone: formEl.querySelector('[data-el="parent-phone"]').value.trim() || null,
            allergies: formEl.querySelector('[data-el="allergies"]').value.trim() || null,
            medical_notes: formEl.querySelector('[data-el="medical-notes"]').value.trim() || null,
            created_by: user.id,
          });
          loadChildren();
        });
      });
    }
  }

  // ---- Parent Requests ----
  function renderParentRequestsSubTab(el) {
    el.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;
    loadRequests();

    async function loadRequests() {
      const [{ data: requests, error }, { data: children }] = await Promise.all([
        supabase.from('ecodem_parent_requests').select('*').order('created_at', { ascending: false }),
        supabase.from('ecodem_children').select('id, full_name').order('full_name'),
      ]);
      if (error) {
        el.innerHTML = `<p class="text-rose-600">${t('ecodem.loadRequestsFailed', { message: error.message })}</p>`;
        return;
      }

      el.innerHTML = `
        ${canAdminister ? `<button type="button" data-action="add-request" class="mb-4 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('ecodem.newRequest')}</button>` : ''}
        <div data-el="requests-list" class="space-y-3"></div>
      `;

      const listEl = el.querySelector('[data-el="requests-list"]');
      if ((requests || []).length === 0) {
        listEl.innerHTML = `<p class="text-sm text-slate-400">${t('ecodem.noRequests')}</p>`;
      } else {
        listEl.innerHTML = requests.map((r) => `
          <div class="border border-slate-200 rounded-lg p-3" data-request-id="${r.id}">
            <p class="text-sm font-semibold text-slate-700">${escapeHtml(r.title)}</p>
            <p class="text-sm text-slate-600 mt-1">${escapeHtml(r.body)}</p>
            <button type="button" data-action="toggle-acks" class="text-xs text-indigo-600 hover:text-indigo-700 font-medium mt-2">${t('ecodem.manageAcknowledgements')}</button>
            <div data-el="acks-panel" class="hidden mt-2 border-t border-slate-100 pt-2 space-y-1"></div>
          </div>
        `).join('');

        listEl.querySelectorAll('[data-action="toggle-acks"]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const card = btn.closest('[data-request-id]');
            const requestId = card.dataset.requestId;
            const panel = card.querySelector('[data-el="acks-panel"]');
            const isHidden = panel.classList.contains('hidden');
            panel.classList.toggle('hidden');
            if (!isHidden) return;
            panel.innerHTML = `<p class="text-slate-400">${t('common.loading')}</p>`;
            const { data: acks } = await supabase.from('ecodem_parent_acknowledgements').select('child_id').eq('request_id', requestId);
            const ackedIds = new Set((acks || []).map((a) => a.child_id));
            if ((children || []).length === 0) {
              panel.innerHTML = `<p class="text-slate-400">${t('ecodem.noChildren')}</p>`;
              return;
            }
            panel.innerHTML = children.map((c) => `
              <label class="flex items-center gap-2 text-sm">
                <input type="checkbox" data-action="toggle-ack" data-request-id="${requestId}" data-child-id="${c.id}" ${ackedIds.has(c.id) ? 'checked' : ''} />
                ${escapeHtml(c.full_name)}
              </label>
            `).join('');
          });
        });

        listEl.addEventListener('change', async (e) => {
          const checkbox = e.target.closest('[data-action="toggle-ack"]');
          if (!checkbox) return;
          const requestId = checkbox.dataset.requestId;
          const childId = checkbox.dataset.childId;
          if (checkbox.checked) {
            const { data: { user } } = await supabase.auth.getUser();
            await supabase.from('ecodem_parent_acknowledgements').insert({ request_id: requestId, child_id: childId, acknowledged_by: user.id });
          } else {
            await supabase.from('ecodem_parent_acknowledgements').delete().eq('request_id', requestId).eq('child_id', childId);
          }
        });
      }

      el.querySelector('[data-action="add-request"]')?.addEventListener('click', () => {
        const formHtml = `
          <div data-el="add-request-form" class="mb-4 border border-slate-200 rounded-lg p-4 bg-slate-50 space-y-2">
            <input type="text" data-el="title" placeholder="${t('ecodem.requestTitlePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm" />
            <textarea data-el="body" placeholder="${t('ecodem.requestBodyPlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"></textarea>
            <div class="flex gap-2">
              <button type="button" data-action="save-request" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t("ecodem.saveGeneric")}</button>
              <button type="button" data-action="cancel-request" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('common.cancel')}</button>
            </div>
          </div>
        `;
        el.querySelector('[data-action="add-request"]').insertAdjacentHTML('afterend', formHtml);
        const formEl = el.querySelector('[data-el="add-request-form"]');
        formEl.querySelector('[data-action="cancel-request"]').addEventListener('click', () => formEl.remove());
        formEl.querySelector('[data-action="save-request"]').addEventListener('click', async () => {
          const title = formEl.querySelector('[data-el="title"]').value.trim();
          const body = formEl.querySelector('[data-el="body"]').value.trim();
          if (!title || !body) return;
          const { data: { user } } = await supabase.auth.getUser();
          await supabase.from('ecodem_parent_requests').insert({ title, body, created_by: user.id });
          loadRequests();
        });
      });
    }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
