// Ecodem (Children's Ministry) session board: three age groups, each
// needing exactly two assigned workers plus a lesson topic per
// scheduled date. "Exactly two" is enforced here — two dedicated
// single-selects per group rather than a multi-select, so it's obvious
// what's required and easy to validate before saving.
import { t, ecodemAgeGroupLabel } from '../i18n.js';

const AGE_GROUPS = ['group_1', 'group_2', 'group_3'];

export function renderEcodemBoard(container, { supabase, departmentId, canAdminister }) {
  container.innerHTML = `
    ${canAdminister ? `
      <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
        <h2 class="text-lg font-semibold mb-4">${t('ecodem.scheduleSession')}</h2>
        <form data-el="form" class="space-y-6">
          <div class="max-w-xs">
            <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
            <input type="date" name="date" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
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

  if (form) {
    loadMemberOptions();
    form.elements.date.addEventListener('change', () => prefillFromDate(form.elements.date.value));
    form.addEventListener('submit', handleSubmit);
  }

  load();

  async function loadMemberOptions() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( full_name )')
      .eq('department_id', departmentId)
      .eq('status', 'approved');

    const options = (data || [])
      .filter((m) => m.member)
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
    AGE_GROUPS.forEach((group) => {
      container.querySelector(`[data-group-topic="${group}"]`).value = '';
      ['1', '2'].forEach((slot) => {
        container.querySelector(`[data-group-worker="${group}-${slot}"]`).value = '';
      });
    });
    if (!dateStr) return;

    const { data: sessions } = await supabase
      .from('ecodem_sessions')
      .select('id, age_group, topic, ecodem_session_workers ( user_id )')
      .eq('date', dateStr);

    (sessions || []).forEach((session) => {
      container.querySelector(`[data-group-topic="${session.age_group}"]`).value = session.topic || '';
      const workerIds = (session.ecodem_session_workers || []).map((w) => w.user_id);
      if (workerIds[0]) container.querySelector(`[data-group-worker="${session.age_group}-1"]`).value = workerIds[0];
      if (workerIds[1]) container.querySelector(`[data-group-worker="${session.age_group}-2"]`).value = workerIds[1];
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

      const { error: deleteError } = await supabase.from('ecodem_session_workers').delete().eq('session_id', session.id);
      if (deleteError) {
        formStatusEl.className = 'text-sm text-rose-600';
        formStatusEl.textContent = t('ecodem.saveFailed', { message: deleteError.message });
        return;
      }

      const { error: insertError } = await supabase
        .from('ecodem_session_workers')
        .insert(workers.map((user_id) => ({ session_id: session.id, user_id })));

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
      .select('date, age_group, topic, ecodem_session_workers ( worker:profiles!user_id ( full_name ) )')
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
            const names = (session.ecodem_session_workers || []).map((w) => w.worker?.full_name).filter(Boolean);
            return `
              <div class="text-sm">
                <div class="font-medium text-slate-700">${ecodemAgeGroupLabel(session.age_group)}</div>
                <div class="text-slate-600">${session.topic ? escapeHtml(session.topic) : `<span class="text-slate-400">${t('ecodem.noTopic')}</span>`}</div>
                <div class="text-slate-500 mt-1">${names.length > 0 ? names.map(escapeHtml).join(', ') : `<span class="text-slate-400">${t('deptScheduling.unassigned')}</span>`}</div>
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
