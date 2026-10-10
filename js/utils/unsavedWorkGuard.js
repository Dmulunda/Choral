// Generic registry of "something in this tab has live/unsaved work a
// forced reload would destroy" -- versionCheck.js checks this (next to
// its existing, Projection-specific isProjectionPanelMounted() check)
// before applying its auto-reload-on-new-deploy. Any editor that risks
// losing real work on an unannounced reload (e.g. flyerEditor.js) calls
// registerUnsavedWork(id) while mounted/editable and
// unregisterUnsavedWork(id) the moment it's torn down or saved+exited.
const activeGuards = new Set();

export function registerUnsavedWork(id) {
  activeGuards.add(id);
}

export function unregisterUnsavedWork(id) {
  activeGuards.delete(id);
}

export function hasUnsavedWork() {
  return activeGuards.size > 0;
}
