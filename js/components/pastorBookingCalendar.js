// Shared booking calendar -- used both by the authenticated "Book a
// Meeting" tab and the public booking.html page for guests. Both call
// the exact same pair of RPCs (get_public_pastor_slots/
// submit_pastor_meeting_booking); a logged-in call naturally carries
// auth.uid(), a guest call doesn't, and the RPC branches accordingly --
// so there's no separate "member" vs "guest" booking logic here, only
// currentUserProfile deciding whether to show the name/email/phone
// fields. Manual vs random assignment mode is inferred purely from
// whether get_public_pastor_slots() returned a pastor_name for a row
// (populated in manual mode, null in random) -- no separate settings
// fetch needed.
import { formatDateLocal, todayLocal } from '../utils/date.js';
import { t, tn, monthName } from '../i18n.js';
import { openMeetingWindow, navigateMeetingWindow } from './videoMeeting.js';

export function renderPastorBookingCalendar(container, { supabase, currentUserProfile, onBooked }) {
  let viewDate = new Date();
  viewDate.setDate(1);
  let slotsByDate = new Map();
  let selectedDate = null;

  container.innerHTML = `
    <div data-el="calendar-view">
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
    </div>
    <div data-el="confirmation" class="hidden bg-white rounded-xl shadow p-6"></div>
  `;

  const calendarView = container.querySelector('[data-el="calendar-view"]');
  const confirmationView = container.querySelector('[data-el="confirmation"]');
  const monthLabel = container.querySelector('[data-el="month-label"]');
  const grid = container.querySelector('[data-el="grid"]');
  const dayPanel = container.querySelector('[data-el="day-panel"]');

  container.querySelector('[data-action="prev-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() - 1); loadSlots(); });
  container.querySelector('[data-action="next-month"]').addEventListener('click', () => { viewDate.setMonth(viewDate.getMonth() + 1); loadSlots(); });

  loadSlots();

  async function loadSlots() {
    monthLabel.textContent = `${monthName(viewDate.getMonth())} ${viewDate.getFullYear()}`;

    const { data, error } = await supabase.rpc('get_public_pastor_slots');
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
      const slots = slotsByDate.get(dateStr) || [];
      const bookable = !isPast && slots.length > 0;

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.disabled = !bookable;
      cell.className = `border rounded-lg p-1.5 min-h-[3.25rem] text-left transition-colors ${
        !bookable ? 'border-slate-100 text-slate-300 cursor-not-allowed'
        : selectedDate === dateStr ? 'border-indigo-400 bg-indigo-50'
        : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
      }`;
      cell.innerHTML = `
        <div class="text-xs font-semibold ${bookable ? 'text-slate-600' : 'text-slate-300'}">${day}</div>
        ${bookable ? `<div class="text-[11px] text-emerald-700 font-medium mt-0.5">${tn('pastorBooking.slotCount', slots.length)}</div>` : ''}
      `;
      if (bookable) cell.addEventListener('click', () => { selectedDate = dateStr; renderDayPanel(); });
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
      <div data-el="slot-list" class="space-y-2"></div>
      <div data-el="book-form-wrap" class="hidden mt-4 pt-4 border-t border-slate-200"></div>
    `;

    dayPanel.querySelector('[data-action="close-panel"]').addEventListener('click', () => {
      dayPanel.classList.add('hidden');
      selectedDate = null;
      renderGrid();
    });

    const listEl = dayPanel.querySelector('[data-el="slot-list"]');
    slots.forEach((slot) => {
      const row = document.createElement('div');
      row.className = 'flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm';
      row.innerHTML = `
        <span>
          ${formatTime(slot.start_time)} – ${formatTime(slot.end_time)}
          <span class="ml-2 px-1.5 py-0.5 rounded text-[11px] font-medium ${slot.location_type === 'online' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}">${slot.location_type === 'online' ? t('pastorBooking.online') : t('pastorBooking.office')}</span>
          ${slot.pastor_name ? `<span class="text-slate-500 ml-2">${t('pastorBooking.withPastor', { name: escapeHtml(slot.pastor_name) })}</span>` : ''}
        </span>
        <button type="button" data-action="select-slot" class="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-700">${t('pastorBooking.book')}</button>
      `;
      row.querySelector('[data-action="select-slot"]').addEventListener('click', () => renderBookForm(slot));
      listEl.appendChild(row);
    });
  }

  function renderBookForm(slot) {
    const wrap = dayPanel.querySelector('[data-el="book-form-wrap"]');
    wrap.classList.remove('hidden');
    const isGuest = !currentUserProfile;

    wrap.innerHTML = `
      <h4 class="font-medium text-slate-800 mb-2">${t('pastorBooking.confirmTitle')}</h4>
      <p class="text-sm text-slate-600 mb-3">
        ${escapeHtml(selectedDate)} · ${formatTime(slot.start_time)} – ${formatTime(slot.end_time)}
        ${slot.pastor_name ? ` · ${escapeHtml(slot.pastor_name)}` : ''}
      </p>
      <form data-el="book-form" class="space-y-3">
        ${isGuest ? `
          <div class="grid sm:grid-cols-3 gap-2">
            <input type="text" name="guest_name" required placeholder="${t('pastorBooking.yourName')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <input type="email" name="guest_email" required placeholder="${t('pastorBooking.yourEmail')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <input type="tel" name="guest_phone" required placeholder="${t('pastorBooking.yourPhone')}" class="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        ` : ''}
        <textarea name="note" rows="2" placeholder="${t('pastorBooking.notePlaceholder')}" class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"></textarea>
        <div class="flex items-center gap-3">
          <button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">${t('pastorBooking.confirmBooking')}</button>
          <span data-el="book-status" class="text-sm text-rose-600"></span>
        </div>
      </form>
    `;

    const form = wrap.querySelector('[data-el="book-form"]');
    const statusEl = wrap.querySelector('[data-el="book-status"]');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');

      const { data, error } = await supabase.rpc('submit_pastor_meeting_booking', {
        p_date: selectedDate,
        p_start_time: slot.start_time,
        p_end_time: slot.end_time,
        p_location_type: slot.location_type,
        p_pastor_id: slot.pastor_id || null,
        p_note: form.elements.note.value.trim() || null,
        p_guest_name: isGuest ? form.elements.guest_name.value.trim() : null,
        p_guest_email: isGuest ? form.elements.guest_email.value.trim() : null,
        p_guest_phone: isGuest ? form.elements.guest_phone.value.trim() : null,
      });

      submitBtn.disabled = false;
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('pastorBooking.bookingFailed', { message: error.message });
        loadSlots();
        return;
      }

      const booking = data?.[0];
      showConfirmation(slot, booking);
      onBooked?.();
    });
  }

  function showConfirmation(slot, booking) {
    calendarView.classList.add('hidden');
    confirmationView.classList.remove('hidden');
    confirmationView.innerHTML = `
      <div class="text-emerald-600 text-lg font-semibold mb-2">${t('pastorBooking.bookedTitle')}</div>
      <p class="text-slate-700 mb-4">
        ${escapeHtml(selectedDate)} · ${formatTime(slot.start_time)} – ${formatTime(slot.end_time)}
        ${booking?.pastor_name ? ` · ${escapeHtml(booking.pastor_name)}` : ''}
      </p>
      ${booking?.meeting_room ? `<button type="button" data-action="join-now" class="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700">${t('meeting.join')}</button>` : `<p class="text-sm text-slate-500">${t('pastorBooking.officeReminder')}</p>`}
      <div class="mt-4">
        <button type="button" data-action="book-another" class="text-sm text-indigo-600 hover:text-indigo-800 font-medium">${t('pastorBooking.bookAnother')}</button>
      </div>
    `;

    if (booking?.meeting_room) {
      confirmationView.querySelector('[data-action="join-now"]').addEventListener('click', () => {
        const win = openMeetingWindow();
        navigateMeetingWindow(win, { roomName: booking.meeting_room, displayName: currentUserProfile?.full_name || '' });
      });
    }
    confirmationView.querySelector('[data-action="book-another"]').addEventListener('click', () => {
      confirmationView.classList.add('hidden');
      calendarView.classList.remove('hidden');
      selectedDate = null;
      dayPanel.classList.add('hidden');
      loadSlots();
    });
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
