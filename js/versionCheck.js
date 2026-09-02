// Detects when a newer deploy has landed on the server while this tab
// is still open. sw.js is deliberately network-only (no caching), so
// there's no stale service-worker cache to blame — the tab just keeps
// running whatever JS it already loaded until something tells it to
// reload. version.txt is a plain-text marker (a timestamp) that gets
// updated on every push to main; this polls it periodically and
// whenever the tab regains focus, and reloads — after a brief
// heads-up, not silently — the moment it changes from what this tab
// started with.
import { t } from './i18n.js';
import { isProjectionPanelMounted } from './utils/projectionGuard.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const VERSION_URL = 'version.txt';

let loadedVersion = null;
let reloading = false;

export async function initVersionCheck() {
  loadedVersion = await fetchVersion();
  if (loadedVersion === null) return; // couldn't determine a baseline — don't false-positive later

  setInterval(checkForUpdate, POLL_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });
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
  // Never yank the Projection page out from under whoever's running
  // it — setup and staged content live only in that tab's memory, and
  // a forced reload loses all of it. Just keep checking; the moment
  // they leave, the next poll (at most POLL_INTERVAL_MS later, or
  // immediately on next tab focus) picks the update back up.
  if (isProjectionPanelMounted()) return;
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
