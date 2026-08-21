// Client-side cache of whether the signed-in user is a School Admin
// (profiles.is_school_admin, or Super Admin — see is_school_admin() in
// sql/044) — loaded once at sign-in alongside loadMyDepartments(),
// kept separate from departments.js since this permission has nothing
// to do with department/global-role governance, only the LMS.
import { supabase } from './supabaseClient.js';

let isSchoolAdmin = false;

export async function loadSchoolAdminStatus(userId) {
  const { data } = await supabase.from('profiles').select('is_school_admin, global_role').eq('id', userId).single();
  isSchoolAdmin = !!data?.is_school_admin || data?.global_role === 'super_admin';
}

export function getIsSchoolAdmin() {
  return isSchoolAdmin;
}
