// Loads the signed-in user's department memberships (or every
// department, if they hold a global role) once per session, and tracks
// which department is currently "active" — the one the sidebar nav and
// tab content render for. Mirrors i18n.js's localStorage pattern.
import { supabase } from './supabaseClient.js';

const ACTIVE_DEPT_STORAGE_KEY = 'choir-hub-active-department';

let myDepartments = null; // [{ id, key, name, kind, role }] — role is 'admin'/'member', or the global role for super users
let globalRole = null;

export async function loadMyDepartments(userId) {
  const { data: profile } = await supabase.from('profiles').select('global_role').eq('id', userId).single();
  globalRole = profile?.global_role || null;

  if (globalRole) {
    const { data: allDepartments } = await supabase.from('departments').select('id, key, name, kind').order('name');
    myDepartments = (allDepartments || []).map((d) => ({ ...d, role: globalRole }));
    return myDepartments;
  }

  const { data: memberships } = await supabase
    .from('department_memberships')
    .select('role, departments ( id, key, name, kind )')
    .eq('user_id', userId)
    .eq('status', 'approved');

  myDepartments = (memberships || [])
    .filter((m) => m.departments)
    .map((m) => ({ ...m.departments, role: m.role }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return myDepartments;
}

export function getMyDepartments() {
  return myDepartments || [];
}

export function getGlobalRole() {
  return globalRole;
}

export function isSuperRole() {
  return globalRole === 'super_admin' || globalRole === 'super_viewer';
}

export function getActiveDepartment() {
  const departments = getMyDepartments();
  if (departments.length === 0) return null;

  const storedKey = localStorage.getItem(ACTIVE_DEPT_STORAGE_KEY);
  const stored = departments.find((d) => d.key === storedKey);
  return stored || departments[0];
}

export function setActiveDepartmentKey(key) {
  localStorage.setItem(ACTIVE_DEPT_STORAGE_KEY, key);
}
