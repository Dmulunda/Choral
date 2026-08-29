// Admin-driven password reset (the "Active Directory"-style flow):
// a Super Admin picks a member and sets/generates their password
// directly, instead of relying on the member clicking a reset-link
// email. Must run server-side — updating another user's password
// requires the Supabase service-role key, which can never be shipped
// to the browser, so this can't live in the static app the way the
// rest of choir-app's code does.
//
// Deploy: Supabase Dashboard -> Edge Functions -> deploy this file as
// "admin-reset-password" (or `supabase functions deploy
// admin-reset-password`). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are provided automatically to every Edge Function — no secrets to
// set by hand.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Unambiguous charset — no 0/O/1/l/I — since this is meant to be read
// aloud or typed by hand when handed to the member.
const PASSWORD_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function generatePassword(length = 10) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += PASSWORD_CHARS[bytes[i] % PASSWORD_CHARS.length];
  return out;
}

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

    // Validates the JWT's signature/expiry against Supabase Auth itself
    // (not just decoded client-side), so the caller identity below can't
    // be spoofed by sending someone else's id in the request body.
    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(jwt);
    if (callerError || !caller) return json({ error: 'Invalid session' }, 401);

    const { data: callerProfile, error: profileError } = await admin
      .from('profiles')
      .select('global_role')
      .eq('id', caller.id)
      .single();
    if (profileError || callerProfile?.global_role !== 'super_admin') {
      return json({ error: 'Only a Super Admin can reset another member\'s password' }, 403);
    }

    const { target_user_id, new_password } = await req.json();
    if (!target_user_id) return json({ error: 'target_user_id is required' }, 400);

    const password = (new_password && new_password.trim()) || generatePassword();
    if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const { error: updateError } = await admin.auth.admin.updateUserById(target_user_id, { password });
    if (updateError) return json({ error: updateError.message }, 400);

    return json({ password });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Unexpected error' }, 500);
  }
});
