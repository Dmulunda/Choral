// Attendance check-in for Ushers/Super Admin/Pastor Admin/Church
// Secretary (see can_record_attendance() in sql/037) — search for a
// member by name and check them in, or log a guest visitor by name.
// sql/038's trigger picks guests up for pastoral follow-up automatically.
import { t } from '../i18n.js';

const SERVICE_TYPES = ['sunday_service', 'midweek_service', 'special_service'];

function todayLocalDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function createAttendanceManagerModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">${t('attendance.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>

      <div class="grid sm:grid-cols-2 gap-3 mb-4">
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('attendance.serviceDate')}</label>
          <input type="date" data-el="service-date" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('attendance.serviceType')}</label>
          <select data-el="service-type" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            ${SERVICE_TYPES.map((s) => `<option value="${s}">${t(`attendance.type.${s}`)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div data-el="service-label-wrap" class="hidden mb-4">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('attendance.serviceLabel')}</label>
        <input type="text" data-el="service-label" placeholder="${t('attendance.serviceLabelPlaceholder')}"
               class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </div>

      <input type="search" data-el="member-search" placeholder="${t('attendance.searchPlaceholder')}"
             class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2" />
      <div data-el="search-results" class="max-h-40 overflow-y-auto border border-slate-100 rounded-lg divide-y mb-3"></div>

      <div class="border-t border-slate-200 pt-3">
        <label class="block text-sm font-medium text-slate-600 mb-1">${t('attendance.guestName')}</label>
        <div class="flex gap-2">
          <input type="text" data-el="guest-name" placeholder="${t('attendance.guestNamePlaceholder')}"
                 class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          <button type="button" data-action="add-guest" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 whitespace-nowrap">
            ${t('attendance.addGuest')}
          </button>
        </div>
      </div>

      <p data-el="status" class="text-sm mt-3"></p>
      <div data-el="checked-in-list" class="mt-3 space-y-1"></div>
    </div>
  `;
  document.body.appendChild(root);

  const serviceDateEl = root.querySelector('[data-el="service-date"]');
  const serviceTypeEl = root.querySelector('[data-el="service-type"]');
  const serviceLabelWrapEl = root.querySelector('[data-el="service-label-wrap"]');
  const serviceLabelEl = root.querySelector('[data-el="service-label"]');
  const memberSearchEl = root.querySelector('[data-el="member-search"]');
  const searchResultsEl = root.querySelector('[data-el="search-results"]');
  const guestNameEl = root.querySelector('[data-el="guest-name"]');
  const addGuestBtn = root.querySelector('[data-action="add-guest"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const checkedInListEl = root.querySelector('[data-el="checked-in-list"]');

  let members = [];
  let checkedInThisSession = [];

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  serviceTypeEl.addEventListener('change', () => {
    serviceLabelWrapEl.classList.toggle('hidden', serviceTypeEl.value !== 'special_service');
  });

  async function loadMembers() {
    const { data } = await supabase
      .from('department_memberships')
      .select('user_id, member:profiles!user_id ( id, full_name )')
      .eq('status', 'approved');

    const byId = new Map();
    (data || []).forEach((r) => { if (r.member) byId.set(r.member.id, r.member.full_name); });
    members = Array.from(byId.entries()).map(([id, full_name]) => ({ id, full_name })).sort((a, b) => a.full_name.localeCompare(b.full_name));
  }

  memberSearchEl.addEventListener('input', () => renderSearchResults(memberSearchEl.value.trim().toLowerCase()));

  function renderSearchResults(query) {
    const matches = query ? members.filter((m) => m.full_name.toLowerCase().includes(query)) : [];
    searchResultsEl.innerHTML = matches.slice(0, 15).map((m) => `
      <button type="button" data-member-id="${m.id}" class="w-full text-left px-2 py-1.5 text-sm hover:bg-slate-100">${escapeHtml(m.full_name)}</button>
    `).join('');
    searchResultsEl.querySelectorAll('[data-member-id]').forEach((btn) => {
      btn.addEventListener('click', () => checkInMember(btn.dataset.memberId, btn.textContent.trim()));
    });
  }

  addGuestBtn.addEventListener('click', () => {
    const name = guestNameEl.value.trim();
    if (!name) return;
    checkInGuest(name);
  });

  async function checkInMember(memberId, memberName) {
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('attendance_records').insert({
      service_date: serviceDateEl.value,
      service_type: serviceTypeEl.value,
      service_label: serviceTypeEl.value === 'special_service' ? (serviceLabelEl.value.trim() || null) : null,
      member_id: memberId,
      recorded_by: currentUserId,
    });

    if (error) {
      // A repeat search for someone already checked in for this
      // service just no-ops instead of erroring — the unique index in
      // sql/037 is what actually prevents the duplicate.
      if (error.code === '23505') {
        statusEl.className = 'text-sm text-amber-600';
        statusEl.textContent = t('attendance.alreadyCheckedIn', { name: memberName });
        return;
      }
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('attendance.checkInFailed', { message: error.message });
      return;
    }

    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('attendance.checkedIn', { name: memberName });
    checkedInThisSession.unshift(memberName);
    renderCheckedInList();
    memberSearchEl.value = '';
    searchResultsEl.innerHTML = '';
  }

  async function checkInGuest(name) {
    statusEl.className = 'text-sm text-slate-500';
    statusEl.textContent = t('common.saving');

    const { error } = await supabase.from('attendance_records').insert({
      service_date: serviceDateEl.value,
      service_type: serviceTypeEl.value,
      service_label: serviceTypeEl.value === 'special_service' ? (serviceLabelEl.value.trim() || null) : null,
      guest_name: name,
      recorded_by: currentUserId,
    });

    if (error) {
      statusEl.className = 'text-sm text-rose-600';
      statusEl.textContent = t('attendance.checkInFailed', { message: error.message });
      return;
    }

    statusEl.className = 'text-sm text-emerald-600';
    statusEl.textContent = t('attendance.guestCheckedIn', { name });
    checkedInThisSession.unshift(`${name} (${t('attendance.guestBadge')})`);
    renderCheckedInList();
    guestNameEl.value = '';
  }

  function renderCheckedInList() {
    checkedInListEl.innerHTML = checkedInThisSession.map((name) => `
      <div class="text-sm text-slate-600 px-2 py-1 bg-slate-50 rounded">${escapeHtml(name)}</div>
    `).join('');
  }

  async function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    serviceDateEl.value = todayLocalDate();
    serviceTypeEl.value = 'sunday_service';
    serviceLabelWrapEl.classList.add('hidden');
    statusEl.textContent = '';
    checkedInThisSession = [];
    renderCheckedInList();
    await loadMembers();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
