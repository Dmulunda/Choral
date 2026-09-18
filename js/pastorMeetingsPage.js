// Pastor Meetings tab -- replaces the old note-only "Request meeting
// with pastor" popup. Visible to every signed-in user (everyone can
// book), with extra sections layered in by role:
//   - Pastor Admin: "My Availability" (self-service calendar) + "My
//     Bookings" (people who booked with them -- this didn't exist at
//     all before; a Pastor Admin previously had zero visibility into
//     pastor meeting requests).
//   - Super Admin / Church Secretary: "All Bookings" (every booking,
//     with contact info), "Staff" (roster of bookable pastors), and
//     "Settings" (Manual/Random assignment mode + the public booking
//     link to share with non-members).
import { getEffectiveSupabase, getGlobalRole } from './departments.js';
import { renderPastorBookingCalendar } from './components/pastorBookingCalendar.js';
import { renderPastorAvailabilityCalendar } from './components/pastorAvailabilityCalendar.js';
import { t, tn } from './i18n.js';
import { confirmDialog } from './components/confirmDialog.js';
import { openMeetingWindow, navigateMeetingWindow } from './components/videoMeeting.js';

const PASTORAL_TEAM_ROLES = ['super_admin', 'church_secretary'];

export async function renderPastorMeetingsTab() {
  const supabase = getEffectiveSupabase();
  const container = document.querySelector('#pastor-meetings-content');
  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    container.innerHTML = `<p class="text-slate-500">${t('scheduling.pleaseSignIn')}</p>`;
    return;
  }

  const { data: profile } = await supabase.from('profiles').select('id, full_name').eq('id', user.id).single();
  const role = getGlobalRole();
  const isPastor = role === 'pastor_admin';
  const isAdminTeam = PASTORAL_TEAM_ROLES.includes(role);

  const tabs = [{ key: 'book', label: t('pastorBooking.tabBook') }, { key: 'my-requests', label: t('pastorBooking.tabMyRequests') }];
  if (isPastor) {
    tabs.push({ key: 'my-availability', label: t('pastorBooking.tabMyAvailability') });
    tabs.push({ key: 'my-bookings', label: t('pastorBooking.tabMyBookings') });
  }
  if (isAdminTeam) {
    tabs.push({ key: 'all-bookings', label: t('pastorBooking.tabAllBookings') });
    tabs.push({ key: 'staff', label: t('pastorBooking.tabStaff') });
    tabs.push({ key: 'settings', label: t('pastorBooking.tabSettings') });
  }

  container.innerHTML = `
    <div class="flex flex-wrap gap-2 mb-6" data-el="tab-buttons"></div>
    <div data-el="tab-body"></div>
  `;
  const tabButtonsEl = container.querySelector('[data-el="tab-buttons"]');
  const bodyEl = container.querySelector('[data-el="tab-body"]');

  tabs.forEach((tabDef, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.tabKey = tabDef.key;
    btn.textContent = tabDef.label;
    btn.className = 'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors';
    btn.addEventListener('click', () => activate(tabDef.key));
    tabButtonsEl.appendChild(btn);
    if (i === 0) activate(tabDef.key);
  });

  function setTabStyle(key) {
    tabButtonsEl.querySelectorAll('button').forEach((btn) => {
      const active = btn.dataset.tabKey === key;
      btn.classList.toggle('bg-indigo-600', active);
      btn.classList.toggle('text-white', active);
      btn.classList.toggle('text-slate-600', !active);
      btn.classList.toggle('hover:bg-slate-100', !active);
    });
  }

  function activate(key) {
    setTabStyle(key);
    bodyEl.innerHTML = '';
    if (key === 'book') renderBookTab();
    else if (key === 'my-requests') renderMyRequestsTab();
    else if (key === 'my-availability') renderPastorAvailabilityCalendar(bodyEl, { supabase, pastorId: user.id });
    else if (key === 'my-bookings') renderBookingsList(bodyEl, { supabase, filter: { pastor_id: user.id }, canCancel: true, currentUserId: user.id });
    else if (key === 'all-bookings') renderBookingsList(bodyEl, { supabase, filter: {}, canCancel: true, currentUserId: user.id, showPastorColumn: true });
    else if (key === 'staff') renderStaffTab(bodyEl, { supabase });
    else if (key === 'settings') renderSettingsTab(bodyEl, { supabase, currentUserId: user.id });
  }

  function renderBookTab() {
    const wrap = document.createElement('div');
    wrap.className = 'bg-white rounded-xl shadow p-4 sm:p-6';
    bodyEl.appendChild(wrap);
    renderPastorBookingCalendar(wrap, {
      supabase,
      currentUserProfile: profile,
      onBooked: () => {},
    });
  }

  function renderMyRequestsTab() {
    renderBookingsList(bodyEl, { supabase, filter: { user_id: user.id }, canCancel: false, currentUserId: user.id, showPastorColumn: true });
  }
}

