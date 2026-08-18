// Admin "Service Requests" panel — post a titled, dated event (e.g. a
// one-off seminar), attach Praise and Worship songs to it, and send an
// RSVP request to every current member. Distinct from the free-form
// availability calendar: each request needs an explicit approve/decline
// response per member.
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
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.praiseSongs')}</label>
          <div data-el="praise-checklist" class="border border-slate-300 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1 text-sm"></div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.worshipSongs')}</label>
          <div data-el="worship-checklist" class="border border-slate-300 rounded-lg p-2 max-h-40 overflow-y-auto space-y-1 text-sm"></div>
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
  const praiseChecklistEl = container.querySelector('[data-el="praise-checklist"]');
  const worshipChecklistEl = container.querySelector('[data-el="worship-checklist"]');
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
    const songs = data || [];
    renderChecklist(praiseChecklistEl, songs);
    renderChecklist(worshipChecklistEl, songs);
    // A song can only be Praise or Worship for a given service, not both —
    // checking it in one list clears it from the other.
    wireExclusivity(praiseChecklistEl, worshipChecklistEl);
    wireExclusivity(worshipChecklistEl, praiseChecklistEl);
  }

  function renderChecklist(el, songs) {
    el.innerHTML = songs.length === 0
      ? `<p class="text-slate-400 text-xs">${t('requests.noSongsAvailable')}</p>`
      : songs.map((song) => `
          <label class="flex items-center gap-2">
            <input type="checkbox" value="${song.id}" data-song-checkbox />
            <span>${escapeHtml(song.title)}</span>
          </label>
        `).join('');
  }

  function wireExclusivity(el, otherEl) {
    el.querySelectorAll('[data-song-checkbox]').forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        if (!checkbox.checked) return;
        const twin = otherEl.querySelector(`[data-song-checkbox][value="${checkbox.value}"]`);
        if (twin) twin.checked = false;
      });
    });
  }

  function checkedSongIds(el) {
    return Array.from(el.querySelectorAll('[data-song-checkbox]:checked')).map((cb) => cb.value);
  }

  async function prefillFromDate(dateStr) {
    [praiseChecklistEl, worshipChecklistEl].forEach((el) => {
      el.querySelectorAll('[data-song-checkbox]').forEach((cb) => { cb.checked = false; });
    });
    if (!dateStr) return;

    const { data: plan } = await supabase
      .from('service_plans')
      .select('id, title')
      .eq('date', dateStr)
      .not('title', 'is', null)
      .maybeSingle();

    form.elements.title.value = plan?.title || '';
    if (!plan) return;

    const { data: planSongs } = await supabase
      .from('service_plan_songs')
      .select('song_id, category')
      .eq('service_plan_id', plan.id);

    (planSongs || []).forEach((row) => {
      const el = row.category === 'praise' ? praiseChecklistEl : worshipChecklistEl;
      const checkbox = el.querySelector(`[data-song-checkbox][value="${row.song_id}"]`);
      if (checkbox) checkbox.checked = true;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const dateStr = form.elements.date.value;
    const title = form.elements.title.value.trim();
    const praiseSongIds = checkedSongIds(praiseChecklistEl);
    const worshipSongIds = checkedSongIds(worshipChecklistEl);

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
          .update({ title, choir_leader_id: adminUserId })
          .eq('id', planId);
        if (updateError) throw updateError;
      } else {
        const { data: newPlan, error: insertError } = await supabase
          .from('service_plans')
          .insert({ date: dateStr, title, choir_leader_id: adminUserId, status: 'draft' })
          .select('id')
          .single();
        if (insertError) throw insertError;
        planId = newPlan.id;
      }

      const { error: deleteSongsError } = await supabase
        .from('service_plan_songs')
        .delete()
        .eq('service_plan_id', planId);
      if (deleteSongsError) throw deleteSongsError;

      const songRows = [
        ...praiseSongIds.map((song_id, position) => ({ service_plan_id: planId, song_id, category: 'praise', position })),
        ...worshipSongIds.map((song_id, position) => ({ service_plan_id: planId, song_id, category: 'worship', position })),
      ];
      if (songRows.length > 0) {
        const { error: insertSongsError } = await supabase.from('service_plan_songs').insert(songRows);
        if (insertSongsError) throw insertSongsError;
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
    const [{ data: rsvps, error: rsvpsError }, { data: planSongs, error: planSongsError }] = await Promise.all([
      supabase.from('service_rsvps').select('id, service_plan_id, status, reason, profiles ( full_name )').in('service_plan_id', planIds),
      supabase.from('service_plan_songs').select('service_plan_id, category, songs ( title )').in('service_plan_id', planIds).order('position'),
    ]);

    if (rsvpsError || planSongsError) {
      listEl.innerHTML = `<p class="text-sm text-rose-600">${t('requests.failedToLoad', { message: (rsvpsError || planSongsError).message })}</p>`;
      return;
    }

    const rsvpsByPlan = new Map(planIds.map((id) => [id, []]));
    (rsvps || []).forEach((r) => rsvpsByPlan.get(r.service_plan_id)?.push(r));

    const songsByPlan = new Map(planIds.map((id) => [id, { praise: [], worship: [] }]));
    (planSongs || []).forEach((row) => {
      if (row.songs) songsByPlan.get(row.service_plan_id)?.[row.category].push(row.songs.title);
    });

    listEl.innerHTML = '';
    plans.forEach((plan) => {
      const planRsvps = rsvpsByPlan.get(plan.id) || [];
      const counts = { approved: 0, declined: 0, pending: 0 };
      planRsvps.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
      const { praise, worship } = songsByPlan.get(plan.id) || { praise: [], worship: [] };

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
        ${(praise.length > 0 || worship.length > 0) ? `
          <div class="grid sm:grid-cols-2 gap-2 mt-2 text-xs text-slate-600">
            ${praise.length > 0 ? `<div><span class="font-semibold">${t('requests.praiseSongs')}:</span> ${praise.map(escapeHtml).join(', ')}</div>` : '<div></div>'}
            ${worship.length > 0 ? `<div><span class="font-semibold">${t('requests.worshipSongs')}:</span> ${worship.map(escapeHtml).join(', ')}</div>` : ''}
          </div>
        ` : ''}
        <details class="mt-2">
          <summary class="text-xs font-medium text-slate-500 cursor-pointer">${t('requests.viewResponses')}</summary>
          <p class="text-xs text-slate-400 mt-2 mb-2">${t('requests.onBehalfHint')}</p>
          <ul class="mt-1 space-y-2 text-sm" data-el="rsvp-list"></ul>
        </details>
      `;

      const rsvpListEl = card.querySelector('[data-el="rsvp-list"]');
      planRsvps.forEach((rsvp) => rsvpListEl.appendChild(renderRsvpRow(rsvp)));

      card.querySelector('[data-action="cancel"]').addEventListener('click', () => cancelRequest(plan));
      card.querySelector('[data-action="edit"]').addEventListener('click', () => {
        dateInput.value = plan.date;
        prefillFromDate(plan.date);
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      listEl.appendChild(card);
    });
  }

  function renderRsvpRow(rsvp) {
    const li = document.createElement('li');
    li.className = 'border-b border-slate-100 last:border-0 pb-2 last:pb-0';
    li.innerHTML = `
      <div class="flex items-center justify-between gap-2">
        <span class="text-slate-700">${escapeHtml(rsvp.profiles?.full_name || '')}</span>
        <select data-el="status-select" class="border border-slate-300 rounded px-1.5 py-1 text-xs">
          <option value="pending" ${rsvp.status === 'pending' ? 'selected' : ''}>${t('requests.statusPending')}</option>
          <option value="approved" ${rsvp.status === 'approved' ? 'selected' : ''}>${t('requests.statusApproved')}</option>
          <option value="declined" ${rsvp.status === 'declined' ? 'selected' : ''}>${t('requests.statusDeclined')}</option>
        </select>
      </div>
      <div data-el="reason-row" class="mt-1.5 flex gap-2 ${rsvp.status === 'declined' ? '' : 'hidden'}">
        <input type="text" data-el="reason-input" value="${escapeAttr(rsvp.reason || '')}"
               placeholder="${t('requests.reasonPlaceholder')}"
               class="flex-1 border border-slate-300 rounded px-2 py-1 text-xs" />
        <button type="button" data-el="save-reason"
                class="px-2 py-1 rounded bg-slate-700 text-white text-xs font-medium hover:bg-slate-800 whitespace-nowrap">
          ${t('requests.saveReason')}
        </button>
      </div>
      <p data-el="row-status" class="text-xs mt-1"></p>
    `;

    const statusSelect = li.querySelector('[data-el="status-select"]');
    const reasonRow = li.querySelector('[data-el="reason-row"]');
    const reasonInput = li.querySelector('[data-el="reason-input"]');
    const saveReasonBtn = li.querySelector('[data-el="save-reason"]');
    const rowStatusEl = li.querySelector('[data-el="row-status"]');

    statusSelect.addEventListener('change', async () => {
      const newStatus = statusSelect.value;
      reasonRow.classList.toggle('hidden', newStatus !== 'declined');

      const { error } = await supabase
        .from('service_rsvps')
        .update({ status: newStatus, responded_at: new Date().toISOString() })
        .eq('id', rsvp.id);

      if (error) {
        rowStatusEl.className = 'text-xs mt-1 text-rose-600';
        rowStatusEl.textContent = t('requests.statusUpdateFailed', { message: error.message });
        return;
      }

      rsvp.status = newStatus;
      rowStatusEl.textContent = '';
      loadRequests();
    });

    saveReasonBtn.addEventListener('click', async () => {
      const reason = reasonInput.value.trim() || null;
      const { error } = await supabase.from('service_rsvps').update({ reason }).eq('id', rsvp.id);

      if (error) {
        rowStatusEl.className = 'text-xs mt-1 text-rose-600';
        rowStatusEl.textContent = t('requests.reasonSaveFailed', { message: error.message });
        return;
      }

      rsvp.reason = reason;
      rowStatusEl.className = 'text-xs mt-1 text-emerald-600';
      rowStatusEl.textContent = t('requests.reasonSaved');
    });

    return li;
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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
