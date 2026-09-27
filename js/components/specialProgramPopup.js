// Special-program pop-up (sql/065/066) — checked once per app load
// (app.js's showApp), independent of which department tab is active,
// since it needs to reach every member regardless of whether they
// ever visit Church Program. Shows the flyer if one's been uploaded,
// otherwise a "mark your calendar" placeholder. Every special program
// with an upcoming date gets its own pop-up, shown one after another
// (soonest date first) -- not just the single nearest one -- each
// advancing to the next only once the current one is dismissed. A
// multi-date program still only queues once, using its own nearest
// upcoming date, not once per date. Throttled to once per calendar day
// per browser (see POPUP_SEEN_KEY below): once the queue has been
// shown today, it won't start again until tomorrow, even across
// multiple app loads/reloads today. It still reappears day after day
// until a program's nearest date passes.
import { t } from '../i18n.js';
import { todayLocal } from '../utils/date.js';

const FLYER_BUCKET = 'church-program-flyers';

// Same "once per calendar day" pattern as app.js's trial banner
// dismissal (TRIAL_BANNER_DISMISS_KEY) — compares toDateString(), not a
// rolling 24h window, so it resets at local midnight rather than
// exactly 24 hours after the last popup.
const POPUP_SEEN_KEY = 'choir-hub-special-program-popup-seen-on';

// app.js's showApp() actually runs TWICE on a normal page load
// (supabase-js fires both getSession().then() and the initial
// onAuthStateChange callback, and both call showApp() -- see its own
// comment on hasHandledInitialAuthEvent), so this gets called twice in
// quick succession. The localStorage write below only lands after an
// async fetch, so both calls would read the pre-write "not seen yet"
// state and both start their own queue -- a synchronous, same-page-load
// guard is needed in addition to the day-based one, set BEFORE any
// await so there's no window for the second near-simultaneous call to
// slip through.
let checkedThisPageLoad = false;

export async function checkSpecialProgramPopup(supabase) {
  if (checkedThisPageLoad) return;
  const today = new Date().toDateString();
  if (localStorage.getItem(POPUP_SEEN_KEY) === today) return;
  checkedThisPageLoad = true;

  const { data: specialPrograms } = await supabase
    .from('church_programs')
    .select('id, title, flyer_storage_path')
    .eq('is_special', true);

  if (!specialPrograms || specialPrograms.length === 0) return;

  const { data: dates } = await supabase
    .from('church_program_dates')
    .select('program_id, date')
    .in('program_id', specialPrograms.map((p) => p.id))
    .gte('date', todayLocal())
    .order('date', { ascending: true });

  if (!dates || dates.length === 0) return;

  const queuedProgramIds = new Set();
  const queue = [];
  for (const row of dates) {
    if (queuedProgramIds.has(row.program_id)) continue;
    const program = specialPrograms.find((p) => p.id === row.program_id);
    if (!program) continue;
    queuedProgramIds.add(row.program_id);
    queue.push({ program, date: row.date });
  }

  if (queue.length === 0) return;

  localStorage.setItem(POPUP_SEEN_KEY, today);
  showNextInQueue(supabase, queue);
}

async function showNextInQueue(supabase, queue) {
  const next = queue.shift();
  if (!next) return;

  let flyerUrl = null;
  if (next.program.flyer_storage_path) {
    const { data: signed } = await supabase.storage.from(FLYER_BUCKET).createSignedUrl(next.program.flyer_storage_path, 3600);
    flyerUrl = signed?.signedUrl || null;
  }

  showPopup({ title: next.program.title, date: next.date }, flyerUrl, () => showNextInQueue(supabase, queue));
}

function showPopup(program, flyerUrl, onClose) {
  const root = document.createElement('div');
  root.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4';
  root.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
      ${flyerUrl
        ? `<img src="${flyerUrl}" alt="${escapeAttr(program.title)}" class="w-full max-h-[60vh] object-contain bg-slate-100" />`
        : `<div class="p-8 text-center bg-indigo-50">
            <p class="text-lg font-semibold text-indigo-800">${t('churchProgram.comingUp')}</p>
          </div>`
      }
      <div class="p-4 sm:p-6">
        <div class="text-lg font-bold text-slate-800">${escapeHtml(program.title)}</div>
        <div class="text-sm text-slate-500 mt-1">${escapeHtml(program.date)}</div>
        ${!flyerUrl ? `<p class="text-sm text-slate-500 mt-2">${t('churchProgram.markCalendar')}</p>` : ''}
        <button type="button" data-action="close"
                class="mt-4 w-full py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">
          ${t('churchProgram.gotIt')}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  const advance = () => { root.remove(); onClose?.(); };
  root.querySelector('[data-action="close"]').addEventListener('click', advance);
  root.addEventListener('click', (e) => { if (e.target === root) advance(); });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
