// Singer "Replacement Requests" panel — lets a member who was
// programmed for a service ask their voice part (or one specific
// person) to cover for them, and lets members claim open requests that
// match their own voice part. Sending goes through send_replacement_
// request() (sql/026) — it creates the request, auto-messages a
// specific target, and notifies the department's admins, all
// atomically. Claiming/refusing run through claim_replacement()/
// refuse_replacement() so the status change (and, for claim, the swap
// into service_plan_singers) happens atomically and safely without
// needing broad write access to that table.
import { formatDateLocal } from '../utils/date.js';
import { t, voicePartLabel } from '../i18n.js';

export function renderReplacementRequests(container, { supabase, userId, myVoiceParts }) {
  let myAssignments = [];
  let myOpenRequests = [];
  let coverableRequests = [];

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">${t('replacement.title')}</h2>

      <div class="mb-6">
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('replacement.myAssignments')}</div>
        <div data-el="assignments" class="space-y-2"></div>
      </div>

      <div data-el="my-requests-section" class="mb-6 hidden">
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('replacement.myOpenRequests')}</div>
        <div data-el="my-requests" class="space-y-2"></div>
      </div>

      <div>
        <div class="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">${t('replacement.openRequests')}</div>
        <div data-el="coverable" class="space-y-2"></div>
      </div>
    </div>
  `;

  const assignmentsEl = container.querySelector('[data-el="assignments"]');
  const myRequestsSectionEl = container.querySelector('[data-el="my-requests-section"]');
  const myRequestsEl = container.querySelector('[data-el="my-requests"]');
  const coverableEl = container.querySelector('[data-el="coverable"]');

  loadAll();

  async function loadAll() {
    assignmentsEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;
    coverableEl.innerHTML = '';

    const todayStr = formatDateLocal(new Date());

    try {
      const [assignmentsRes, myOpenRes, openRes] = await Promise.all([
        supabase
          .from('service_plan_singers')
          .select('id, voice_part, service_plans ( id, date, title )')
          .eq('singer_id', userId),
        supabase
          .from('replacement_requests')
          .select('id, service_plan_id, voice_part, service_plans ( date, title )')
          .eq('requested_by', userId)
          .eq('status', 'open'),
        supabase
          .from('replacement_requests')
          .select('id, voice_part, target_singer_id, requested_by, status, service_plans ( date, title ), requester:profiles!requested_by ( full_name )')
          .eq('status', 'open'),
      ]);

      if (assignmentsRes.error) throw assignmentsRes.error;
      if (myOpenRes.error) throw myOpenRes.error;
      if (openRes.error) throw openRes.error;

      myAssignments = assignmentsRes.data
        .filter((row) => row.service_plans && row.service_plans.date >= todayStr);

      myOpenRequests = myOpenRes.data.filter((row) => row.service_plans);

      const myOpenKeys = new Set(myOpenRequests.map((r) => r.id));
      coverableRequests = openRes.data.filter((row) =>
        row.service_plans
        && row.requested_by !== userId
        && !myOpenKeys.has(row.id)
        && (myVoiceParts || []).includes(row.voice_part)
        && (row.target_singer_id === null || row.target_singer_id === userId)
      );

      renderAssignments();
      renderMyRequests();
      renderCoverable();
    } catch (error) {
      assignmentsEl.innerHTML = `<p class="text-sm text-rose-600">${t('replacement.loadFailed', { message: error.message })}</p>`;
    }
  }

  function renderAssignments() {
    if (myAssignments.length === 0) {
      assignmentsEl.innerHTML = `<p class="text-sm text-slate-500">${t('replacement.noAssignments')}</p>`;
      return;
    }

    const requestedKeys = new Set(myOpenRequests.map((r) => `${r.service_plan_id}:${r.voice_part}`));

    assignmentsEl.innerHTML = '';
    myAssignments.forEach((assignment) => {
      const plan = assignment.service_plans;
      const alreadyRequested = requestedKeys.has(`${plan.id}:${assignment.voice_part}`);

      const row = document.createElement('div');
      row.className = 'flex flex-wrap items-center justify-between gap-3 border border-slate-200 rounded-lg p-3';
      row.innerHTML = `
        <div>
          <div class="font-medium text-slate-800">${escapeHtml(plan.title || t('dashboard.untitledService'))} — ${voicePartLabel(assignment.voice_part)}</div>
          <div class="text-sm text-slate-500">${escapeHtml(plan.date)}</div>
        </div>
      `;

      if (!alreadyRequested) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-100 text-slate-700 hover:bg-rose-100 hover:text-rose-700';
        btn.textContent = t('replacement.requestReplacement');
        btn.addEventListener('click', () => openRequestForm(row, assignment, plan));
        row.appendChild(btn);
      }

      assignmentsEl.appendChild(row);
    });
  }

  function openRequestForm(row, assignment, plan) {
    const formWrap = document.createElement('div');
    formWrap.className = 'w-full mt-3 pt-3 border-t border-slate-200';
    formWrap.innerHTML = `
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('replacement.targetLabel')}</label>
      <div class="flex flex-wrap items-center gap-3 mb-2">
        <label class="flex items-center gap-1.5 text-sm">
          <input type="radio" name="target-mode" value="any" checked />
          ${t('replacement.targetAny', { part: voicePartLabel(assignment.voice_part) })}
        </label>
        <label class="flex items-center gap-1.5 text-sm">
          <input type="radio" name="target-mode" value="specific" />
          ${t('replacement.targetSpecific')}
        </label>
        <select data-el="specific-select" disabled class="border border-slate-300 rounded-lg px-2 py-1 text-sm"></select>
      </div>
      <label class="block text-sm font-medium text-slate-600 mb-1">${t('replacement.messageLabel')}</label>
      <textarea data-el="message" rows="2" placeholder="${t('replacement.messagePlaceholder')}"
                class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm mb-2"></textarea>
      <div class="flex items-center gap-3">
        <button type="button" data-action="send" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">
          ${t('replacement.send')}
        </button>
        <span data-el="status" class="text-sm text-slate-500"></span>
      </div>
    `;
    row.appendChild(formWrap);

    const radios = formWrap.querySelectorAll('input[name="target-mode"]');
    const specificSelect = formWrap.querySelector('[data-el="specific-select"]');
    const messageEl = formWrap.querySelector('[data-el="message"]');
    const statusEl = formWrap.querySelector('[data-el="status"]');
    const sendBtn = formWrap.querySelector('[data-action="send"]');

    loadCandidates(assignment.voice_part, specificSelect);

    radios.forEach((radio) => radio.addEventListener('change', () => {
      specificSelect.disabled = formWrap.querySelector('input[name="target-mode"]:checked').value !== 'specific';
    }));

    sendBtn.addEventListener('click', async () => {
      const mode = formWrap.querySelector('input[name="target-mode"]:checked').value;
      const targetSingerId = mode === 'specific' ? specificSelect.value || null : null;

      if (mode === 'specific' && !targetSingerId) return;

      sendBtn.disabled = true;
      statusEl.textContent = t('replacement.sending');

      const { error } = await supabase.rpc('send_replacement_request', {
        p_service_plan_id: plan.id,
        p_voice_part: assignment.voice_part,
        p_target_singer_id: targetSingerId,
        p_message: messageEl.value.trim() || null,
      });

      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('replacement.sendFailed', { message: error.message });
        sendBtn.disabled = false;
        return;
      }

      statusEl.className = 'text-sm text-emerald-600';
      statusEl.textContent = t('replacement.sent');
      loadAll();
    });
  }

  async function loadCandidates(voicePart, selectEl) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name')
      .contains('voice_parts', [voicePart])
      .neq('id', userId)
      .order('full_name');

    selectEl.innerHTML = (data || [])
      .map((p) => `<option value="${p.id}">${escapeHtml(p.full_name)}</option>`)
      .join('');
  }

  function renderMyRequests() {
    if (myOpenRequests.length === 0) {
      myRequestsSectionEl.classList.add('hidden');
      return;
    }

    myRequestsSectionEl.classList.remove('hidden');
    myRequestsEl.innerHTML = '';

    myOpenRequests.forEach((request) => {
      const plan = request.service_plans;
      const row = document.createElement('div');
      row.className = 'flex flex-wrap items-center justify-between gap-3 border border-slate-200 rounded-lg p-3';
      row.innerHTML = `
        <div>
          <div class="font-medium text-slate-800">${escapeHtml(plan.title || t('dashboard.untitledService'))} — ${voicePartLabel(request.voice_part)}</div>
          <div class="text-sm text-slate-500">${escapeHtml(plan.date)} · ${t('replacement.statusOpen')}</div>
        </div>
      `;

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'text-sm font-medium text-rose-600 hover:text-rose-800';
      cancelBtn.textContent = t('replacement.cancelRequest');
      cancelBtn.addEventListener('click', () => cancelRequest(request));
      row.appendChild(cancelBtn);

      myRequestsEl.appendChild(row);
    });
  }

  async function cancelRequest(request) {
    if (!window.confirm(t('replacement.confirmCancelRequest'))) return;

    const { error } = await supabase.from('replacement_requests').update({ status: 'cancelled' }).eq('id', request.id);
    if (error) {
      window.alert(t('replacement.cancelFailed', { message: error.message }));
      return;
    }
    loadAll();
  }

  function renderCoverable() {
    if (coverableRequests.length === 0) {
      coverableEl.innerHTML = `<p class="text-sm text-slate-500">${t('replacement.noOpenRequests')}</p>`;
      return;
    }

    coverableEl.innerHTML = '';
    coverableRequests.forEach((request) => {
      const plan = request.service_plans;
      const targeted = request.target_singer_id === userId;

      const row = document.createElement('div');
      row.className = 'flex flex-wrap items-center justify-between gap-3 border border-slate-200 rounded-lg p-3';
      row.innerHTML = `
        <div>
          <div class="font-medium text-slate-800">${t('replacement.coverFor', {
            name: escapeHtml(request.requester?.full_name || ''),
            part: voicePartLabel(request.voice_part),
            title: escapeHtml(plan.title || t('dashboard.untitledService')),
            date: escapeHtml(plan.date),
          })}</div>
          <div class="text-xs ${targeted ? 'text-indigo-600' : 'text-slate-400'} mt-0.5">
            ${targeted ? t('replacement.forYou') : t('replacement.forAnyone', { part: voicePartLabel(request.voice_part) })}
          </div>
        </div>
      `;

      if (targeted) {
        // A specific candidate gets a real Accept/Refuse choice rather
        // than just "Cover" — Refuse reopens the request to anyone
        // eligible instead of leaving the requester stuck.
        const btnWrap = document.createElement('div');
        btnWrap.className = 'flex items-center gap-2';

        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.className = 'px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 whitespace-nowrap';
        acceptBtn.textContent = t('replacement.accept');
        acceptBtn.addEventListener('click', () => claim(request, acceptBtn));

        const refuseBtn = document.createElement('button');
        refuseBtn.type = 'button';
        refuseBtn.className = 'px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-rose-100 hover:text-rose-700 whitespace-nowrap';
        refuseBtn.textContent = t('replacement.refuse');
        refuseBtn.addEventListener('click', () => refuse(request, refuseBtn));

        btnWrap.append(acceptBtn, refuseBtn);
        row.appendChild(btnWrap);
      } else {
        const coverBtn = document.createElement('button');
        coverBtn.type = 'button';
        coverBtn.className = 'px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 whitespace-nowrap';
        coverBtn.textContent = t('replacement.cover');
        coverBtn.addEventListener('click', () => claim(request, coverBtn));
        row.appendChild(coverBtn);
      }

      coverableEl.appendChild(row);
    });
  }

  async function claim(request, button) {
    button.disabled = true;
    const { error } = await supabase.rpc('claim_replacement', { request_id: request.id });

    if (error) {
      window.alert(t('replacement.claimFailed', { message: error.message }));
      button.disabled = false;
      return;
    }

    window.alert(t('replacement.claimed'));
    loadAll();
  }

  async function refuse(request, button) {
    if (!window.confirm(t('replacement.confirmRefuse'))) return;

    button.disabled = true;
    const { error } = await supabase.rpc('refuse_replacement', { p_request_id: request.id, p_message: null });

    if (error) {
      window.alert(t('replacement.refuseFailed', { message: error.message }));
      button.disabled = false;
      return;
    }

    window.alert(t('replacement.refused'));
    loadAll();
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
