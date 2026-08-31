// Singer availability calendar.
// Renders a monthly grid; clicking a day cycles it through
// unset -> available -> unavailable -> unset. Changes are staged
// locally and written to Supabase in a single batch on "Save" —
// except marking a day unavailable, which needs a reason: that
// transition instead confirms, then hands off to Report Absence with
// the date already added, so the reason (and the replacement-request/
// notification logic report_absence() already triggers) isn't
// skipped. Confirming reloads the month once Report Absence succeeds,
// picking up the real status from the server rather than guessing it
// locally.
import { formatDateLocal } from '../utils/date.js';
import { t, tn, monthName } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';
import { createReportAbsenceModal } from './reportAbsenceModal.js';

const STATUS_CYCLE = [undefined, 'available', 'unavailable'];

const STATUS_STYLES = {
  available: 'bg-emerald-500 text-white hover:bg-emerald-600',
  unavailable: 'bg-rose-500 text-white hover:bg-rose-600',
  undefined: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
};

export function renderAvailabilityCalendar(container, { supabase, userId }) {
  let viewDate = new Date(); // any date within the currently viewed month
  viewDate.setDate(1);

  let savedStatus = new Map(); // dateStr -> status, as last loaded from Supabase
  let localStatus = new Map(); // dateStr -> status, including unsaved edits
  let dirty = new Set(); // dateStrs changed since last load/save

  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <button type="button" data-action="prev-month"
              class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">${t('calendar.prev')}</button>
      <h2 data-el="month-label" class="text-lg font-semibold"></h2>
      <button type="button" data-action="next-month"
              class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">${t('calendar.next')}</button>
    </div>

    <div class="flex items-center gap-4 text-sm text-slate-500 mb-3">
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-emerald-500 inline-block"></span> ${t('calendar.available')}</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-rose-500 inline-block"></span> ${t('calendar.unavailable')}</span>
      <span class="inline-flex items-center gap-1.5"><span class="w-3 h-3 rounded bg-slate-100 border border-slate-300 inline-block"></span> ${t('calendar.notSet')}</span>
    </div>

    <div class="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 mb-1">
      <div>${t('calendar.days.sun')}</div><div>${t('calendar.days.mon')}</div><div>${t('calendar.days.tue')}</div><div>${t('calendar.days.wed')}</div><div>${t('calendar.days.thu')}</div><div>${t('calendar.days.fri')}</div><div>${t('calendar.days.sat')}</div>
    </div>
    <div data-el="grid" class="grid grid-cols-7 gap-1"></div>

    <div class="mt-5 flex items-center gap-3">
      <button type="button" data-action="save"
              class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
        ${t('calendar.saveAvailability')}
      </button>
      <span data-el="status" class="text-sm text-slate-500"></span>
    </div>
  `;

  const monthLabel = container.querySelector('[data-el="month-label"]');
  const grid = container.querySelector('[data-el="grid"]');
  const statusEl = container.querySelector('[data-el="status"]');
  const saveBtn = container.querySelector('[data-action="save"]');
  const reportAbsenceModal = createReportAbsenceModal({ supabase, onReported: () => loadMonth() });

  container.querySelector('[data-action="prev-month"]').addEventListener('click', () => {
    viewDate.setMonth(viewDate.getMonth() - 1);
    loadMonth();
  });
  container.querySelector('[data-action="next-month"]').addEventListener('click', () => {
    viewDate.setMonth(viewDate.getMonth() + 1);
    loadMonth();
  });
  saveBtn.addEventListener('click', saveChanges);

  loadMonth();

  async function loadMonth() {
    monthLabel.textContent = `${monthName(viewDate.getMonth())} ${viewDate.getFullYear()}`;
    statusEl.textContent = t('common.loading');
    dirty.clear();

    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);

    const { data, error } = await supabase
      .from('availability')
      .select('date, status')
      .eq('user_id', userId)
      .gte('date', formatDateLocal(firstDay))
      .lte('date', formatDateLocal(lastDay));

    if (error) {
      statusEl.textContent = t('calendar.failedToLoad', { message: error.message });
      return;
    }

    savedStatus = new Map(data.map((row) => [row.date, row.status]));
    localStatus = new Map(savedStatus);
    statusEl.textContent = '';
    renderGrid(firstDay, lastDay);
  }

  function renderGrid(firstDay, lastDay) {
    grid.innerHTML = '';

    // Leading blanks so day 1 lands in the correct weekday column.
    for (let i = 0; i < firstDay.getDay(); i++) {
      grid.appendChild(document.createElement('div'));
    }

    const todayStr = formatDateLocal(new Date());

    for (let day = 1; day <= lastDay.getDate(); day++) {
      const cellDate = new Date(viewDate.getFullYear(), viewDate.getMonth(), day);
      const dateStr = formatDateLocal(cellDate);
      const isPast = dateStr < todayStr;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.dataset.date = dateStr;
      cell.textContent = String(day);
      if (isPast) {
        cell.disabled = true;
        cell.className = 'h-12 rounded-lg font-medium bg-slate-50 text-slate-300 cursor-not-allowed';
      } else {
        cell.className = `h-12 rounded-lg font-medium transition-colors ${STATUS_STYLES[localStatus.get(dateStr)]}`;
        cell.addEventListener('click', () => toggleDate(dateStr, cell));
      }

      grid.appendChild(cell);
    }
  }

  function toggleDate(dateStr, cell) {
    const current = localStatus.get(dateStr);
    const nextIndex = (STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length;
    const next = STATUS_CYCLE[nextIndex];

    if (next === 'unavailable') {
      confirmDialog({ message: t('calendar.confirmUnavailable', { date: dateStr }), danger: false }).then((confirmed) => {
        if (confirmed) reportAbsenceModal.open(dateStr);
      });
      return;
    }

    if (next === undefined) {
      localStatus.delete(dateStr);
    } else {
      localStatus.set(dateStr, next);
    }

    if (localStatus.get(dateStr) === savedStatus.get(dateStr)) {
      dirty.delete(dateStr);
    } else {
      dirty.add(dateStr);
    }

    cell.className = `h-12 rounded-lg font-medium transition-colors ${STATUS_STYLES[localStatus.get(dateStr)]}`;
    statusEl.textContent = dirty.size > 0 ? tn('calendar.unsavedChanges', dirty.size) : '';
  }

  async function saveChanges() {
    if (dirty.size === 0) return;

    saveBtn.disabled = true;
    statusEl.textContent = t('common.saving');

    const toUpsert = [];
    const toDeleteDates = [];

    for (const dateStr of dirty) {
      const status = localStatus.get(dateStr);
      if (status === undefined) {
        toDeleteDates.push(dateStr);
      } else {
        toUpsert.push({ user_id: userId, date: dateStr, status });
      }
    }

    if (toUpsert.length > 0) {
      const { error } = await supabase
        .from('availability')
        .upsert(toUpsert, { onConflict: 'user_id,date' });
      if (error) {
        statusEl.textContent = t('calendar.saveFailed', { message: error.message });
        saveBtn.disabled = false;
        return;
      }
    }

    if (toDeleteDates.length > 0) {
      const { error } = await supabase
        .from('availability')
        .delete()
        .eq('user_id', userId)
        .in('date', toDeleteDates);
      if (error) {
        statusEl.textContent = t('calendar.saveFailed', { message: error.message });
        saveBtn.disabled = false;
        return;
      }
    }

    savedStatus = new Map(localStatus);
    dirty.clear();
    statusEl.textContent = t('calendar.saved');
    saveBtn.disabled = false;
  }
}
