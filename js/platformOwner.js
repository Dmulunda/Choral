// Client-side cache of whether the signed-in user is the Platform Owner
// (public.platform_owner, see is_platform_owner() in sql/083) — a
// single, cross-tenant account, distinct from Site Admin (sql/049):
// Owner controls billing/plans, Site Admin triages support/suggestions.
// Loaded once at sign-in alongside loadSiteAdminStatus(), same pattern.
import { supabase } from './supabaseClient.js';

let isPlatformOwner = false;

export async function loadPlatformOwnerStatus() {
  const { data } = await supabase.rpc('is_platform_owner');
  isPlatformOwner = !!data;
}

export function getIsPlatformOwner() {
  return isPlatformOwner;
}
