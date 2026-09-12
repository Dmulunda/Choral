// Loads the signed-in user's tenant (church) once per session, and
// exposes it for display purposes — trial banners, feature gating, etc.
// Mirrors departments.js's module-level-cache pattern.
//
// This module does NOT filter or scope any query — real tenant isolation
// is enforced entirely by RESTRICTIVE RLS policies (see sql/saas_platform/).
// A bug here can make the UI show the wrong thing; it cannot leak another
// tenant's data, because the database never returns it in the first place.
import { supabase } from './supabaseClient.js';

let myTenant = null; // { id, name, slug, status, trial_ends_at, plan_id, stripe_customer_id } | null

export async function loadMyTenant(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('tenant_id, tenants ( id, name, slug, status, trial_ends_at, plan_id, stripe_customer_id )')
    .eq('id', userId)
    .single();

  myTenant = profile?.tenants || null;
  return myTenant;
}

export function getTenant() {
  return myTenant;
}

export function getTenantId() {
  return myTenant?.id || null;
}

export function getTenantStatus() {
  return myTenant?.status || null;
}

// Whole days left, rounded up — "expires in 5 minutes" still reads as
// "1 day left" rather than "0 days left" (which would sound already-over).
// null when not on a trial (no trial_ends_at) or already past it.
export function getTrialDaysLeft() {
  if (getTenantStatus() !== 'trial' || !myTenant?.trial_ends_at) return null;
  const ms = new Date(myTenant.trial_ends_at).getTime() - Date.now();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
