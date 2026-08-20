// One-shot modal for the "this person is the sole admin of one or more
// departments" case in the user-deletion flow (userManager.js). Lets a
// Super Admin pick a replacement admin per department (or leave it
// admin-less, if no other approved member exists) before the deletion
// proceeds. Mirrors confirmDialog.js's plain-async-function shape,
// since — like a confirmation — it's built fresh for each delete
// attempt rather than kept around across renders.
//
// Usage: const result = await reassignAdminDialog({ targetName, departments });
// departments: [{ id, name, candidates: [{ id, full_name }] }]
// result is null if cancelled, or { reassignments: [{ departmentId, newUserId }] }.
import { t } from '../i18n.js';

export function reassignAdminDialog({ targetName, departments }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    root.innerHTML = `
      <div class="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 class="text-lg font-bold mb-2">${escapeHtml(t('users.reassignTitle'))}</h2>
        <p class="text-sm text-slate-600 mb-4">${escapeHtml(t('users.reassignIntro', { name: targetName }))}</p>
        <div data-el="list" class="space-y-3 mb-6"></div>
        <div class="flex justify-end gap-2">
          <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            ${escapeHtml(t('common.cancel'))}
          </button>
          <button type="button" data-action="confirm" class="px-4 py-2 rounded-lg text-white font-medium bg-rose-600 hover:bg-rose-700">
            ${escapeHtml(t('users.removeFromChurch'))}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const listEl = root.querySelector('[data-el="list"]');
    departments.forEach((dept) => {
      const row = document.createElement('div');
      if (dept.candidates.length === 0) {
        row.innerHTML = `
          <label class="block text-sm font-medium text-slate-700 mb-1">${escapeHtml(dept.name)}</label>
          <p class="text-xs text-amber-600">${escapeHtml(t('users.reassignNoCandidates'))}</p>
        `;
      } else {
        row.innerHTML = `
          <label class="block text-sm font-medium text-slate-700 mb-1">${escapeHtml(dept.name)}</label>
          <select data-dept-id="${dept.id}" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">${escapeHtml(t('users.reassignLeaveEmpty'))}</option>
            ${dept.candidates.map((c) => `<option value="${c.id}">${escapeHtml(c.full_name)}</option>`).join('')}
          </select>
        `;
      }
      listEl.appendChild(row);
    });

    function finish(result) {
      document.removeEventListener('keydown', onKeydown);
      document.body.removeChild(root);
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') finish(null);
    }

    root.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(null));
    root.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      const reassignments = Array.from(listEl.querySelectorAll('select[data-dept-id]'))
        .filter((sel) => sel.value)
        .map((sel) => ({ departmentId: sel.dataset.deptId, newUserId: sel.value }));
      finish({ reassignments });
    });
    root.addEventListener('click', (e) => { if (e.target === root) finish(null); });
    document.addEventListener('keydown', onKeydown);

    root.querySelector('[data-action="confirm"]').focus();
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
