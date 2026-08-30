// Special-program pop-up (sql/065/066) — checked once per app load
// (app.js's showApp), independent of which department tab is active,
// since it needs to reach every member regardless of whether they
// ever visit Church Program. Shows the flyer if one's been uploaded,
// otherwise a "mark your calendar" placeholder — either way, it
// reappears on every app load until the program's nearest upcoming
// date passes (a multi-date program keeps popping up across all of
// its dates, not just the first one).
import { t } from '../i18n.js';
import { todayLocal } from '../utils/date.js';

const FLYER_BUCKET = 'church-program-flyers';

export async function checkSpecialProgramPopup(supabase) {
  const { data: specialPrograms } = await supabase
    .from('church_programs')
    .select('id, title, flyer_storage_path')
    .eq('is_special', true);

  if (!specialPrograms || specialPrograms.length === 0) return;

  const { data: nextDate } = await supabase
    .from('church_program_dates')
    .select('program_id, date')
    .in('program_id', specialPrograms.map((p) => p.id))
    .gte('date', todayLocal())
    .order('date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!nextDate) return;

  const program = specialPrograms.find((p) => p.id === nextDate.program_id);
  if (!program) return;

  let flyerUrl = null;
  if (program.flyer_storage_path) {
    const { data: signed } = await supabase.storage.from(FLYER_BUCKET).createSignedUrl(program.flyer_storage_path, 3600);
    flyerUrl = signed?.signedUrl || null;
  }

  showPopup({ title: program.title, date: nextDate.date }, flyerUrl);
}

function showPopup(program, flyerUrl) {
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
  root.querySelector('[data-action="close"]').addEventListener('click', () => root.remove());
  root.addEventListener('click', (e) => { if (e.target === root) root.remove(); });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;');
}
