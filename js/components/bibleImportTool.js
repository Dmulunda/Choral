// Super-Admin-only, one-time "Import Bible Data" tool (sql/074) —
// populates bible_verses with the World English Bible (English) and
// Louis Segond 1910 (French), both public domain, from
// api.getbible.net, via the import-bible edge function. Runs in book
// chunks per call so no single request has to move the whole
// ~31,000-verse Bible at once, and so progress is visible — this is a
// slow, one-time action, not something an admin needs to repeat.
//
// Chunk size was originally 10 books, which silently produced
// incomplete imports: books vary enormously in size (Obadiah is 21
// verses; Psalms alone is ~2,461), so a fixed book-count chunk can
// still be verse-heavy depending on which books land in it — chunk
// 11-20 pulled in Job AND Psalms together (~3,500 verses on top of six
// other books), likely running past the edge function's execution
// limit mid-upsert and leaving some of Psalms' chapters missing
// without ever surfacing as a visible error. Shrunk to 3 books per
// chunk so no single call is anywhere near that heavy, regardless of
// which specific books happen to group together.
import { t } from '../i18n.js';

const TRANSLATIONS = [
  { value: 'web', label: 'World English Bible (English)' },
  { value: 'lsg', label: 'Louis Segond 1910 (Français)' },
];
const CHUNK_SIZE = 3;
const LAST_BOOK = 66;

// Expected verse count per book_number (1..66), standard versification
// shared by WEB and LSG alike (both number chapters/verses the same
// way every modern Protestant-canon translation does) -- the classic
// 31,102-verse-KJV reference point. Used only to flag a book that's
// obviously short (a prior import silently cut off mid-chapter, see
// this file's header comment) -- not meant to validate exact verse
// boundaries translation-by-translation.
const EXPECTED_VERSE_COUNTS = [
  1533, 1213, 859, 1288, 959, 658, 618, 85, 810, 695,
  816, 719, 942, 822, 280, 406, 167, 1070, 2461, 915,
  222, 117, 1292, 1364, 154, 1273, 357, 197, 73, 146,
  21, 48, 105, 47, 56, 53, 38, 211, 55, 1071,
  678, 1151, 879, 1007, 433, 437, 257, 149, 155, 104,
  95, 89, 47, 113, 83, 46, 25, 303, 108, 105,
  61, 105, 13, 14, 25, 404,
];

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
      <div class="flex items-center gap-2">
        <button type="button" data-action="start" class="px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50">
          ${t('bibleImport.start')}
        </button>
        <button type="button" data-action="check-completeness" class="px-4 py-2 rounded-lg bg-slate-100 text-slate-700 font-medium hover:bg-slate-200 disabled:opacity-50">
          ${t('bibleImport.checkCompleteness')}
        </button>
      </div>
      <div data-el="progress" class="mt-4 text-sm text-slate-600 space-y-1"></div>
      <div data-el="completeness" class="mt-4 text-sm space-y-3"></div>
    </div>
  `;
  document.body.appendChild(root);

  const startBtn = root.querySelector('[data-action="start"]');
  const checkBtn = root.querySelector('[data-action="check-completeness"]');
  const progressEl = root.querySelector('[data-el="progress"]');
  const completenessEl = root.querySelector('[data-el="completeness"]');

  root.querySelectorAll('[data-action="close"]').forEach((btn) => btn.addEventListener('click', close));
  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  startBtn.addEventListener('click', runImport);
  checkBtn.addEventListener('click', checkCompleteness);

  function open() {
    progressEl.innerHTML = '';
    completenessEl.innerHTML = '';
    startBtn.disabled = false;
    checkBtn.disabled = false;
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

  // PostgREST caps a single request at 1000 rows by default -- fetching
  // all ~31,000 book_number values for one translation without paging
  // would silently truncate and make every later book look "missing".
  async function fetchBookVerseCounts(translation) {
    const counts = new Array(LAST_BOOK + 1).fill(0);
    const pageSize = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from('bible_verses')
        .select('book_number')
        .eq('translation', translation)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      (data || []).forEach((row) => { counts[row.book_number] = (counts[row.book_number] || 0) + 1; });
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    return counts;
  }

  async function checkCompleteness() {
    checkBtn.disabled = true;
    completenessEl.innerHTML = `<p class="text-slate-500">${t('bibleImport.checking')}</p>`;

    const { data: books } = await supabase.from('bible_books').select('number, name_en, name_fr').order('number');
    const bookByNumber = new Map((books || []).map((b) => [b.number, b]));

    const sections = [];
    for (const translation of TRANSLATIONS) {
      const counts = await fetchBookVerseCounts(translation.value);
      const shortBooks = [];
      for (let bookNumber = 1; bookNumber <= LAST_BOOK; bookNumber += 1) {
        const actual = counts[bookNumber] || 0;
        const expected = EXPECTED_VERSE_COUNTS[bookNumber - 1];
        if (actual < expected) shortBooks.push({ bookNumber, actual, expected });
      }
      sections.push({ translation, shortBooks });
    }

    completenessEl.innerHTML = sections.map(({ translation, shortBooks }) => `
      <div>
        <p class="font-medium text-slate-700 mb-1">${escapeHtml(translation.label)}</p>
        ${shortBooks.length === 0
          ? `<p class="text-emerald-600">${t('bibleImport.complete')}</p>`
          : `<ul class="space-y-1">
              ${shortBooks.map(({ bookNumber, actual, expected }) => {
                const book = bookByNumber.get(bookNumber);
                const name = translation.value === 'lsg' ? (book?.name_fr || `#${bookNumber}`) : (book?.name_en || `#${bookNumber}`);
                return `
                  <li class="flex items-center justify-between gap-2 text-amber-700">
                    <span>${escapeHtml(t('bibleImport.bookShort', { name, actual, expected }))}</span>
                    <button type="button" data-reimport-translation="${translation.value}" data-reimport-book="${bookNumber}" class="shrink-0 px-2 py-0.5 rounded bg-amber-100 hover:bg-amber-200 text-xs font-medium">
                      ${t('bibleImport.reimportBook')}
                    </button>
                  </li>
                `;
              }).join('')}
            </ul>`}
      </div>
    `).join('');

    completenessEl.querySelectorAll('[data-reimport-book]').forEach((btn) => {
      btn.addEventListener('click', () => reimportBook(btn.dataset.reimportTranslation, Number(btn.dataset.reimportBook)));
    });

    checkBtn.disabled = false;
  }

  // Re-running the import for just one book is safe either way -- the
  // edge function upserts, it never duplicates or appends.
  async function reimportBook(translationValue, bookNumber) {
    checkBtn.disabled = true;
    logLine(t('bibleImport.reimportingBook', { n: bookNumber }));
    const { data, error } = await supabase.functions.invoke('import-bible', {
      body: { translation: translationValue, from_book: bookNumber, to_book: bookNumber },
    });
    if (error || data?.error) {
      logLine(t('bibleImport.chunkFailed', { from: bookNumber, to: bookNumber, message: data?.error || error.message }), true);
    } else {
      logLine(t('bibleImport.chunkDone', { from: bookNumber, to: bookNumber, count: data.imported }));
    }
    checkBtn.disabled = false;
    checkCompleteness();
  }

  return { open, root };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