async function renderBookingsList(container, { supabase, filter, canCancel, currentUserId, showPastorColumn }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  let query = supabase
    .from('pastor_meeting_requests')
    .select('id, note, status, meeting_room, created_at, guest_name, guest_email, guest_phone, meeting_type, requester:profiles!user_id(full_name), pastor:profiles!pastor_id(full_name)')
    .order('created_at', { ascending: false });
  Object.entries(filter).forEach(([col, val]) => { query = query.eq(col, val); });

  const { data, error } = await query;
  if (error) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('pastorBooking.loadFailed', { message: error.message })}</p>`;
    return;
  }
  if (!data || data.length === 0) {
    container.innerHTML = `<p class="text-sm text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('pastorBooking.noBookings')}</p>`;
    return;
  }

  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'space-y-2';
  container.appendChild(list);

  data.forEach((row) => {
    const who = row.requester?.full_name || row.guest_name || t('pastorBooking.unknownRequester');
    const el = document.createElement('div');
    el.className = 'bg-white rounded-xl shadow p-3 sm:p-4 text-sm';
    el.innerHTML = `
      <div class="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <span class="font-medium text-slate-800">${escapeHtml(who)}</span>
          ${showPastorColumn && row.pastor?.full_name ? ` <span class="text-slate-400">${t('pastorBooking.withPastor', { name: escapeHtml(row.pastor.full_name) })}</span>` : ''}
        </div>
        ${statusBadge(row.status)}
      </div>
      <div class="text-xs text-slate-500 mt-1">${escapeHtml(new Date(row.created_at).toLocaleString())} · ${row.meeting_type === 'online' ? t('pastorBooking.online') : t('pastorBooking.office')}</div>
      ${row.guest_email ? `<div class="text-xs text-slate-500 mt-1">${escapeHtml(row.guest_email)}${row.guest_phone ? ` · ${escapeHtml(row.guest_phone)}` : ''}</div>` : ''}
      ${row.note ? `<p class="text-slate-700 mt-2">${escapeHtml(row.note)}</p>` : ''}
      <div class="flex items-center gap-2 mt-2">
        ${row.meeting_room && row.status === 'confirmed' ? `<button type="button" data-action="join" class="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700">${t('meeting.join')}</button>` : ''}
        ${canCancel && row.status === 'confirmed' ? `<button type="button" data-action="cancel" class="px-3 py-1.5 rounded-lg bg-rose-100 text-rose-700 text-xs font-medium hover:bg-rose-200">${t('pastorBooking.cancel')}</button>` : ''}
      </div>
    `;

    el.querySelector('[data-action="join"]')?.addEventListener('click', async () => {
      const win = openMeetingWindow();
      const { data: myProfile } = await supabase.from('profiles').select('full_name').eq('id', currentUserId).single();
      navigateMeetingWindow(win, { roomName: row.meeting_room, displayName: myProfile?.full_name || '' });
    });

    el.querySelector('[data-action="cancel"]')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ message: t('pastorBooking.confirmCancel') }))) return;
      const { error: cancelError } = await supabase.rpc('cancel_pastor_meeting_booking', { p_id: row.id });
      if (cancelError) {
        window.alert(t('pastorBooking.cancelFailed', { message: cancelError.message }));
        return;
      }
      renderBookingsList(container, { supabase, filter, canCancel, currentUserId, showPastorColumn });
    });

    list.appendChild(el);
  });
}

function statusBadge(status) {
  const styles = {
    confirmed: 'bg-emerald-100 text-emerald-700',
    cancelled: 'bg-slate-100 text-slate-500',
    pending: 'bg-amber-100 text-amber-700',
    declined: 'bg-rose-100 text-rose-700',
  };
  return `<span class="px-2 py-0.5 rounded text-xs font-medium ${styles[status] || styles.pending}">${t(`pastorMeeting.status.${status}`) || status}</span>`;
}

