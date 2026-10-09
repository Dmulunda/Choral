// Listens to the operator's microphone (opt-in, click-to-start only --
// never auto-starts) during a live service and watches the transcript
// for a spoken Bible reference ("John chapter 3 verse 16", "Jean 3
// 16") in English or French, surfacing it as a one-tap SUGGESTION --
// this module never broadcasts anything itself. A misheard word
// during a sermon must never silently change what the congregation
// sees; the operator always taps to actually show it (see
// projectionControl.js's call site).
//
// Chromium-only (window.SpeechRecognition/webkitSpeechRecognition) --
// isSupported() lets the call site hide the feature entirely rather
// than show a broken button, same pattern as localMediaStore.js.
//
// Numbers: Chrome's recognizer normalizes most spoken numbers into
// digits in the final transcript ("sixteen" -> "16"), which this
// relies on for finding the chapter/verse digits after a book name.
// A chapter/verse Chrome happens to keep as a word instead (uncommon
// in practice, more likely for small numbers) won't be caught by this
// first version -- a real limitation, not a bug, flagged here rather
// than silently pretended away.

export function isSupported() {
  return 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
}

function stripAccents(str) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// ASR commonly renders a numeric book prefix as an ordinal WORD
// ("First Corinthians") rather than the literal digit ("1
// Corinthians") that `bible_books.name_en`/`name_fr` actually store --
// same idea in French ("Premiere"/"Deuxieme" for "1 Jean"/"2 Jean",
// accents already stripped by the time this runs). Generating both
// forms as aliases means either spoken style gets matched.
const ORDINAL_PREFIXES = {
  1: ['1', 'first', 'premier', 'premiere'],
  2: ['2', 'second', 'deuxieme'],
  3: ['3', 'third', 'troisieme'],
};

function aliasesForName(name) {
  const norm = stripAccents(name).toLowerCase().trim();
  const prefixMatch = norm.match(/^([123])\s+(.+)$/);
  if (!prefixMatch) return [norm];
  const [, digit, rest] = prefixMatch;
  return ORDINAL_PREFIXES[Number(digit)].map((p) => `${p} ${rest}`);
}

// [{ alias, bookNumber }], longest alias first so e.g. "1 corinthians"
// is tried before a bare "corinthians" substring match could grab it
// out of context -- sourced from the SAME `bible_books` rows the
// Bible tab's own book picker already loads, one list, two UIs.
export function buildBookAliases(books) {
  const aliases = [];
  (books || []).forEach((b) => {
    aliasesForName(b.name_en || '').forEach((alias) => { if (alias) aliases.push({ alias, bookNumber: b.number }); });
    aliasesForName(b.name_fr || '').forEach((alias) => { if (alias) aliases.push({ alias, bookNumber: b.number }); });
  });
  aliases.sort((a, b) => b.alias.length - a.alias.length);
  return aliases;
}

// Looks for "<book alias> ... <number> ... <number>" within a short
// window of text right after the alias -- deliberately tolerant of
// whatever connective words ("chapter"/"verse", "chapitre"/"verset",
// a colon, nothing at all) Chrome's transcript happens to render,
// since those vary by phrasing and language while the two numbers
// are the reliable part. Requires BOTH numbers (chapter and verse) --
// a bare book+chapter mention is deliberately not enough to fire a
// suggestion, since that's far more likely to be incidental sermon
// talk ("turning to Romans 8 today...") than an actual citation.
export function findReferenceInText(text, aliases) {
  const norm = stripAccents(text).toLowerCase();
  for (const { alias, bookNumber } of aliases) {
    const idx = norm.indexOf(alias);
    if (idx === -1) continue;
    const after = norm.slice(idx + alias.length, idx + alias.length + 40);
    const numbers = after.match(/\d+/g);
    if (!numbers || numbers.length < 2) continue;
    const chapter = Number(numbers[0]);
    const verse = Number(numbers[1]);
    if (!chapter || !verse) continue;
    return { bookNumber, chapter, verse };
  }
  return null;
}

const COOLDOWN_MS = 10000;

// `lang`: 'fr-FR' or 'en-US' -- the audio recognition language, which
// should match whatever language the service is actually in (garbage
// in from a mismatched model means garbage matches out, regardless of
// how good the alias list is). `aliases`: buildBookAliases() output.
// `onDetect({ bookNumber, chapter, verse })` fires at most once per
// distinct reference within COOLDOWN_MS -- a pastor re-reading the
// same verse a moment later shouldn't re-pop a suggestion the operator
// already dismissed or already showed. `onError(code)` fires only for
// errors that stop listening for good (e.g. the mic permission was
// denied) -- routine ones like a quiet pause are handled internally.
export function createVoiceVerseDetector({ lang, aliases, onDetect, onError }) {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = lang;

  let listening = false;
  let stoppedByCaller = false;
  let lastKey = null;
  let lastFiredAt = 0;

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (!result.isFinal) continue;
      const transcript = result[0]?.transcript || '';
      const match = findReferenceInText(transcript, aliases);
      if (!match) continue;
      const key = `${match.bookNumber}:${match.chapter}:${match.verse}`;
      const now = Date.now();
      if (key === lastKey && now - lastFiredAt < COOLDOWN_MS) continue;
      lastKey = key;
      lastFiredAt = now;
      onDetect(match);
    }
  };

  recognition.onerror = (event) => {
    // 'not-allowed'/'service-not-allowed' mean the mic permission was
    // denied or revoked -- nothing further will work until the
    // operator explicitly tries again, so stop cleanly rather than
    // let onend's auto-restart spin forever against a closed door.
    // Routine conditions ('no-speech', 'audio-capture' during a silent
    // moment, etc.) are left to onend's restart below, not treated as
    // real errors.
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      stoppedByCaller = true;
      listening = false;
      onError?.(event.error);
    }
  };

  recognition.onend = () => {
    if (stoppedByCaller) { listening = false; return; }
    // Chrome ends a continuous session on its own after a while even
    // with no error at all -- restart transparently so "Listening"
    // stays on until the operator explicitly turns it off.
    try { recognition.start(); } catch { /* already starting/started */ }
  };

  return {
    start() {
      stoppedByCaller = false;
      try { recognition.start(); listening = true; } catch { /* already listening */ }
    },
    stop() {
      stoppedByCaller = true;
      listening = false;
      try { recognition.stop(); } catch { /* already stopped */ }
    },
    isListening() { return listening; },
  };
}
