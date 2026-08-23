// Singer "Service Requests" panel — titled, dated events an admin has
// asked this member to approve or decline. Distinct from the free-form
// availability calendar rendered below it. Declining offers a free-text
// reason or, alternatively, "I'll be working in another department
// instead" (sql/049) — same option every other department's scheduling
// board now has too.
import { t } from '../i18n.js';
import { getMyDepartments } from '../departments.js';
import { departmentLabel } from '../i18n.js';

export function renderServiceRequestSinger(container, { supabase, userId }) {
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">${t('requests.yourRequests')}</h2>
      <div data-el="list"></div>
    </div>
  `;

  const listEl = container.querySelector('[data-el="list"]');

  load();

  async function load() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data, error } = await supabase
      .from('service_rsvps')
      .select('id, status, reason, working_department_id, service_plans ( id, date, title )')
      .eq('singer_id', userId)
      .order('date', { ascending: true, foreignTable: 'service_plans' });

    if (error) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('requests.failedToLoad', { message: error.message })}</p>`;
      return;
    }

    render(data.filter((rsvp) => rsvp.service_plans));
  }

  function render(rsvps) {
    if (rsvps.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('requests.noRequests')}</p>`;
      return;
    }

    const pending = rsvps.filter((r) => r.status === 'pending');
    const responded = rsvps.filter((r) => r.status !== 'pending');

    listEl.innerHTML = '';

    if (pending.length > 0) {
      const section = document.createElement('div');
      section.className = 'mb-4';
      section.innerHTML = `<div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('requests.needsResponse')}</div>`;
      const list = document.createElement('div');
      list.className = 'space-y-2';
      pending.forEach((rsvp) => list.appendChild(renderCard(rsvp)));
      section.appendChild(list);
      listEl.appendChild(section);
    }

    if (responded.length > 0) {
      const section = document.createElement('div');
      section.innerHTML = `<div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('requests.yourResponses')}</div>`;
      const list = document.createElement('div');
      list.className = 'space-y-2';
      responded.forEach((rsvp) => list.appendChild(renderCard(rsvp)));
      section.appendChild(list);
      listEl.appendChild(section);
    }
  }

  function departmentOptions(selectedId) {
    const choirId = getMyDepartments().find((d) => d.key === 'choir')?.id;
    const options = getMyDepartments().filter((d) => d.id !== choirId);
    return `<option value="">${t('requests.selectDepartment')}</option>`
      + options.map((d) => `<option value="${d.id}" ${d.id === selectedId ? 'selected' : ''}>${escapeHtml(departmentLabel(d.key))}</option>`).join('');
  }

  function renderCard(rsvp) {
    const plan = rsvp.service_plans;
    const card = document.createElement('div');
    card.className = 'border border-slate-200 rounded-lg p-3';
    card.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="font-medium text-slate-800">${escapeHtml(plan.title)}</div>
          <div class="text-sm text-slate-500">${escapeHtml(plan.date)}</div>
        </div>
        <div class="flex gap-2">
          <button type="button" data-action="approve"
                  class="px-3 py-1.5 rounded-lg text-sm font-medium ${rsvp.status === 'approved' ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-emerald-100'}">
            ${t('requests.approve')}
          </button>
          <button type="button" data-action="decline"
                  class="px-3 py-1.5 rounded-lg text-sm font-medium ${rsvp.status === 'declined' ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-rose-100'}">
            ${t('requests.decline')}
          </button>
        </div>
      </div>
      ${rsvp.status === 'declined' ? `
        <div class="mt-3 pt-3 border-t border-slate-100 space-y-3">
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('requests.reason')}</label>
            <div class="flex gap-2">
              <input type="text" data-el="reason-input" value="${escapeAttr(rsvp.reason || '')}"
                     placeholder="${t('requests.reasonPlaceholder')}"
                     class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
              <button type="button" data-action="save-reason"
                      class="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
                ${t('requests.saveReason')}
              </button>
            </div>
          </div>
          <div>
            <label class="block text-xs font-medium text-slate-500 mb-1">${t('requests.workingElsewhere')}</label>
            <div class="flex gap-2">
              <select data-el="dept-select" class="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
                ${departmentOptions(rsvp.working_department_id)}
              </select>
              <button type="button" data-action="save-department"
                      class="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 whitespace-nowrap">
                ${t('requests.saveReason')}
              </button>
            </div>
          </div>
          <p data-el="reason-status" class="text-xs"></p>
        </div>
      ` : ''}
    `;

    card.querySelector('[data-action="approve"]').addEventListener('click', () => respond(rsvp, 'approved'));
    card.querySelector('[data-action="decline"]').addEventListener('click', () => respond(rsvp, 'declined'));

    if (rsvp.status === 'declined') {
      card.querySelector('[data-action="save-reason"]').addEventListener('click', () => saveReason(rsvp, card));
      card.querySelector('[data-action="save-department"]').addEventListener('click', () => saveWorkingDepartment(rsvp, card));
    }

    return card;
  }

  async function respond(rsvp, status) {
    const { data, error } = await supabase
      .from('service_rsvps')
      .update({ status, responded_at: new Date().toISOString() })
      .eq('id', rsvp.id)
      .select();

    if (error || !data || data.length === 0) {
      window.alert(t('requests.responseFailed', { message: error?.message || '' }));
      return;
    }

    load();
  }

  async function saveReason(rsvp, card) {
    const input = card.querySelector('[data-el="reason-input"]');
    const statusEl = card.querySelector('[data-el="reason-status"]');
    const reason = input.value.trim() || null;

    const { error } = await supabase.from('service_rsvps').update({ reason, working_department_id: null }).eq('id', rsvp.id);

    if (error) {
      statusEl.className = 'text-xs mt-1 text-rose-600';
      statusEl.textContent = t('requests.reasonSaveFailed', { message: error.message });
      return;
    }

    rsvp.reason = reason;
    rsvp.working_department_id = null;
    statusEl.className = 'text-xs mt-1 text-emerald-600';
    statusEl.textContent = t('requests.reasonSaved');
  }

  async function saveWorkingDepartment(rsvp, card) {
    const select = card.querySelector('[data-el="dept-select"]');
    const statusEl = card.querySelector('[data-el="reason-status"]');
    const workingDepartmentId = select.value || null;

    const { error } = await supabase.from('service_rsvps').update({ reason: null, working_department_id: workingDepartmentId }).eq('id', rsvp.id);

    if (error) {
      statusEl.className = 'text-xs mt-1 text-rose-600';
      statusEl.textContent = t('requests.reasonSaveFailed', { message: error.message });
      return;
    }

    rsvp.reason = null;
    rsvp.working_department_id = workingDepartmentId;
    statusEl.className = 'text-xs mt-1 text-emerald-600';
    statusEl.textContent = t('requests.reasonSaved');
  }
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
