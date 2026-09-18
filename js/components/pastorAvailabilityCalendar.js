// A pastor's own meeting-availability calendar — month grid (same
// shape as calendar.js's) where days with at least one slot are
// marked; clicking a day shows that date's slots as an editable list
// (start/end time + Office/Online), same list-of-rows pattern as
// uniformSchedule.js/preachingScheduleBoard.js. Unlike calendar.js's
// single upsert-by-date status, a pastor can have several distinct
// slots on one day, so this is plain insert/delete per row, not an
// upsert. Writes straight to pastor_availability under normal RLS
// (pastor_id = auth.uid()) — no RPC needed, this isn't a contested
// resource the way booking is.
import { formatDateLocal, todayLocal } from '../utils/date.js';
import { t, tn, monthName } from '../i18n.js';
import { confirmDialog } from './confirmDialog.js';

export function renderPastorAvailabilityCalendar(container, { supabase, pastorId }) {
  let viewDate = new Date();
  viewDate.setDate(1);
  let slotsByDate = new Map(); // dateStr -> [{id, start_time, end_time, location_type}, ...]
  let selectedDate = null;

  container.innerHTML = `
    <div class="flex items-center justify-between mb-4">
      <button type="button" data-action="prev-month" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">${t('calendar.prev')}</button>
      <h2 data-el="month-label" class="text-lg font-semibold"></h2>
      <button type="button" data-action="next-month" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700">${t('calendar.next')}</button>
    </div>
    <div class="grid grid-cols-7 gap-1 text-center text-xs font-medium text-slate-500 mb-1">
      <div>${t('calendar.days.sun')}</div><div>${t('calendar.days.mon')}</div><div>${t('calendar.days.tue')}</div><div>${t('calendar.days.wed')}</div><div>${t('calendar.days.thu')}</div><div>${t('calendar.days.fri')}</div><div>${t('calendar.days.sat')}</div>
    </div>
    <div data-el="grid" class="grid grid-cols-7 gap-1 mb-6"></div>
    <div data-el="day-panel" class="hidden bg-white rounded-xl shadow p-4 sm:p-6"></div>
  `;

  const monthLabel = container.querySelector('[data-el="month-label"]');
  const grid = container.querySelector('[data-el="grid"]');
  const dayPanel = container.querySelector('[data-el="day-panel"]');

  container.querySelector('[data-action="prev-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() - 1); loadMonth(); });
  container.querySelector('[data-action="next-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() + 1); loadMonth(); });

  loadMonth();

  async function loadMonth() {
    monthLabel.textContent = `${monthName(viewDate.getMonth())} ${viewDate.getFullYear()}`;
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
    const fromDate = formatDateLocal(firstDay);
    const toDate = formatDateLocal(lastDay);

    const { data, error } = await supabase
      .from('pastor_availability')
      .select('id, date, start_time, end_time, location_type')
      .eq('pastor_id', pastorId)
      .gte('date', fromDate)
      .lte('date', toDate)
      .order('start_time');

    slotsByDate = new Map();
    if (!error) {
      (data || []).forEach((row) => {
        if (!slotsByDate.has(row.date)) slotsByDate.set(row.date, []);
        slotsByDate.get(row.date).push(row);
      });
    }

    renderGrid();
    if (selectedDate && isInMonth(selectedDate)) {
      renderDayPanel();
    } else if (selectedDate) {
      // Navigated to a different month than the one that was open --
      // the panel no longer refers to a visible day, so close it.
      dayPanel.classList.add('hidden');
      selectedDate = null;
    }
  }

  function isInMonth(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.getFullYear() === viewDate.getFullYear() && d.getMonth() === viewDate.getMonth();
  }

  function renderGrid() {
    grid.innerHTML = '';
    const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);

    for (let i = 0; i < firstDay.getDay(); i++) grid.appendChild(document.createElement('div'));

    const todayStr = todayLocal();
    for (let day = 1; day <= lastDay.getDate(); day++) {
      const dateStr = formatDateLocal(new Date(viewDate.getFullYear(), viewDate.getMonth(), day));
      const isPast = dateStr < todayStr;
      const count = (slotsByDate.get(dateStr) || []).length;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.disabled = isPast;
      cell.className = `border rounded-lg p-1.5 min-h-[3.25rem] text-left transition-colors ${
        isPast ? 'border-slate-100 text-slate-300 cursor-not-allowed'
        : selectedDate === dateStr ? 'border-indigo-400 bg-indigo-50'
        : count > 0 ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
        : 'border-slate-200 hover:bg-slate-50'
      }`;
      cell.innerHTML = `
        <div class="text-xs font-semibold ${isPast ? 'text-slate-300' : 'text-slate-600'}">${day}</div>
        ${count > 0 ? `<div class="text-[11px] text-emerald-700 font-medium mt-0.5">${tn('pastorAvailability.slotCount', count)}</div>` : ''}
      `;
      if (!isPast) cell.addEventListener('click', () => { selectedDate = dateStr; renderDayPanel(); });
      grid.appendChild(cell);
    }
  }

  function renderDayPanel() {
    dayPanel.classList.remove('hidden');
    const slots = slotsByDate.get(selectedDate) || [];

    dayPanel.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold text-slate-800">${escapeHtml(selectedDate)}</h3>
        <button type="button" data-action="close-panel" class="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
      </div>
      <div data-el="slot-list" class="space-y-2 mb-4"></div>
      <form data-el="add-form" class="grid sm:grid-cols-4 gap-2 items-end">
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('pastorAvailability.startTime')}</label>
          <input type="time" name="start_time" required class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('pastorAvailability.endTime')}</label>
          <input type="time" name="end_time" required class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label class="block text-xs font-medium text-slate-500 mb-1">${t('pastorAvailability.locationType')}</label>
          <select name="location_type" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="office">${t('pastorAvailability.office')}</option>
            <option value="online">${t('pastorAvailability.online')}</option>
          </select>
        </div>
        <button type="submit" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700">${t('pastorAvailability.addSlot')}</button>
      </form>
      <p data-el="panel-status" class="text-sm text-rose-600 mt-2"></p>
    `;

    dayPanel.querySelector('[data-action="close-panel"]').addEventListener('click', () => {
      dayPanel.classList.add('hidden');
      selectedDate = null;
      renderGrid();
    });

    const listEl = dayPanel.querySelector('[data-el="slot-list"]');
    if (slots.length === 0) {
      listEl.innerHTML = `<p class="text-sm text-slate-500">${t('pastorAvailability.noSlots')}</p>`;
    } else {
      slots.forEach((slot) => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm';
        row.innerHTML = `
          <span>${formatTime(slot.start_time)} – ${formatTime(slot.end_time)} · <span class="font-medium">${slot.location_type === 'online' ? t('pastorAvailability.online') : t('pastorAvailability.office')}</span></span>
          <button type="button" data-action="delete-slot" class="text-xs text-rose-600 hover:text-rose-800 font-medium">${t('moderation.delete')}</button>
        `;
        row.querySelector('[data-action="delete-slot"]').addEventListener('click', () => deleteSlot(slot.id));
        listEl.appendChild(row);
      });
    }

    const addForm = dayPanel.querySelector('[data-el="add-form"]');
    const panelStatusEl = dayPanel.querySelector('[data-el="panel-status"]');
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      panelStatusEl.textContent = '';
      const startTime = addForm.elements.start_time.value;
      const endTime = addForm.elements.end_time.value;
      const locationType = addForm.elements.location_type.value;
      if (endTime <= startTime) {
        panelStatusEl.textContent = t('pastorAvailability.endBeforeStart');
        return;
      }

      const { error } = await supabase.from('pastor_availability').insert({
        pastor_id: pastorId, date: selectedDate, start_time: startTime, end_time: endTime, location_type: locationType,
      });
      if (error) {
        panelStatusEl.textContent = t('pastorAvailability.saveFailed', { message: error.message });
        return;
      }
      addForm.reset();
      loadMonth();
    });
  }

  async function deleteSlot(id) {
    if (!(await confirmDialog({ message: t('pastorAvailability.confirmDelete') }))) return;
    const { error } = await supabase.from('pastor_availability').delete().eq('id', id);
    if (error) {
      window.alert(t('pastorAvailability.saveFailed', { message: error.message }));
      return;
    }
    loadMonth();
  }
}

function formatTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
