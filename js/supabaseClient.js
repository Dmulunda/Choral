// Supabase client initialization
// Loaded as an ES module: <script type="module" src="js/supabaseClient.js"></script>
// or imported by other modules: import { supabase } from './supabaseClient.js';

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// The anon key is safe to expose in client-side code as long as
// Row Level Security policies are enabled on every table (see
// sql/saas_platform/01_schema.sql).
// Exported so callers that need a raw fetch() straight to an edge
// function (e.g. to read a streaming response body, which
// supabase.functions.invoke() doesn't expose) can build the request
// themselves instead of duplicating these values.
//
// Points at the new multi-tenant SaaS project (towlqbxvhftzjfrtepsy), NOT
// the live single-church app's project (ezrwmplohjvttwosqvrn) -- this
// branch is the working copy for the new SaaS codebase, kept local until
// it's split into its own repo (see sql/saas_platform/README.md). Do not
// merge this file's change back into whatever deploys the live app.
export const SUPABASE_URL = 'https://towlqbxvhftzjfrtepsy.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRvd2xxYnh2aGZ0empmcnRlcHN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNzY2NjIsImV4cCI6MjEwNDY1MjY2Mn0.k3tlKMNNlpd-TGcd5hnyDfSzNcdmy8QLKiRYKkOEa-c';

// persistSession/autoRefreshToken are already the library defaults —
// spelled out explicitly here so "stay signed in on this device" is a
// deliberate choice, not an accident of whatever @supabase/supabase-js
// happens to default to. The actual "how many days without opening the
// app before you're signed out" ceiling is a Supabase *project* setting
// (Dashboard → Authentication → Sessions → "Time-box user sessions" /
// refresh token expiry), not something this client config controls.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

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
