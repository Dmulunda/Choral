// Church Extensions: caches the signed-in user's cross-extension reach
// (denomination_admins rows + the list of extensions they can act as)
// once per session, same pattern as tenant.js/departments.js. See
// sql/saas_platform/34_church_extensions.sql and 35_church_extensions_rpcs.sql.
import { supabase } from './supabaseClient.js';

let myDenominationRoles = []; // [{ denomination_id, role }]
let myExtensions = []; // [{ tenant_id, name, slug, is_acting_as }]

export async function loadMyDenominationInfo(userId) {
  const [{ data: roles }, { data: extensions }] = await Promise.all([
    supabase.from('denomination_admins').select('denomination_id, role').eq('user_id', userId),
    supabase.rpc('list_my_denomination_extensions'),
  ]);

  myDenominationRoles = roles || [];
  myExtensions = extensions || [];
  return myExtensions;
}

export function getMyExtensions() {
  return myExtensions;
}

export function hasMultipleExtensions() {
  return myExtensions.length > 1;
}

export function getActingExtension() {
  return myExtensions.find((e) => e.is_acting_as) || null;
}

// True for anyone who holds ANY denomination_admins row -- used to
// gate showing the Extensions section at all in tenantLogoModal.js
// (the "Add Extension" form itself is further gated to global_super_admin
// specifically, checked separately below).
export function hasAnyDenominationRole() {
  return myDenominationRoles.length > 0;
}

export function isGlobalSuperAdminForDenomination(denominationId) {
  return myDenominationRoles.some((r) => r.denomination_id === denominationId && r.role === 'global_super_admin');
}

export function isGlobalSuperAdminForAnyDenomination() {
  return myDenominationRoles.some((r) => r.role === 'global_super_admin');
}

// The caller's denomination_admins role ('global_super_admin' |
// 'general_overseer' | 'general_secretary') for a SPECIFIC denomination,
// or null if they hold none there -- (user_id, denomination_id) is the
// table's primary key, so there's at most one. Used to show a role
// badge next to the person's name so "Super Admin" (home tenant only)
// and "Global Super Admin" (every extension) are never ambiguous.
export function getMyDenominationRole(denominationId) {
  if (!denominationId) return null;
  return myDenominationRoles.find((r) => r.denomination_id === denominationId)?.role || null;
}

export async function createChurchExtension(supabaseClient, name, slug, denominationName) {
  const { data, error } = await supabaseClient.rpc('create_church_extension', {
    p_name: name,
    p_slug: slug,
    p_denomination_name: denominationName || null,
  });
  return { data, error };
}

export async function grantDenominationRoleByEmail(supabaseClient, denominationId, email, role) {
  const { data: found, error: lookupError } = await supabaseClient.rpc('find_denomination_member_by_email', {
    p_denomination_id: denominationId,
    p_email: email,
  });
  if (lookupError) return { error: lookupError };
  const member = found?.[0];
  if (!member) return { error: { message: 'notFound' } };

  const { error } = await supabaseClient.rpc('grant_denomination_role', {
    p_user_id: member.user_id,
    p_denomination_id: denominationId,
    p_role: role,
  });
  return { error, member };
}

export async function switchActingExtension(supabaseClient, tenantId) {
  if (tenantId) {
    return supabaseClient.rpc('set_acting_as_tenant', { p_tenant_id: tenantId });
  }
  return supabaseClient.rpc('clear_acting_as_tenant');
}
