// Night mode. The actual class toggle on first paint happens in an
// inline script in index.html's <head> (has to run before anything
// renders, before this module even loads, to avoid a flash of light
// mode) — this module is just the shared get/set used by the sidebar
// toggle in app.js.
const THEME_KEY = 'choir-hub-theme';

export function getTheme() {
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  document.documentElement.classList.toggle('dark', theme === 'dark');
}