async function renderStaffTab(container, { supabase }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  const [{ data: pastors, error }, { data: openSlots }] = await Promise.all([
    supabase.from('profiles').select('id, full_name').eq('global_role', 'pastor_admin'),
    supabase.from('pastor_availability').select('pastor_id').gte('date', new Date().toISOString().slice(0, 10)),
  ]);
  if (error) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('pastorBooking.loadFailed', { message: error.message })}</p>`;
    return;
  }

  const slotCountByPastor = new Map();
  (openSlots || []).forEach((r) => slotCountByPastor.set(r.pastor_id, (slotCountByPastor.get(r.pastor_id) || 0) + 1));

  if (!pastors || pastors.length === 0) {
    container.innerHTML = `<p class="text-sm text-slate-500 bg-white rounded-xl shadow p-4 sm:p-6">${t('pastorBooking.noStaff')}</p>`;
    return;
  }

  container.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'space-y-2';
  container.appendChild(list);
  pastors.forEach((p) => {
    const el = document.createElement('div');
    el.className = 'bg-white rounded-xl shadow p-3 sm:p-4 flex items-center justify-between';
    el.innerHTML = `
      <span class="font-medium text-slate-800">${escapeHtml(p.full_name)}</span>
      <span class="text-sm text-slate-500">${tn('pastorBooking.upcomingSlots', slotCountByPastor.get(p.id) || 0)}</span>
    `;
    list.appendChild(el);
  });
}

async function renderSettingsTab(container, { supabase, currentUserId }) {
  container.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

  const { data, error } = await supabase.from('pastor_meeting_settings').select('selection_mode, min_booking_notice_hours').eq('id', true).maybeSingle();
  if (error) {
    container.innerHTML = `<p class="text-sm text-rose-600">${t('pastorBooking.loadFailed', { message: error.message })}</p>`;
    return;
  }

  const publicUrl = `${window.location.origin}/booking.html`;

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
      <h3 class="font-semibold text-slate-800 mb-3">${t('pastorBooking.assignmentModeTitle')}</h3>
      <div class="space-y-2">
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="mode" value="manual" ${data?.selection_mode === 'manual' ? 'checked' : ''} />
          ${t('pastorBooking.modeManual')}
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input type="radio" name="mode" value="random" ${data?.selection_mode === 'random' ? 'checked' : ''} />
          ${t('pastorBooking.modeRandom')}
        </label>
      </div>
      <p data-el="mode-status" class="text-sm mt-2"></p>
    </div>
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
      <h3 class="font-semibold text-slate-800 mb-2">${t('pastorBooking.noticeTitle')}</h3>
      <p class="text-sm text-slate-500 mb-2">${t('pastorBooking.noticeIntro')}</p>
      <div class="flex items-center gap-2">
        <input type="number" data-el="notice-input" min="0" step="1" value="${data?.min_booking_notice_hours ?? 24}" class="w-24 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        <span class="text-sm text-slate-500">${t('pastorBooking.hours')}</span>
        <button type="button" data-action="save-notice" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('pastorBooking.saveNotice')}</button>
      </div>
      <p data-el="notice-status" class="text-sm mt-2"></p>
    </div>
    <div class="bg-white rounded-xl shadow p-4 sm:p-6">
      <h3 class="font-semibold text-slate-800 mb-2">${t('pastorBooking.publicLinkTitle')}</h3>
      <p class="text-sm text-slate-500 mb-2">${t('pastorBooking.publicLinkIntro')}</p>
      <div class="flex items-center gap-2">
        <input type="text" readonly value="${escapeAttr(publicUrl)}" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-slate-50" />
        <button type="button" data-action="copy-link" class="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200">${t('pastorBooking.copyLink')}</button>
      </div>
    </div>
  `;

  const statusEl = container.querySelector('[data-el="mode-status"]');
  container.querySelectorAll('input[name="mode"]').forEach((input) => {
    input.addEventListener('change', async () => {
      statusEl.className = 'text-sm text-slate-500 mt-2';
      statusEl.textContent = t('common.saving');
      const { error: saveError } = await supabase.from('pastor_meeting_settings').upsert(
        { id: true, selection_mode: input.value, updated_by: currentUserId, updated_at: new Date().toISOString() },
        { onConflict: 'id' },
      );
      if (saveError) {
        statusEl.className = 'text-sm text-rose-600 mt-2';
        statusEl.textContent = t('pastorBooking.saveFailed', { message: saveError.message });
        return;
      }
      statusEl.className = 'text-sm text-emerald-600 mt-2';
      statusEl.textContent = t('pastorBooking.saved');
    });
  });

  const noticeStatusEl = container.querySelector('[data-el="notice-status"]');
  container.querySelector('[data-action="save-notice"]').addEventListener('click', async () => {
    const hours = Number(container.querySelector('[data-el="notice-input"]').value);
    if (!Number.isFinite(hours) || hours < 0) {
      noticeStatusEl.className = 'text-sm text-rose-600 mt-2';
      noticeStatusEl.textContent = t('pastorBooking.invalidNotice');
      return;
    }
    noticeStatusEl.className = 'text-sm text-slate-500 mt-2';
    noticeStatusEl.textContent = t('common.saving');
    const { error: saveError } = await supabase.from('pastor_meeting_settings').upsert(
      { id: true, min_booking_notice_hours: hours, updated_by: currentUserId, updated_at: new Date().toISOString() },
      { onConflict: 'id' },
    );
    if (saveError) {
      noticeStatusEl.className = 'text-sm text-rose-600 mt-2';
      noticeStatusEl.textContent = t('pastorBooking.saveFailed', { message: saveError.message });
      return;
    }
    noticeStatusEl.className = 'text-sm text-emerald-600 mt-2';
    noticeStatusEl.textContent = t('pastorBooking.saved');
  });

  container.querySelector('[data-action="copy-link"]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      const btn = container.querySelector('[data-action="copy-link"]');
      const original = btn.textContent;
      btn.textContent = t('pastorBooking.copied');
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch {
      window.prompt(t('pastorBooking.copyLinkManual'), publicUrl);
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replaceAll('"', '&quot;');
}
