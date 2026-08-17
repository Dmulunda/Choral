// Admin "Service Requests" panel — post a titled, dated event (e.g. a
// one-off seminar) and send an RSVP request to every current member.
// Distinct from the free-form availability calendar: each request needs
// an explicit approve/decline response per member.
import { t, tn } from '../i18n.js';

export function renderServiceRequestAdmin(container, { supabase, adminUserId }) {
  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-6">
      <h2 class="text-lg font-semibold mb-4">${t('requests.title')}</h2>

      <form data-el="form" class="grid sm:grid-cols-2 gap-4 mb-3">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
          <input type="date" name="date" required class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.eventTitle')}</label>
          <input type="text" name="title" required placeholder="${t('requests.eventTitlePlaceholder')}"
                 class="w-full border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.songsOptional')}</label>
          <select name="song_ids" multiple size="4" data-el="songs-select"
                  class="w-full border border-slate-300 rounded-lg px-3 py-2"></select>
        </div>
        <div class="sm:col-span-2 flex items-center gap-3">
          <button type="submit" data-el="submit-btn"
                  class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('requests.send')}
          </button>
          <span data-el="form-status" class="text-sm text-slate-500"></span>
        </div>
      </form>

      <div data-el="list" class="mt-4 space-y-3"></div>
    </div>
  `;

  const form = container.querySelector('[data-el="form"]');
  const dateInput = form.elements.date;
  const songsSelect = container.querySelector('[data-el="songs-select"]');
  const formStatusEl = container.querySelector('[data-el="form-status"]');
  const submitBtn = container.querySelector('[data-el="submit-btn"]');
  const listEl = container.querySelector('[data-el="list"]');

  form.addEventListener('submit', handleSubmit);
  // Re-entering (or clicking Edit into) a date that already has a request
  // loads its current title/songs, so submitting again updates it in
  // place instead of erroring — this is how songs get attached later to
  // a request that was sent without any.
  dateInput.addEventListener('change', () => prefillFromDate(dateInput.value));

  loadSongOptions().then(() => prefillFromDate(dateInput.value));
  loadRequests();

  async function loadSongOptions() {
    const { data } = await supabase.from('songs').select('id, title').order('title');
    songsSelect.innerHTML = (data || [])
      .map((song) => `<option value="${song.id}">${escapeHtml(song.title)}</option>`)
      .join('');
  }

  async function prefillFromDate(dateStr) {
    if (!dateStr) return;

    const { data: plan } = await supabase
      .from('service_plans')
      .select('title, song_ids')
      .eq('date', dateStr)
      .not('title', 'is', null)
      .maybeSingle();

    form.elements.title.value = plan?.title || '';
    const songIds = new Set(plan?.song_ids || []);
    Array.from(songsSelect.options).forEach((opt) => { opt.selected = songIds.has(opt.value); });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const dateStr = form.elements.date.value;
    const title = form.elements.title.value.trim();
    const songIds = Array.from(songsSelect.selectedOptions).map((opt) => opt.value);

    if (!dateStr || !title) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('requests.missingFields');
      return;
    }

    submitBtn.disabled = true;
    formStatusEl.className = 'text-sm text-slate-500';
    formStatusEl.textContent = t('requests.sending');

    try {
      const { data: existingPlan, error: findError } = await supabase
        .from('service_plans')
        .select('id')
        .eq('date', dateStr)
        .maybeSingle();
      if (findError) throw findError;

      let planId = existingPlan?.id;
      if (planId) {
        const { error: updateError } = await supabase
          .from('service_plans')
          .update({ title, song_ids: songIds, choir_leader_id: adminUserId })
          .eq('id', planId);
        if (updateError) throw updateError;
      } else {
        const { data: newPlan, error: insertError } = await supabase
          .from('service_plans')
          .insert({ date: dateStr, title, song_ids: songIds, choir_leader_id: adminUserId, status: 'draft' })
          .select('id')
          .single();
        if (insertError) throw insertError;
        planId = newPlan.id;
      }

      const { data: members, error: membersError } = await supabase.from('profiles').select('id');
      if (membersError) throw membersError;

      const { data: existingRsvps, error: rsvpsError } = await supabase
        .from('service_rsvps')
        .select('singer_id')
        .eq('service_plan_id', planId);
      if (rsvpsError) throw rsvpsError;

      const alreadyInvited = new Set((existingRsvps || []).map((r) => r.singer_id));
      const newRows = members
        .filter((member) => !alreadyInvited.has(member.id))
        .map((member) => ({ service_plan_id: planId, singer_id: member.id, status: 'pending' }));

      if (newRows.length > 0) {
        const { error: rsvpInsertError } = await supabase.from('service_rsvps').insert(newRows);
        if (rsvpInsertError) throw rsvpInsertError;
      }

      formStatusEl.className = 'text-sm text-emerald-600';
      formStatusEl.textContent = tn('requests.sentTo', newRows.length);
      form.reset();
      loadRequests();
    } catch (error) {
      formStatusEl.className = 'text-sm text-rose-600';
      formStatusEl.textContent = t('requests.failedToSend', { message: error.message });
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function loadRequests() {
    listEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const { data: plans, error: plansError } = await supabase
      .from('service_plans')
      .select('id, date, title')
      .not('title', 'is', null)
      .order('date', { ascending: false });

    if (plansError) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('requests.failedToLoad', { message: plansError.message })}</p>`;
      return;
    }

    if (plans.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('requests.noRequestsYet')}</p>`;
      return;
    }

    const planIds = plans.map((p) => p.id);
    const { data: rsvps, error: rsvpsError } = await supabase
      .from('service_rsvps')
      .select('service_plan_id, status, profiles ( full_name )')
      .in('service_plan_id', planIds);

    if (rsvpsError) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('requests.failedToLoad', { message: rsvpsError.message })}</p>`;
      return;
    }

    const rsvpsByPlan = new Map(planIds.map((id) => [id, []]));
    (rsvps || []).forEach((r) => rsvpsByPlan.get(r.service_plan_id)?.push(r));

    listEl.innerHTML = '';
    plans.forEach((plan) => {
      const planRsvps = rsvpsByPlan.get(plan.id) || [];
      const counts = { approved: 0, declined: 0, pending: 0 };
      planRsvps.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });

      const card = document.createElement('div');
      card.className = 'border border-slate-200 rounded-lg p-3';
      card.innerHTML = `
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="font-semibold text-slate-800">${escapeHtml(plan.title)}</div>
            <div class="text-sm text-slate-500">${escapeHtml(plan.date)}</div>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <button type="button" data-action="edit"
                    class="text-xs font-medium text-indigo-600 hover:text-indigo-800 whitespace-nowrap">${t('common.edit')}</button>
            <button type="button" data-action="cancel"
                    class="text-xs font-medium text-rose-600 hover:text-rose-800 whitespace-nowrap">${t('requests.cancelRequest')}</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-2 mt-2">
          <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">${tn('requests.tally.approved', counts.approved)}</span>
          <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700">${tn('requests.tally.declined', counts.declined)}</span>
          <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">${tn('requests.tally.pending', counts.pending)}</span>
        </div>
        <details class="mt-2">
          <summary class="text-xs font-medium text-slate-500 cursor-pointer">${t('requests.viewResponses')}</summary>
          <ul class="mt-2 space-y-1 text-sm">
            ${planRsvps.map((r) => `
              <li class="flex items-center justify-between">
                <span class="text-slate-700">${escapeHtml(r.profiles?.full_name || '')}</span>
                <span class="text-xs ${statusColorClass(r.status)}">${statusLabel(r.status)}</span>
              </li>
            `).join('')}
          </ul>
        </details>
      `;

      card.querySelector('[data-action="cancel"]').addEventListener('click', () => cancelRequest(plan));
      card.querySelector('[data-action="edit"]').addEventListener('click', () => {
        dateInput.value = plan.date;
        prefillFromDate(plan.date);
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      listEl.appendChild(card);
    });
  }

  async function cancelRequest(plan) {
    if (!window.confirm(t('requests.confirmCancel', { title: plan.title }))) return;

    const { error } = await supabase.from('service_plans').delete().eq('id', plan.id);
    if (error) {
      window.alert(t('requests.cancelFailed', { message: error.message }));
      return;
    }
    loadRequests();
  }
}

function statusLabel(status) {
  if (status === 'approved') return t('requests.statusApproved');
  if (status === 'declined') return t('requests.statusDeclined');
  return t('requests.statusPending');
}

function statusColorClass(status) {
  if (status === 'approved') return 'text-emerald-600';
  if (status === 'declined') return 'text-rose-600';
  return 'text-slate-400';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
