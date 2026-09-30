// Client-side cache of whether the signed-in user is a Site Admin
// (public.platform_admins, see is_site_admin() in sql/049) — a
// platform-wide role, not scoped to any one tenant, so this is
// deliberately separate from departments.js/tenant.js. Loaded once at
// sign-in alongside loadSchoolAdminStatus(), same pattern.
import { supabase } from './supabaseClient.js';

let isSiteAdmin = false;

export async function loadSiteAdminStatus() {
  const { data } = await supabase.rpc('is_site_admin');
  isSiteAdmin = !!data;
}

export function getIsSiteAdmin() {
  return isSiteAdmin;
}
