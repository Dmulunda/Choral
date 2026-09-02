// Confirmation gate for leaving the Projection panel while something
// is live — a stray department switch mid-service shouldn't silently
// pull the operator away from the controls. deptDashboard.js registers
// a checker whenever the panel is mounted (media_tech active) and
// clears it otherwise; app.js's department switcher calls
// confirmLeaveIfProjecting() before actually switching.
import { confirmDialog } from '../components/confirmDialog.js';
import { t } from '../i18n.js';

let liveChecker = null;

export function registerProjectionLiveChecker(fn) {
  liveChecker = fn;
}

export function clearProjectionLiveChecker() {
  liveChecker = null;
}

// Whether the Projection panel is currently mounted at all (not just
// whether something's live) — versionCheck.js uses this to hold off
// its auto-reload-on-new-deploy for as long as the operator has this
// page open, live content or not. A forced reload mid-setup would wipe
// out whatever they were staging just as badly as one mid-live-service.
export function isProjectionPanelMounted() {
  return liveChecker !== null;
}

export async function confirmLeaveIfProjecting() {
  if (!liveChecker || !liveChecker()) return true;
  return confirmDialog({
    message: t('projection.confirmLeave'),
    confirmLabel: t('projection.leaveAnyway'),
    cancelLabel: t('projection.stayHere'),
  });
}
