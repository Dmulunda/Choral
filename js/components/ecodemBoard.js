// Ecodem (Children's Ministry) session board: three age groups, each
// needing exactly two assigned workers plus a lesson topic per
// scheduled date. "Exactly two" is enforced here — two dedicated
// single-selects per group rather than a multi-select, so it's obvious
// what's required and easy to validate before saving. Each assigned
// worker then approves or declines their own slot (sql/049), same as
// every other department now.
import { t, ecodemAgeGroupLabel } from '../i18n.js';
import { renderMyAssignmentsPanel } from './myAssignmentsPanel.js';
import { renderAssigneeBadge } from './assignmentStatusBadge.js';
import { todayLocal } from '../utils/date.js';
import { getGlobalRole } from '../departments.js';

const AGE_GROUPS = ['group_1', 'group_2', 'group_3'];

export function renderEcodemBoard(container, { supabase, departmentId, canAdminister, userId }) {
  // Super Admin keeps the ability to correct an already-past session;
  // every other department admin is hard-blocked (sql/052's DB trigger
  // enforces the same rule), so the picker shouldn't even let them try.
  const dateMinAttr = getGlobalRole() === 'super_admin' ? '' : `min="${todayLocal()}"`;

  container.innerHTML = `
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
                <label class="block text-xs font-medium text-slate-500 mb-1">${t('ecodem.worker2')}</label>
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

  const form = container.querySelector('[data-el="form"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const listEl = container.querySelector('[data-el="list"]');

  if (userId) {
    renderMyAssignmentsPanel(container.querySelector('[data-el="my-assignments"]'), {
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

  async function loadMemberOptions() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');

    allMembers = (data || []).filter((m) => m.member);
    renderWorkerOptions(new Set());
  }

  // Excludes anyone who reported themselves unavailable for the
  // selected date, so scheduling someone who already said they can't
  // make it isn't even possible.
  function renderWorkerOptions(unavailableIds) {
    const options = allMembers
      .filter((m) => !unavailableIds.has(m.user_id))
      .map((m) => `<option value="${m.user_id}">${escapeHtml(m.member.full_name)}</option>`)
      .join('');

    AGE_GROUPS.forEach((group) => {
      ['1', '2'].forEach((slot) => {
        const select = container.querySelector(`[data-group-worker="${group}-${slot}"]`);
        select.innerHTML = `<option value="">—</option>` + options;
      });
    });
  }

  async function prefillFromDate(dateStr) {
    if (!dateStr) {
      renderWorkerOptions(new Set());
      AGE_GROUPS.forEach((group) => {
        container.querySelector(`[data-group-topic="${group}"]`).value = '';
      });
      return;
    }

    const [{ data: sessions }, { data: unavailableRows }] = await Promise.all([
      supabase
        .from('ecodem_sessions')
        .select('id, age_group, topic, ecodem_session_workers ( user_id, worker:profiles!user_id ( full_name ) )')
        .eq('date', dateStr),
      supabase.from('availability').select('user_id').eq('date', dateStr).eq('status', 'unavailable'),
    ]);

    renderWorkerOptions(new Set((unavailableRows || []).map((r) => r.user_id)));

    AGE_GROUPS.forEach((group) => { container.querySelector(`[data-group-topic="${group}"]`).value = ''; });

    (sessions || []).forEach((session) => {
      container.querySelector(`[data-group-topic="${session.age_group}"]`).value = session.topic || '';
      (session.ecodem_session_workers || []).forEach((worker, idx) => {
        if (idx > 1) return;
        const select = container.querySelector(`[data-group-worker="${session.age_group}-${idx + 1}"]`);
        if (!select) return;
        // Already assigned here but no longer available for this date —
        // keep them visible and selected so resaving this form doesn't
        // silently drop them; an admin has to deliberately swap them out.
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

    // Validate "exactly two" per group that's actually being used —
    // a group with a topic or one worker but not the other is rejected;
    // a group left entirely blank is simply skipped for this date.
    const groupsToSave = [];
    for (const group of AGE_GROUPS) {
      const topic = container.querySelector(`[data-group-topic="${group}"]`).value.trim();
      const worker1 = container.querySelector(`[data-group-worker="${group}-1"]`).value;
      const worker2 = container.querySelector(`[data-group-worker="${group}-2"]`).value;

      if (!topic && !worker1 && !worker2) continue;

      if (!worker1 || !worker2) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = `${ecodemAgeGroupLabel(group)} ${t('ecodem.bothWorkersRequired')}`;
        return;
      }

      groupsToSave.push({ group, topic: topic || null, workers: [worker1, worker2] });
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

      // Diff against the two workers already on this session rather
      // than delete-both-then-reinsert — a worker who already
      // approved or declined must keep that status if they're still
      // one of the two; only an actual swap needs to move.
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
  }

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('ecodem_sessions')
      .select('date, age_group, topic, ecodem_session_workers ( status, reason, worker:profiles!user_id ( full_name ), working_department:departments!working_department_id ( key ) )')
      .order('date', { ascending: true });

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
            return `
              <div class="text-sm">
                <div class="font-medium text-slate-700">${ecodemAgeGroupLabel(session.age_group)}</div>
                <div class="text-slate-600">${session.topic ? escapeHtml(session.topic) : `<span class="text-slate-400">${t('ecodem.noTopic')}</span>`}</div>
                <div class="text-slate-500 mt-1 flex flex-wrap gap-1">${workers.length > 0
                  ? workers.map((w) => renderAssigneeBadge({
                      name: w.worker.full_name,
                      status: w.status,
                      reason: w.reason,
                      workingDepartmentKey: w.working_department?.key,
                    })).join('')
                  : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}</div>
              </div>
            `;
          }).join('')}
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
