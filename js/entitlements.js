// Loads the signed-in tenant's current feature entitlements once per
// session (get_my_features() RPC — full list during trial, otherwise the
// union of the tenant's plan's features; see sql/saas_platform/08_plans_and_features.sql).
// This is a DISPLAY-layer convenience only — hiding/prompting in the UI
// for features the tenant doesn't have. It is not the security boundary:
// every gated table also carries a RESTRICTIVE RLS policy requiring
// has_feature('<key>'), so a direct API call bypassing this module still
// gets rejected by the database itself, not just hidden by the UI.
import { supabase } from './supabaseClient.js';

let myFeatures = new Set();

export async function loadMyEntitlements() {
  const { data, error } = await supabase.rpc('get_my_features');
  myFeatures = new Set(error ? [] : (data || []));
  return myFeatures;
}

export function hasFeature(key) {
  return myFeatures.has(key);
}
