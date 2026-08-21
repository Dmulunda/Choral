// Attendance check-in for Ushers/Super Admin/Pastor Admin/Church
// Secretary (see can_record_attendance() in sql/037) — search for a
// member by name, or scan their personal check-in QR code (generated
// by myCheckInCode.js, just their profile id as plain text — nothing
// secret, scanning it only pulls up their name for the usher to
// confirm). A guest with no account can be logged by name alongside
// members; sql/038's trigger picks guests up for pastoral follow-up
// automatically.
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

      <div class="flex gap-2 mb-3">
        <button type="button" data-el="tab-search" class="px-3 py-1.5 rounded-lg text-sm font-medium">${t('attendance.tabSearch')}</button>
        <button type="button" data-el="tab-scan" class="px-3 py-1.5 rounded-lg text-sm font-medium">${t('attendance.tabScan')}</button>
      </div>

      <div data-el="search-panel">
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
      </div>

      <div data-el="scan-panel" class="hidden">
        <video data-el="scan-video" class="w-full rounded-lg bg-slate-900 aspect-video" playsinline muted></video>
        <p data-el="scan-status" class="text-sm text-slate-500 mt-2"></p>
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
  const tabSearchBtn = root.querySelector('[data-el="tab-search"]');
  const tabScanBtn = root.querySelector('[data-el="tab-scan"]');
  const searchPanelEl = root.querySelector('[data-el="search-panel"]');
  const scanPanelEl = root.querySelector('[data-el="scan-panel"]');
  const memberSearchEl = root.querySelector('[data-el="member-search"]');
  const searchResultsEl = root.querySelector('[data-el="search-results"]');
  const guestNameEl = root.querySelector('[data-el="guest-name"]');
  const addGuestBtn = root.querySelector('[data-action="add-guest"]');
  const scanVideoEl = root.querySelector('[data-el="scan-video"]');
  const scanStatusEl = root.querySelector('[data-el="scan-status"]');
  const statusEl = root.querySelector('[data-el="status"]');
  const checkedInListEl = root.querySelector('[data-el="checked-in-list"]');

  let members = [];
  let checkedInThisSession = [];
  let scanStream = null;
  let scanRafId = null;

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  serviceTypeEl.addEventListener('change', () => {
    serviceLabelWrapEl.classList.toggle('hidden', serviceTypeEl.value !== 'special_service');
  });

  function setTabStyle(btn, active) {
    btn.classList.toggle('bg-indigo-600', active);
    btn.classList.toggle('text-white', active);
    btn.classList.toggle('text-slate-600', !active);
    btn.classList.toggle('hover:bg-slate-100', !active);
  }

  function activateTab(tab) {
    const isSearch = tab === 'search';
    setTabStyle(tabSearchBtn, isSearch);
    setTabStyle(tabScanBtn, !isSearch);
    searchPanelEl.classList.toggle('hidden', !isSearch);
    scanPanelEl.classList.toggle('hidden', isSearch);
    if (isSearch) stopScanning(); else startScanning();
  }

  tabSearchBtn.addEventListener('click', () => activateTab('search'));
  tabScanBtn.addEventListener('click', () => activateTab('scan'));

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
      // A repeat scan/search for someone already checked in for this
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

  // Camera-based QR scanning — decodes with jsQR against each video
  // frame. The scanned text is just a profile id; if it doesn't match
  // an approved member, this reports it and keeps scanning rather than
  // silently doing nothing.
  async function startScanning() {
    scanStatusEl.textContent = t('attendance.scanRequestingCamera');
    try {
      scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    } catch (err) {
      scanStatusEl.textContent = t('attendance.scanCameraFailed', { message: err.message });
      return;
    }

    scanVideoEl.srcObject = scanStream;
    await scanVideoEl.play();
    scanStatusEl.textContent = t('attendance.scanReady');

    const { default: jsQR } = await import('https://cdn.jsdelivr.net/npm/jsqr@1.4.0/+esm');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let lastScannedId = null;
    let lastScannedAt = 0;

    function tick() {
      if (!scanStream) return;
      if (scanVideoEl.readyState === scanVideoEl.HAVE_ENOUGH_DATA) {
        canvas.width = scanVideoEl.videoWidth;
        canvas.height = scanVideoEl.videoHeight;
        ctx.drawImage(scanVideoEl, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code?.data) {
          const now = Date.now();
          // Debounces the same code being decoded on every frame while
          // it's still in view — 3s is enough to move the QR away and
          // scan someone new without spamming duplicate inserts.
          if (code.data !== lastScannedId || now - lastScannedAt > 3000) {
            lastScannedId = code.data;
            lastScannedAt = now;
            handleScannedId(code.data);
          }
        }
      }
      scanRafId = requestAnimationFrame(tick);
    }
    scanRafId = requestAnimationFrame(tick);
  }

  function handleScannedId(scannedId) {
    const member = members.find((m) => m.id === scannedId);
    if (!member) {
      scanStatusEl.className = 'text-sm text-rose-600 mt-2';
      scanStatusEl.textContent = t('attendance.scanUnknownCode');
      return;
    }
    scanStatusEl.className = 'text-sm text-slate-500 mt-2';
    scanStatusEl.textContent = t('attendance.scanReady');
    checkInMember(member.id, member.full_name);
  }

  function stopScanning() {
    if (scanRafId) cancelAnimationFrame(scanRafId);
    scanRafId = null;
    if (scanStream) {
      scanStream.getTracks().forEach((tr) => tr.stop());
      scanStream = null;
    }
    scanVideoEl.srcObject = null;
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
    activateTab('search');
    await loadMembers();
  }

  function close() {
    stopScanning();
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
