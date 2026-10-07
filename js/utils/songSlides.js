// Splits a song's stored lyrics text into projection slides. Shared by
// js/components/projectionControl.js (actually projecting them) and
// js/components/songCreatorModal.js (a live preview while writing/
// editing lyrics, so an admin sees exactly how a song will be sliced
// before saving it) -- one splitting rule, never two copies that could
// drift apart.
//
// Rule: a blank line always starts a new slide (a stanza break) --
// unchanged from before this file existed. On top of that, two things
// are new:
//   1. A line containing only "---" is also a manual break, checked
//      FIRST -- lets whoever writes the lyrics decide exactly where a
//      long stanza splits, instead of leaving it to the automatic rule
//      below. The "---" line itself is dropped, not rendered.
//   2. Whatever's left after blank-line/manual splitting is further
//      capped at MAX_LINES_PER_SLIDE lines -- a stanza nobody
//      explicitly broke up that's still too long to read comfortably
//      on screen gets auto-divided rather than clipping (projector.html's
//      old behavior for an overlong stanza).
export const MAX_LINES_PER_SLIDE = 4;

export function splitLyricsIntoSlides(lyrics, maxLines = MAX_LINES_PER_SLIDE) {
  const stanzas = String(lyrics || '').split(/\n\s*\n/);
  const slides = [];

  for (const stanza of stanzas) {
    const rawLines = stanza.split('\n').map((l) => l.trim());
    // Group consecutive lines between "---" markers into their own
    // chunks first, then cap each chunk at maxLines.
    let chunk = [];
    const chunks = [];
    for (const line of rawLines) {
      if (line === '---') {
        if (chunk.length > 0) chunks.push(chunk);
        chunk = [];
        continue;
      }
      if (line) chunk.push(line);
    }
    if (chunk.length > 0) chunks.push(chunk);

    for (const c of chunks) {
      for (let i = 0; i < c.length; i += maxLines) {
        slides.push(c.slice(i, i + maxLines));
      }
    }
  }

  return slides.filter((lines) => lines.length > 0);
}
