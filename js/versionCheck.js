// Detects when a newer deploy has landed on the server while this tab
// is still open. sw.js is deliberately network-only (no caching), so
// there's no stale service-worker cache to blame — the tab just keeps
// running whatever JS it already loaded until something tells it to
// reload. version.txt is a plain-text marker (a timestamp) that gets
// updated on every push to main; this polls it periodically and
// reloads — after a brief heads-up, not silently — the moment it
// changes from what this tab started with.
//
// Deliberately NOT also checked on visibilitychange (an earlier
// version re-checked the instant the tab regained focus) — switching
// away to another tab/app and back must never itself trigger a
// reload, even if a deploy happened while you were gone; the regular
// interval still catches it, just not timed to the exact moment you
// return mid-task.
import { t } from './i18n.js';
import { isProjectionPanelMounted } from './utils/projectionGuard.js';
import { hasUnsavedWork } from './utils/unsavedWorkGuard.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const VERSION_URL = 'version.txt';

let loadedVersion = null;
let reloading = false;

export async function initVersionCheck() {
  loadedVersion = await fetchVersion();
  if (loadedVersion === null) return; // couldn't determine a baseline — don't false-positive later

  setInterval(checkForUpdate, POLL_INTERVAL_MS);
}

async function fetchVersion() {
  try {
    const res = await fetch(`${VERSION_URL}?_=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch {
    return null;
  }
}

async function checkForUpdate() {
  if (reloading) return;
  // Never yank the Projection page, or any other open editor with
  // live/unsaved work (e.g. the Flyer editor), out from under whoever's
  // using it — a forced reload loses whatever's only in memory. Just
  // keep checking; the moment they leave, the next poll (at most
  // POLL_INTERVAL_MS later) picks the update back up.
  if (isProjectionPanelMounted() || hasUnsavedWork()) return;
  const current = await fetchVersion();
  if (current === null || current === loadedVersion) return;
  reloading = true;
  showUpdateToastThenReload();
}

function showUpdateToastThenReload() {
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[200] bg-slate-900 text-white text-sm px-4 py-2.5 rounded-lg shadow-lg';
  toast.textContent = t('app.updatingNotice');
  document.body.appendChild(toast);
  setTimeout(() => window.location.reload(), 2000);
}
