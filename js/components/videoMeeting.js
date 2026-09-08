// Voice/video meetings via Jitsi Meet's public server (meet.jit.si) —
// free, no account or API key needed. Opens in its own browser
// window/tab (not an in-app overlay), so the app stays open and usable
// in its own window while a call is in progress.
//
// Two-step API because every caller needs to asynchronously look up a
// display name first, and window.open() only bypasses popup blockers
// when called synchronously from the click handler itself — by the
// time an await resolves, that permission is gone. So: open a blank
// window immediately (openMeetingWindow, call this first, before any
// await), then point it at the real room once the display name is
// ready (navigateMeetingWindow).
import { t } from '../i18n.js';
export function openMeetingWindow() {
  // Deliberately no noopener/noreferrer: both make window.open() return
  // null in most browsers (that's the whole point of noopener — sever
  // the reference), which would break navigateMeetingWindow below,
  // which needs that reference to point the tab at the real room once
  // the async display-name lookup finishes. meet.jit.si is a trusted
  // destination, so the small tabnabbing exposure this leaves is
  // acceptable.
  return window.open('about:blank', '_blank');
}

export function navigateMeetingWindow(win, { roomName, displayName }) {
  if (!win) return; // popup blocked despite the synchronous open — rare, nothing more we can do
  const configParts = ['config.prejoinPageEnabled=false'];
  if (displayName) configParts.push(`userInfo.displayName=${encodeURIComponent(`"${displayName}"`)}`);
  win.location.href = `https://meet.jit.si/${encodeURIComponent(roomName)}#${configParts.join('&')}`;
}

// Shared "Start Meeting" (+ admin-only "set link") control for
// dashboard.js/deptDashboard.js — a department can be assigned a fixed
// external link (sql/088, e.g. a Zoom recurring meeting) instead of
// the auto-generated Jitsi room above; the button prefers that link
// when set, so departments without their own Zoom/Teams account keep
// working exactly as before. `getDisplayName` is only called in the
// Jitsi branch, so departments with a fixed link skip that fetch
// entirely — matches window.prompt's use elsewhere in this app
// (courseBuilder.js) as the lightweight single-field input pattern.
export function renderMeetingControls(container, { supabase, active, canAdminister, getDisplayName, onLinkChanged }) {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-2 mb-6';
  container.appendChild(row);

  const meetingBtn = document.createElement('button');
  meetingBtn.type = 'button';
  meetingBtn.className = 'px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700';
  meetingBtn.textContent = t('meeting.start');
  row.appendChild(meetingBtn);
  meetingBtn.addEventListener('click', async () => {
    if (active.meeting_link) {
      window.open(active.meeting_link, '_blank', 'noopener');
      return;
    }
    const win = openMeetingWindow();
    const displayName = await getDisplayName();
    navigateMeetingWindow(win, { roomName: `choir-app-dept-${active.id}`, displayName });
  });

  if (canAdminister) {
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-100';
    editBtn.textContent = active.meeting_link ? t('meeting.editLink') : t('meeting.setLink');
    row.appendChild(editBtn);
    editBtn.addEventListener('click', async () => {
      const next = window.prompt(t('meeting.linkPrompt'), active.meeting_link || '');
      if (next === null) return;
      const trimmed = next.trim();
      const { error } = await supabase.from('departments').update({ meeting_link: trimmed || null }).eq('id', active.id);
      if (error) {
        window.alert(t('meeting.linkSaveFailed', { message: error.message }));
        return;
      }
      active.meeting_link = trimmed || null;
      onLinkChanged?.();
    });
  }
}
