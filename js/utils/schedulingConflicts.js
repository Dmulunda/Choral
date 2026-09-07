// Pre-assignment conflict/absence check, shared by every scheduling
// board (Choir's auto-planner, Preaching, Media & Tech, Ecodem, and the
// generic department shift board) — called right before an assignment
// is actually saved. Backed by the get_user_schedule_conflicts() RPC
// (sql/082), which mirrors report_absence()'s (sql/046) five-table scan
// but runs forward (before saving) instead of after the fact, and never
// exposes an absence's reason — only that one was reported.
import { t } from '../i18n.js';
import { confirmDialog } from '../components/confirmDialog.js';

function conflictLines(conflicts, date) {
  return conflicts.map((c) => (
    c.department_name
      ? t('schedulingConflict.alreadyAssigned', { department: c.department_name, context: c.context, date })
      : t('schedulingConflict.reportedAbsent', { date })
  ));
}

// One person, one assignment — e.g. Preaching's moderator picker,
// Media & Tech's role assignment. Returns true to proceed (no
// conflict, or the scheduler confirmed anyway), false to cancel.
export async function checkAndConfirmAssignment({ supabase, userId, userLabel, date, departmentId }) {
  const { data: conflicts, error } = await supabase.rpc('get_user_schedule_conflicts', {
    p_user_id: userId,
    p_date: date,
    p_exclude_department_id: departmentId,
  });
  if (error || !conflicts || conflicts.length === 0) return true;

  const message = [
    t('schedulingConflict.intro', { date }),
    ...conflictLines(conflicts, date),
    '',
    t('schedulingConflict.confirmSingle', { name: userLabel }),
  ].join('\n');

  return confirmDialog({
    title: t('schedulingConflict.title'),
    message,
    confirmLabel: t('schedulingConflict.confirmLabel'),
  });
}

// Many people assigned at once — the auto-planner assigns a whole
// week's singers algorithmically in one save, so this checks everyone
// first and shows ONE combined summary rather than one popup per
// singer (which would make a 20-singer plan unusable). Returns true to
// proceed with the whole batch as-is, false to cancel the save.
export async function checkAndConfirmBatchAssignment({ supabase, departmentId, assignments }) {
  const lines = [];
  for (const { userId, userLabel, date } of assignments) {
    const { data: conflicts, error } = await supabase.rpc('get_user_schedule_conflicts', {
      p_user_id: userId,
      p_date: date,
      p_exclude_department_id: departmentId,
    });
    if (error || !conflicts || conflicts.length === 0) continue;
    for (const line of conflictLines(conflicts, date)) lines.push(`${userLabel} — ${line}`);
  }
  if (lines.length === 0) return true;

  return confirmDialog({
    title: t('schedulingConflict.batchTitle'),
    message: [...lines, '', t('schedulingConflict.confirmBatch')].join('\n'),
    confirmLabel: t('schedulingConflict.confirmLabel'),
  });
}
