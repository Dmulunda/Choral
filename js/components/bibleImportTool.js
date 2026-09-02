// Super-Admin-only, one-time "Import Bible Data" tool (sql/074) —
// populates bible_verses with the World English Bible (English) and
// Louis Segond 1910 (French), both public domain, from
// api.getbible.net, via the import-bible edge function. Runs in
// 10-book chunks per call (7 chunks per translation) so no single
// request has to move the whole ~31,000-verse Bible at once, and so
// progress is visible — this is a slow, one-time action, not
// something an admin needs to repeat.
import { t } from '../i18n.js';

const TRANSLATIONS = [
  { value: 'web', label: 'World English Bible (English)' },
  { value: 'lsg', label: 'Louis Segond 1910 (Français)' },
];
const CHUNK_SIZE = 10;
const LAST_BOOK = 66;

export function createBibleImportModal({ supabase }) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/50 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6">
      <div class="flex items-center justify-between mb-2">
        <h2 class="text-xl font-bold">${t('bibleImport.title')}</h2>
        <button type="button" data-action="close" class="text-slate-400 hover:text-slate-600 text-2xl leading-none">&times;</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">${t('bibleImport.intro')}</p>
      <button type="button" data-action="start" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
        ${t('bibleImport.start')}
      </button>
      <div data-el="progress" class="mt-4 text-sm text-slate-600 space-y-1"></div>
    </div>
  `;
  document.body.appendChild(root);

  const startBtn = root.querySelector('[data-action="start"]');
  const progressEl = root.querySelector('[data-el="progress"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  startBtn.addEventListener('click', runImport);

  function open() {
    progressEl.innerHTML = '';
    startBtn.disabled = false;
    root.classList.remove('hidden');
    root.classList.add('flex');
  }

  function close() {
    root.classList.add('hidden');
    root.classList.remove('flex');
  }

  function logLine(text, isError) {
    const line = document.createElement('div');
    line.className = isError ? 'text-rose-600' : 'text-slate-600';
    line.textContent = text;
    progressEl.appendChild(line);
    progressEl.scrollTop = progressEl.scrollHeight;
  }

  async function runImport() {
    startBtn.disabled = true;
    progressEl.innerHTML = '';

    for (const translation of TRANSLATIONS) {
      logLine(t('bibleImport.startingTranslation', { name: translation.label }));
      let totalImported = 0;

      for (let fromBook = 1; fromBook <= LAST_BOOK; fromBook += CHUNK_SIZE) {
        const toBook = Math.min(fromBook + CHUNK_SIZE - 1, LAST_BOOK);
        const { data, error } = await supabase.functions.invoke('import-bible', {
          body: { translation: translation.value, from_book: fromBook, to_book: toBook },
        });

        if (error || data?.error) {
          logLine(t('bibleImport.chunkFailed', { from: fromBook, to: toBook, message: data?.error || error.message }), true);
          startBtn.disabled = false;
          return;
        }

        totalImported += data.imported;
        logLine(t('bibleImport.chunkDone', { from: fromBook, to: toBook, count: data.imported }));
      }

      logLine(t('bibleImport.translationDone', { name: translation.label, count: totalImported }));
    }

    logLine(t('bibleImport.allDone'));
    startBtn.disabled = false;
  }

  return { open, root };
}
