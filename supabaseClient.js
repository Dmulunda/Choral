// Supabase client initialization
// Loaded as an ES module: <script type="module" src="js/supabaseClient.js"></script>
// or imported by other modules: import { supabase } from './supabaseClient.js';

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// TODO: replace with your project's values (Project Settings > API).
// The anon key is safe to expose in client-side code as long as
// Row Level Security policies are enabled on every table (see sql/schema.sql).
const SUPABASE_URL = 'https://ezrwmplohjvttwosqvrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV6cndtcGxvaGp2dHR3b3NxdnJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY4MzkxMjksImV4cCI6MjEwMjQxNTEyOX0.YzGP5gfb0GhGNGRylK4g_lBH4-mERiOmClqCQ_UrO_M';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// A throwaway client for actions that must not touch the signed-in user's
// own session — e.g. an admin creating a new member's account via signUp(),
// which would otherwise sign the admin out and into the new account.
// persistSession: false keeps it out of localStorage entirely, so it can
// never overwrite (or be synced into) the main client's stored session.
export function createScopedClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
