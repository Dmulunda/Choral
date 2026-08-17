// Singer "Service Requests" panel — titled, dated events an admin has
// asked this member to approve or decline. Distinct from the free-form
// availability calendar rendered below it.
import { t } from '../i18n.js';

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
      .select('id, status, service_plans ( id, date, title )')
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

  function renderCard(rsvp) {
    const plan = rsvp.service_plans;
    const card = document.createElement('div');
    card.className = 'flex flex-wrap items-center justify-between gap-3 border border-slate-200 rounded-lg p-3';
    card.innerHTML = `
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
    `;

    card.querySelector('[data-action="approve"]').addEventListener('click', () => respond(rsvp, 'approved'));
    card.querySelector('[data-action="decline"]').addEventListener('click', () => respond(rsvp, 'declined'));

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
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
