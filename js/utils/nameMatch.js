// Fuzzy name matching for the Tax Receipts donation import
// (taxDonationImport.js) -- no fuzzy-string-matching library exists
// anywhere in this app (it's static/CDN-only, no npm layer), so this
// is a small hand-rolled Levenshtein-based similarity score. Matches
// at or above SUGGESTED_MATCH_THRESHOLD are shown as a suggestion in
// the import review table, never applied automatically -- an admin
// always confirms or corrects every row before anything is written.

export const SUGGESTED_MATCH_THRESHOLD = 80;

// Same normalization as peopleImportModal.js's normalizeHeader(), but
// keeps spaces (word boundaries carry real signal for a name, unlike a
// column header) instead of collapsing to one token.
export function normalizeName(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const currRow = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currRow.push(Math.min(
        prevRow[j] + 1,      // deletion
        currRow[j - 1] + 1,  // insertion
        prevRow[j - 1] + cost, // substitution
      ));
    }
    prevRow = currRow;
  }
  return prevRow[b.length];
}

// 0-100, higher is more similar. Two empty strings score 0 (nothing to
// compare), not 100 -- an empty spreadsheet name should never "match."
export function similarityScore(a, b) {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 0;
  const distance = levenshteinDistance(normA, normB);
  return Math.round((1 - distance / maxLen) * 100);
}

// profiles: [{ id, full_name }]. Returns the single best-scoring
// candidate ({ id, full_name, score }) at or above
// SUGGESTED_MATCH_THRESHOLD, or null if nothing clears the bar.
export function findBestMatch(rawName, profiles) {
  let best = null;
  for (const profile of profiles) {
    const score = similarityScore(rawName, profile.full_name);
    if (score >= SUGGESTED_MATCH_THRESHOLD && (!best || score > best.score)) {
      best = { id: profile.id, full_name: profile.full_name, score };
    }
  }
  return best;
}
