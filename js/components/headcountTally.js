// Live tap-to-count headcounting for Ushers/Welcoming & Socialisation/
// Ecodem — three counters (Men/Women/Kids), each with its own minus/
// plus buttons (or type the number directly — useful starting from 0,
// or to jump straight to a known count instead of tapping it out) and
// its own Enter button, so several ushers can each count one group on
// their own phone (reached via the same shared link/QR code) and
// submit independently as families come through the door. Submitting
// ADDS to whatever total already exists for that department+date
// (sql/saas_platform/33_headcount_tally_rpc.sql's add_headcount_tally
// RPC) rather than replacing it, so two ushers' submissions for the
// same group never clobber each other. Each square also shows the
// running total already recorded for the selected date, refreshed
// right after every submit -- this is the actual confirmation that a
// submission landed, since the separate admin-facing Headcount History
// table (headcountBoard.js, inside the Dashboard tab) is a different,
// already-rendered tab that won't pick up this change on its own
// (activateTab() only shows/hides a tab's DOM, it doesn't re-fetch an
// already-loaded one) — invalidateTabCache('dept-dashboard') below is
// what forces that tab to re-fetch the next time someone visits it.
// Deliberately separate from headcountBoard.js's admin form, which is
// an overwrite (an admin setting/correcting the exact total) — this
// is additive and open to any approved department member, not just an
// admin/secretary.
import { t, departmentLabel } from '../i18n.js';
import { todayLocal } from '../utils/date.js';
import { invalidateTabCache } from '../app.js';
import { toCanvas as qrToCanvas } from 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm';

const GROUPS = [
  { key: 'men', countKey: 'men_count', label: 'headcountTally.men', color: '#4f46e5' },
  { key: 'women', countKey: 'women_count', label: 'headcountTally.women', color: '#db2777' },
  { key: 'kids', countKey: 'kids_count', label: 'headcountTally.kids', color: '#059669' },
];

