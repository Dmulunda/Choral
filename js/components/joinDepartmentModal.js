// Self-service "Join a Department" — for a member who forgot to
// request a department at registration (or wants to add another one
// later). Lists every department they don't already have a membership
// row for (pending or approved) and lets them request one; it lands as
// a normal pending row via the same self-service insert policy that
// already exists (sql/015/021), so it shows up in that department's
// usual approval queue — no schema changes needed.
import { t, departmentLabel } from '../i18n.js';

export function createJoinDepartmentModal({ supabase, currentUserId }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('joinDepartment.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('joinDepartment.intro')}</p>
      <div data-el="body"></div>
    </div>
  `;
  document.body.appendChild(root);

  const bodyEl = root.querySelector('[data-el="body"]');
  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });

  async function load() {
    bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('common.loading')}</p>`;

    const [{ data: departments, error: deptError }, { data: mine, error: mineError }] = await Promise.all([
      supabase.from('departments').select('id, key, name').order('name'),
      supabase.from('department_memberships').select('department_id').eq('user_id', currentUserId),
    ]);

    if (deptError || mineError) {
      bodyEl.innerHTML = `<p class="text-sm text-rose-600">${t('joinDepartment.loadFailed', { message: (deptError || mineError).message })}</p>`;
      return;
    }

    const mineIds = new Set((mine || []).map((m) => m.department_id));
    const available = (departments || []).filter((d) => !mineIds.has(d.id));

    if (available.length === 0) {
      bodyEl.innerHTML = `<p class="text-sm text-slate-500">${t('joinDepartment.none')}</p>`;
      return;
    }

    bodyEl.innerHTML = `
      <div class="space-y-2">
        <select data-el="dept-select" class="w-full border border-slate-300 rounded-lg px-3 py-2">
          ${available.map((d) => `<option value="${d.id}">${escapeHtml(departmentLabel(d.key))}</option>`).join('')}
        </select>
        <p data-el="status" class="text-sm"></p>
        <div class="flex justify-end gap-2 pt-2">
          <button type="button" data-action="close" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">${t('common.cancel')}</button>
          <button type="button" data-action="request" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
            ${t('joinDepartment.request')}
          </button>
        </div>
      </div>
    `;

    bodyEl.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
    const requestBtn = bodyEl.querySelector('[data-action="request"]');
    requestBtn.addEventListener('click', async () => {
      const departmentId = bodyEl.querySelector('[data-el="dept-select"]').value;
      const statusEl = bodyEl.querySelector('[data-el="status"]');
      if (!departmentId) return;

      requestBtn.disabled = true;
      statusEl.className = 'text-sm text-slate-500';
      statusEl.textContent = t('common.saving');

      const { error } = await supabase
        .from('department_memberships')
        .insert({ user_id: currentUserId, department_id: departmentId, role: 'member', status: 'pending' });

      requestBtn.disabled = false;
      if (error) {
        statusEl.className = 'text-sm text-rose-600';
        statusEl.textContent = t('joinDepartment.requestFailed', { message: error.message });
        return;
      }

      statusEl.className = 'text-sm text-emerald-600';
      statusEl.textContent = t('joinDepartment.requested');
      load();
    });
  }

  function open() {
    root.classList.remove('hidden');
    root.classList.add('flex');
    load();
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  return { open };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
