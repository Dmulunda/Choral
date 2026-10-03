// Reusable confirmation modal — replaces window.confirm() across the
// app with a styled dialog matching everything else. Unlike the other
// createXModal({...}) => { open } components in this app, a confirm
// dialog is one-shot per call (no reason to keep an instance around),
// so this is a plain async function: build it, show it, resolve a
// Promise<boolean> on the user's choice, tear it down.
//
// Usage: if (!(await confirmDialog({ message: t('...') }))) return;
//
// Optional `reasonLabel`: adds a required text field (e.g. "why are
// you deleting this?") and changes the resolved value's shape --
// instead of a boolean, resolves the trimmed reason string on confirm
// or null on cancel/empty. Only callers that pass this option see the
// different contract; every existing boolean-style call site is
// unaffected.
import { t } from '../i18n.js';

export function confirmDialog({ title, message, confirmLabel, cancelLabel, danger = true, reasonLabel, reasonPlaceholder }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    root.innerHTML = `
      <div class="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
        <h2 class="text-lg font-bold mb-2">${escapeHtml(title || t('common.areYouSure'))}</h2>
        <p class="text-sm text-slate-600 mb-4 whitespace-pre-wrap">${escapeHtml(message)}</p>
        ${reasonLabel ? `
          <label class="block text-sm font-medium text-slate-600 mb-1">${escapeHtml(reasonLabel)}</label>
          <textarea data-el="reason" rows="2" placeholder="${escapeHtml(reasonPlaceholder || '')}"
                    class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2"></textarea>
        ` : ''}
        <div class="flex justify-end gap-2 ${reasonLabel ? 'mt-4' : ''}">
          <button type="button" data-action="cancel" class="px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">
            ${escapeHtml(cancelLabel || t('common.cancel'))}
          </button>
          <button type="button" data-action="confirm"
                  class="px-4 py-2 rounded-lg text-white font-medium ${danger ? 'bg-rose-600 hover:bg-rose-700' : 'bg-indigo-600 hover:bg-indigo-700'}">
            ${escapeHtml(confirmLabel || t('common.confirm'))}
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    const reasonEl = root.querySelector('[data-el="reason"]');

    function finish(result) {
      document.removeEventListener('keydown', onKeydown);
      document.body.removeChild(root);
      resolve(result);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') finish(reasonLabel ? null : false);
    }

    root.querySelector('[data-action="cancel"]').addEventListener('click', () => finish(reasonLabel ? null : false));
    root.querySelector('[data-action="confirm"]').addEventListener('click', () => {
      if (!reasonLabel) { finish(true); return; }
      const reason = reasonEl.value.trim();
      if (!reason) { reasonEl.focus(); return; }
      finish(reason);
    });
    root.addEventListener('click', (e) => { if (e.target === root) finish(reasonLabel ? null : false); });
    document.addEventListener('keydown', onKeydown);

    (reasonEl || root.querySelector('[data-action="confirm"]')).focus();
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
