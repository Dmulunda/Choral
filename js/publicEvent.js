// Entry point for event.html — the public, unauthenticated event
// registration page (outsiders, no login, reached via a shared link/
// QR/flyer). Same shape as js/publicBooking.js: outside the normal
// app.js/index.html shell, no auth gate, no sidebar.
//
// Main is single-tenant -- no ?church= slug needed the way SAAS's
// version needs it (there's only one church, so
// get_public_event_for_registration() needs no tenant to resolve).
import { supabase } from './supabaseClient.js';
import { loadLabelOverrides, applyStaticTranslations, t } from './i18n.js';

async function main() {
  try {
    await loadLabelOverrides();
  } catch { /* fall through to built-in translations */ }
  applyStaticTranslations();

  const container = document.querySelector('#event-content');
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('event');

  if (!eventId) {
    container.innerHTML = `<p class="text-rose-600 bg-white rounded-xl shadow p-4 sm:p-6">${t('events.invalidLink')}</p>`;
    return;
  }

  const { data: event, error } = await supabase.rpc('get_public_event_for_registration', {
    p_event_id: eventId,
  });

  if (error || !event) {
    container.innerHTML = `<p class="text-rose-600 bg-white rounded-xl shadow p-4 sm:p-6">${escapeHtml(error?.message || t('events.notFound'))}</p>`;
    return;
  }

  renderEvent(container, event, { supabase, eventId });
}

function renderEvent(container, event, { supabase: sb, eventId }) {
  const when = new Date(event.startAt).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' });
  const whereLine = event.onlineLink
    ? `<p class="text-sm text-slate-600"><strong>${t('events.online')}:</strong> <a href="${escapeAttr(event.onlineLink)}" class="text-indigo-600 hover:underline">${escapeHtml(event.onlineLink)}</a></p>`
    : event.location ? `<p class="text-sm text-slate-600"><strong>${t('events.location')}:</strong> ${escapeHtml(event.location)}</p>` : '';

  const isFull = event.capacity != null && event.placesRemaining === 0 && !event.waitlistEnabled;
  const willWaitlist = event.capacity != null && event.placesRemaining === 0 && event.waitlistEnabled;

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
      ${event.coverImagePath ? `<img src="${escapeAttr(event.coverImagePath)}" alt="" class="w-full h-48 object-cover rounded-lg mb-4" />` : ''}
      <h2 class="text-2xl font-bold text-slate-800 mb-1">${escapeHtml(event.title)}</h2>
      <p class="text-xs text-slate-400 mb-3">${escapeHtml(event.departmentName)}</p>
      ${event.description ? `<p class="text-sm text-slate-600 whitespace-pre-wrap mb-3">${escapeHtml(event.description)}</p>` : ''}
      <p class="text-sm text-slate-600"><strong>${t('events.when')}:</strong> ${escapeHtml(when)}</p>
      ${whereLine}
      ${event.capacity != null ? `<p class="text-sm text-slate-500 mt-2">${t('events.placesRemaining', { count: event.placesRemaining })}</p>` : ''}
    </div>
    <div id="event-form-area"></div>
  `;

  const formArea = container.querySelector('#event-form-area');

  if (!event.registrationOpen) {
    formArea.innerHTML = `<p class="text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('events.registrationClosed')}</p>`;
    return;
  }
  if (isFull) {
    formArea.innerHTML = `<p class="text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-4 sm:p-6">${t('events.eventFull')}</p>`;
    return;
  }

  renderForm(formArea, event, { supabase: sb, eventId, willWaitlist });
}

function renderForm(formArea, event, { supabase: sb, eventId, willWaitlist }) {
  formArea.innerHTML = `
    <form id="event-register-form" class="bg-white rounded-xl shadow p-4 sm:p-6 space-y-3">
      ${willWaitlist ? `<p class="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">${t('events.willWaitlist')}</p>` : ''}
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('events.fullName')}</label>
        <input type="text" name="full_name" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('events.email')}</label>
        <input type="email" name="email" required class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      <div>
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('events.phone')}</label>
        <input type="tel" name="phone" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>
      ${event.questions.map((q) => `
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${escapeHtml(q.question)}${q.required ? ' *' : ''}</label>
          <input type="text" name="q_${q.id}" ${q.required ? 'required' : ''} class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
      `).join('')}
      <button type="submit" class="w-full py-2.5 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">${t('events.register')}</button>
      <p id="event-form-status" class="text-sm text-rose-600"></p>
    </form>
  `;

  const form = formArea.querySelector('#event-register-form');
  const statusEl = formArea.querySelector('#event-form-status');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    statusEl.textContent = '';

    const fd = new FormData(form);
    const answers = event.questions.map((q) => ({ question_id: q.id, answer: fd.get(`q_${q.id}`) || '' }));

    const { data, error } = await sb.rpc('register_for_event', {
      p_event_id: eventId,
      p_full_name: fd.get('full_name'),
      p_email: fd.get('email'),
      p_phone: fd.get('phone'),
      p_answers: answers,
    });

    if (error) {
      submitBtn.disabled = false;
      statusEl.textContent = error.message;
      return;
    }

    formArea.innerHTML = `
      <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 sm:p-6 text-center">
        <p class="text-emerald-800 font-medium">${data.status === 'waitlisted' ? t('events.waitlistedConfirmation') : t('events.registeredConfirmation')}</p>
        <p class="text-sm text-emerald-700 mt-1">${t('events.checkEmail')}</p>
      </div>
    `;
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}
function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}

main();
