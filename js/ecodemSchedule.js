// Ecodem (Children's Ministry) tab entry point: pending approvals
// (admins only) + the age-group session board.
import { supabase } from './supabaseClient.js';
import { getActiveDepartment } from './departments.js';
import { renderDepartmentApprovals } from './components/departmentApprovals.js';
import { renderEcodemBoard } from './components/ecodemBoard.js';
import { t } from './i18n.js';

export async function renderEcodemTab() {
  const container = document.querySelector('#ecodem-content');
  const active = getActiveDepartment();
  if (!active) return;

  container.innerHTML = `<p class="text-slate-500">${t('common.loading')}</p>`;

  const { data: { user } } = await supabase.auth.getUser();
  const canAdminister = active.role === 'admin' || active.role === 'super_admin';

  container.innerHTML = '';

  if (canAdminister) {
    const approvalsCard = document.createElement('div');
    approvalsCard.className = 'bg-white rounded-xl shadow p-4 sm:p-6 mb-6';
    approvalsCard.innerHTML = `<h2 class="text-lg font-semibold mb-4">${t('approvals.title')}</h2><div data-el="list"></div>`;
    container.appendChild(approvalsCard);
    renderDepartmentApprovals(approvalsCard.querySelector('[data-el="list"]'), {
      supabase,
      departmentId: active.id,
      adminUserId: user.id,
    });
  }

  const boardEl = document.createElement('div');
  container.appendChild(boardEl);
  renderEcodemBoard(boardEl, { supabase, departmentId: active.id, canAdminister });
}
