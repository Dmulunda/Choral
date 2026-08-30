// Small persistent "today's date" header shown at the top of every
// dashboard-style page (Choir Dashboard, every department's Dashboard,
// Super Admin Home). Re-renders on language change since the date
// format itself is locale-dependent.
import { getLang, onLangChange } from '../i18n.js';

const LOCALE_BY_LANG = { en: 'en-US', fr: 'fr-FR' };

export function renderDateHeader(container) {
  function render() {
    if (!container.isConnected) return;
    const locale = LOCALE_BY_LANG[getLang()] || 'en-US';
    const formatted = new Date().toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    container.innerHTML = `<p class="text-sm text-slate-500 mb-4">${escapeHtml(formatted)}</p>`;
  }
  render();
  onLangChange(render);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
