// LRCLIB (https://lrclib.net) — free, no-key-required lyrics search API.
const LRCLIB_SEARCH_URL = 'https://lrclib.net/api/search';

export async function searchLrclib(query) {
  if (!query || !query.trim()) return [];

  const url = `${LRCLIB_SEARCH_URL}?q=${encodeURIComponent(query.trim())}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`LRCLIB request failed (${res.status})`);
  return res.json();
}

// LRCLIB results carry either plainLyrics or timestamped syncedLyrics
// (or both, or neither, for instrumental tracks). Normalize to plain text.
export function extractPlainLyrics(result) {
  if (result.plainLyrics) return result.plainLyrics;
  if (result.syncedLyrics) {
    return result.syncedLyrics
      .replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '')
      .split('\n')
      .map((line) => line.trim())
      .join('\n')
      .trim();
  }
  return '';
}
