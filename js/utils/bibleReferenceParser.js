// Parses a single typed-in-one-line Bible reference ("Mal 3 10",
// "Malachie 3:10", "mal 3.10") into { bookQuery, matches, chapter,
// verse } -- shared, pure logic reused by the Projection "smart
// search" bar (js/components/projectionControl.js) so the UI code
// only has to render, not parse.
//
// Core trick for telling "book name" apart from "chapter/verse
// numbers" without a hardcoded separator: split on whitespace, then
// find the LONGEST run of leading words that (a) still prefix-matches
// at least one real book name, AND (b) is immediately followed by a
// purely-numeric word (or by nothing at all, meaning the book name
// isn't finished yet). This correctly handles multi-word book names
// ("Song of Solomon 3 10") without needing a fixed word count for the
// book portion, since shorter prefixes simply fail the match test
// until the right boundary is reached.
// Matches js/components/projectionControl.js's own bookMatchesQuery:
// accent/case-insensitive prefix match, plus a second try with any
// leading "1 "/"2 "/"3 " stripped so "s" alone still finds "1 Samuel".
function bookMatchesQuery(name, query) {
  const normName = normalize(name);
  const normQuery = normalize(query);
  if (!normQuery) return false;
  if (normName.startsWith(normQuery)) return true;
  return normName.replace(/^\d+\s+/, '').startsWith(normQuery);
}

function normalize(str) {
  return stripAccentsLocal(str).toLowerCase().trim();
}

function stripAccentsLocal(str) {
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// books: [{ number, name_en, name_fr }]. isFrench: which name field to
// match against (mirrors the translation picker's own current value).
export function booksMatchingQuery(books, query, isFrench) {
  if (!query.trim()) return [];
  return books.filter((b) => bookMatchesQuery(isFrench ? b.name_fr : b.name_en, query));
}

// Returns { bookQuery, rest } where `rest` is the remaining
// whitespace-split tokens after the book portion (possibly containing
// ":"/"." inside a token, e.g. "3:10" or "3.10" -- the caller splits
// those further). `bookQuery` is '' when the input is empty, or the
// full remaining text when no valid book prefix has been typed yet.
export function splitBookFromRest(books, raw, isFrench) {
  const words = raw.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { bookQuery: '', rest: [] };

  let bestK = 0;
  for (let k = 1; k <= words.length; k += 1) {
    const candidate = words.slice(0, k).join(' ');
    const nextIsNumeric = k === words.length || /^\d+([:.]\d+)?$/.test(words[k]);
    if (nextIsNumeric && booksMatchingQuery(books, candidate, isFrench).length > 0) bestK = k;
  }

  if (bestK === 0) return { bookQuery: raw.trim(), rest: [] };
  return { bookQuery: words.slice(0, bestK).join(' '), rest: words.slice(bestK) };
}

// rest tokens may contain "3:10"/"3.10" as one token (colon/period
// shortcuts) -- flatten to plain numbers: [chapter, verse].
export function numbersFromRest(rest) {
  return rest
    .flatMap((tok) => tok.split(/[:.]/))
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
}

// Full parse: resolves the book (only when `bookQuery` uniquely
// matches exactly one book -- ambiguous or partial queries return
// `book: null` so the caller keeps showing suggestions instead of
// guessing), plus whatever chapter/verse numbers followed.
export function parseReference(books, raw, isFrench) {
  const { bookQuery, rest } = splitBookFromRest(books, raw, isFrench);
  const matches = booksMatchingQuery(books, bookQuery, isFrench);
  const book = matches.length === 1 ? matches[0] : null;
  const [chapter, verse] = numbersFromRest(rest);
  return { bookQuery, matches, book, chapter: chapter || null, verse: verse || null };
}
