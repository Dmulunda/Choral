// One-time data import for the Bible/projection feature (sql/074):
// pulls a public-domain translation from api.getbible.net and upserts
// it into bible_verses. Super-Admin-only, called in book-range chunks
// by js/components/bibleImportTool.js so a single request never has to
// fetch+upsert the whole ~31,000-verse Bible at once (edge function
// wall-clock limits, and it gives the admin a progress bar).
//
// Fetches ONE BOOK AT A TIME (api.getbible.net/v2/{translation}/{bookNr}.json)
// -- NOT the old approach of fetching the whole-Bible JSON
// (api.getbible.net/v2/{translation}.json, every book, ~31,000 verses)
// on every single chunk call and discarding everything outside the
// requested range. That was the real reason large books kept coming
// back incomplete (confirmed live: Psalms stopped partway through on
// both SAAS and Main) -- shrinking the book-range chunk size never
// touched the actual dominant cost, which was re-downloading the
// entire Bible's JSON on every one of the ~22 chunk calls regardless
// of how small each chunk's own book range was. Fetching per-book
// means each call only ever downloads the handful of books it
// actually needs.
//
// Deploy: Supabase Dashboard -> Edge Functions -> deploy this file as
// "import-bible" (or `supabase functions deploy import-bible`).
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// translation (our column value) -> getbible.net abbreviation. Used to
// build a per-book URL: https://api.getbible.net/v2/{abbr}/{bookNr}.json
const SOURCE_ABBR = {
  web: 'web',
  lsg: 'ls1910',
};

const UPSERT_BATCH_SIZE = 500;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    if (!jwt) return json({ error: 'Missing authorization' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL'),
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    );

    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
    if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

    const { data: callerProfile, error: profileError } = await admin
      .from('profiles')
      .select('global_role')
      .eq('id', caller.id)
      .single();
    if (profileError || callerProfile?.global_role !== 'super_admin') {
      return json({ error: 'Only a Super Admin can import Bible data' }, 403);
    }

    const { translation, from_book, to_book } = await req.json();
    const abbr = SOURCE_ABBR[translation];
    if (!abbr) return json({ error: `Unknown translation "${translation}"` }, 400);
    if (!Number.isInteger(from_book) || !Number.isInteger(to_book) || from_book < 1 || to_book > 66 || from_book > to_book) {
      return json({ error: 'from_book/to_book must be a valid 1-66 range' }, 400);
    }

    const rows = [];
    for (let bookNr = from_book; bookNr <= to_book; bookNr += 1) {
      const bookRes = await fetch(`https://api.getbible.net/v2/${abbr}/${bookNr}.json`);
      if (!bookRes.ok) return json({ error: `Failed to fetch book ${bookNr}: HTTP ${bookRes.status}` }, 502);
      const book = await bookRes.json();
      for (const chapter of book.chapters ?? []) {
        for (const verse of chapter.verses ?? []) {
          rows.push({
            translation,
            book_number: bookNr,
            chapter: verse.chapter,
            verse: verse.verse,
            text: (verse.text ?? '').trim(),
          });
        }
      }
    }

    if (rows.length === 0) return json({ error: 'No verses found for that book range' }, 502);

    for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = rows.slice(i, i + UPSERT_BATCH_SIZE);
      const { error: upsertError } = await admin
        .from('bible_verses')
        .upsert(batch, { onConflict: 'translation,book_number,chapter,verse' });
      if (upsertError) return json({ error: `Import failed: ${upsertError.message}` }, 500);
    }

    return json({ imported: rows.length });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
