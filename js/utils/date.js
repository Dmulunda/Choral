// Local (not UTC) YYYY-MM-DD formatting — avoids the off-by-one-day bug
// you get from toISOString() near midnight in non-UTC timezones.
export function formatDateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayLocal() {
  return formatDateLocal(new Date());
}
