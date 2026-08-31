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
export function openMeetingWindow() {
  return window.open('about:blank', '_blank', 'noopener,noreferrer');
}

export function navigateMeetingWindow(win, { roomName, displayName }) {
  if (!win) return; // popup blocked despite the synchronous open — rare, nothing more we can do
  const configParts = ['config.prejoinPageEnabled=false'];
  if (displayName) configParts.push(`userInfo.displayName=${encodeURIComponent(`"${displayName}"`)}`);
  win.location.href = `https://meet.jit.si/${encodeURIComponent(roomName)}#${configParts.join('&')}`;
}
