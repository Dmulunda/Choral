// Thin, reusable wrapper around the send-push edge function (sql/078)
// for "tell this department's members something happened" — used
// after posting a schedule/duty roster in any department, so nobody
// has to go check manually. Always best-effort: the save it's called
// after has already succeeded, so a push failure (function not
// deployed yet, nobody subscribed, network hiccup) must never surface
// as an error to the person who just saved something.
export function notifyDepartment(supabase, departmentId, title, body) {
  supabase.functions.invoke('send-push', { body: { department_id: departmentId, title, body } }).catch(() => {});
}
