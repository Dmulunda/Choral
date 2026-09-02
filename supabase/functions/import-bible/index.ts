// One-time data import for the Bible/projection feature (sql/074):
// pulls a public-domain translation from api.getbible.net and upserts
// it into bible_verses. Super-Admin-only, called in book-range chunks
// by js/components/bibleImportTool.js so a single request never has to
// fetch+upsert the whole ~31,000-verse Bible at once (edge function
// wall-clock limits, and it gives the admin a progress bar).
//
// Deploy: Supabase Dashboard -> Edge Functions -> deploy this file as
// "import-bible" (or `supabase functions deploy import-bible`).
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are provided automatically.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// translation (our column value) -> getbible.net abbreviation.
const SOURCE_URLS = {
  web: 'https://api.getbible.net/v2/web.json',
  lsg: 'https://api.getbible.net/v2/ls1910.json',
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
    const sourceUrl = SOURCE_URLS[translation];
    if (!sourceUrl) return json({ error: `Unknown translation "${translation}"` }, 400);
    if (!Number.isInteger(from_book) || !Number.isInteger(to_book) || from_book < 1 || to_book > 66 || from_book > to_book) {
      return json({ error: 'from_book/to_book must be a valid 1-66 range' }, 400);
    }

    const sourceRes = await fetch(sourceUrl);
    if (!sourceRes.ok) return json({ error: `Failed to fetch source text: HTTP ${sourceRes.status}` }, 502);
    const sourceData = await sourceRes.json();

    const rows = [];
    for (const book of sourceData.books ?? []) {
      if (book.nr < from_book || book.nr > to_book) continue;
      for (const chapter of book.chapters ?? []) {
        for (const verse of chapter.verses ?? []) {
          rows.push({
            translation,
            book_number: book.nr,
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
