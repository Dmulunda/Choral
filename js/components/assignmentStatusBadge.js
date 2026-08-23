// Shared "who's confirmed, who's declined, who hasn't responded yet"
// badge — same look across every board that gained accept/decline via
// sql/049 (Preaching, Media & Tech, Ecodem, shift boards), mirroring
// how Choir's admin Service Requests list already shows each singer's
// response.
import { t } from '../i18n.js';
import { departmentLabel } from '../i18n.js';

const STATUS_CLASSES = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-50 text-emerald-700',
  declined: 'bg-rose-50 text-rose-700',
};

export function renderAssigneeBadge({ name, status, reason, workingDepartmentKey }) {
  const statusLabel = t(`requests.status${status.charAt(0).toUpperCase()}${status.slice(1)}`);
  const detail = status === 'declined'
    ? (workingDepartmentKey
        ? ` — ${t('requests.workingIn', { department: departmentLabel(workingDepartmentKey) })}`
        : (reason ? ` — ${escapeHtml(reason)}` : ''))
    : '';
  return `
    <span class="inline-flex items-center px-2 py-1 rounded-lg text-sm ${STATUS_CLASSES[status] || STATUS_CLASSES.pending}">
      ${escapeHtml(name)} <span class="ml-1 text-xs opacity-80">(${statusLabel}${detail})</span>
    </span>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