export function renderHeadcountTally(container, { supabase, departmentId, departmentKey }) {
  const counts = { men: 0, women: 0, kids: 0 };

  container.innerHTML = `
    <div class="bg-white rounded-xl shadow p-4 sm:p-6 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <div class="max-w-xs">
          <label class="block text-sm font-medium text-slate-600 mb-1">${t('requests.date')}</label>
          <input type="date" data-el="date-input" value="${todayLocal()}" class="border border-slate-300 rounded-lg px-3 py-2" />
        </div>
        <button type="button" data-action="share" class="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 whitespace-nowrap">
          ${t('headcountTally.shareLink')}
        </button>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        ${GROUPS.map((g) => `
          <div class="border border-slate-200 rounded-xl p-4 text-center">
            <div class="text-sm font-semibold text-slate-700 mb-1">${t(g.label)}</div>
            <div class="text-xs text-slate-400 mb-3">${t('headcountTally.recordedSoFarLabel')} <span data-el="recorded-${g.key}" class="font-semibold text-slate-600">0</span></div>
            <div class="flex items-center justify-between gap-2">
              <button type="button" data-action="minus" data-group-key="${g.key}"
                  class="w-14 h-14 rounded-full bg-slate-100 text-slate-600 text-3xl font-bold hover:bg-slate-200 active:scale-95 transition-transform shrink-0">−</button>
              <input type="number" min="0" inputmode="numeric" value="0" data-el="count-${g.key}"
                  class="w-full text-4xl font-extrabold tabular-nums text-center border-0 focus:ring-2 focus:ring-offset-1 rounded-lg" style="color:${g.color}" />
              <button type="button" data-action="plus" data-group-key="${g.key}"
                  class="w-14 h-14 rounded-full text-white text-3xl font-bold active:scale-95 transition-transform shrink-0" style="background:${g.color}">+</button>
            </div>
            <button type="button" data-action="submit" data-group-key="${g.key}"
                class="mt-4 w-full px-3 py-2.5 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900 disabled:opacity-40" disabled>
              ${t('headcountTally.enter')}
            </button>
            <div class="text-xs mt-2 min-h-[1em]" data-el="status-${g.key}"></div>
          </div>
        `).join('')}
      </div>
    </div>
    <div data-el="qr-panel" class="hidden bg-white rounded-xl shadow p-4 sm:p-6 text-center"></div>
  `;

  const dateInput = container.querySelector('[data-el="date-input"]');
  const qrPanel = container.querySelector('[data-el="qr-panel"]');

  container.querySelectorAll('[data-action="minus"]').forEach((btn) => {
    btn.addEventListener('click', () => adjust(btn.dataset.groupKey, -1));
  });
  container.querySelectorAll('[data-action="plus"]').forEach((btn) => {
    btn.addEventListener('click', () => adjust(btn.dataset.groupKey, 1));
  });
  container.querySelectorAll('[data-el^="count-"]').forEach((input) => {
    const key = input.dataset.el.replace('count-', '');
    input.addEventListener('input', () => setCount(key, input.value));
  });
  container.querySelectorAll('[data-action="submit"]').forEach((btn) => {
    btn.addEventListener('click', () => submitGroup(btn.dataset.groupKey));
  });
  container.querySelector('[data-action="share"]').addEventListener('click', toggleQr);
  dateInput.addEventListener('change', loadRecorded);

  loadRecorded();

  function setCount(key, rawValue) {
    const value = Math.max(0, Math.floor(Number(rawValue)) || 0);
    counts[key] = value;
    const input = container.querySelector(`[data-el="count-${key}"]`);
    if (String(value) !== input.value) input.value = String(value);
    container.querySelector(`[data-action="submit"][data-group-key="${key}"]`).disabled = value === 0;
  }

  function adjust(key, delta) {
    setCount(key, counts[key] + delta);
  }

  async function loadRecorded() {
    const { data } = await supabase.from('department_headcounts')
      .select('men_count, women_count, kids_count')
      .eq('department_id', departmentId)
      .eq('date', dateInput.value)
      .maybeSingle();

    GROUPS.forEach((g) => {
      const recordedEl = container.querySelector(`[data-el="recorded-${g.key}"]`);
      recordedEl.textContent = String(data?.[g.countKey] ?? 0);
    });
  }

  async function submitGroup(key) {
    const value = counts[key];
    if (value === 0) return;

    const submitBtn = container.querySelector(`[data-action="submit"][data-group-key="${key}"]`);
    const statusEl = container.querySelector(`[data-el="status-${key}"]`);
    submitBtn.disabled = true;
    statusEl.className = 'text-xs text-slate-400 mt-2 min-h-[1em]';
    statusEl.textContent = t('common.saving');

    const params = { p_department_id: departmentId, p_date: dateInput.value, p_men: 0, p_women: 0, p_kids: 0 };
    if (key === 'men') params.p_men = value;
    else if (key === 'women') params.p_women = value;
    else params.p_kids = value;

    const { data: updatedRow, error } = await supabase.rpc('add_headcount_tally', params);

    if (error) {
      statusEl.className = 'text-xs text-rose-600 mt-2 min-h-[1em]';
      statusEl.textContent = t('headcountTally.submitFailed', { message: error.message });
      submitBtn.disabled = false;
      return;
    }

    statusEl.className = 'text-xs text-emerald-600 mt-2 min-h-[1em]';
    statusEl.textContent = t('headcountTally.added', { count: value });
    const row = Array.isArray(updatedRow) ? updatedRow[0] : updatedRow;
    GROUPS.forEach((g) => {
      const recordedEl = container.querySelector(`[data-el="recorded-${g.key}"]`);
      if (row?.[g.countKey] !== undefined) recordedEl.textContent = String(row[g.countKey]);
    });
    // The Dashboard tab's Headcount History (headcountBoard.js) may
    // already be rendered from before this submission -- force it to
    // re-fetch next time it's visited instead of showing stale numbers.
    invalidateTabCache('dept-dashboard');
    setCount(key, 0); // back to 0, ready for the next batch of people
  }

  async function toggleQr() {
    if (!qrPanel.classList.contains('hidden')) {
      qrPanel.classList.add('hidden');
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}?open=headcount-tally&dept=${encodeURIComponent(departmentKey)}`;
    qrPanel.innerHTML = `
      <p class="text-sm text-slate-600 mb-3">${t('headcountTally.shareHint', { department: departmentLabel(departmentKey) })}</p>
      <canvas data-el="qr-canvas" class="mx-auto"></canvas>
      <p class="text-xs text-slate-400 mt-2 break-all">${escapeHtml(url)}</p>
    `;
    qrPanel.classList.remove('hidden');
    try {
      await qrToCanvas(qrPanel.querySelector('[data-el="qr-canvas"]'), url, { width: 220, margin: 1 });
    } catch { /* QR is a nice-to-have -- the URL text above still works without it */ }
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
