// Loads the signed-in user's department memberships (or every
// department, if they hold a global role) once per session, and tracks
// which department is currently "active" — the one the sidebar nav and
// tab content render for. Mirrors i18n.js's localStorage pattern.
import { supabase } from './supabaseClient.js';

const ACTIVE_DEPT_STORAGE_KEY = 'choir-hub-active-department';

// Static catalog of department keys, matching the seed data in
// sql/014_departments_rbac.sql. Hardcoded (rather than queried) because
// the sign-up form needs to list departments before the applicant has a
// session — the `departments` table's RLS only allows authenticated
// reads, and there's no reason for this rarely-changing catalog to need
// a network round trip anyway.
export const DEPARTMENT_KEYS = [
  'choir', 'social', 'intercession', 'media_tech', 'interpreting',
  'cleaning', 'preaching', 'ushers', 'security', 'ecodem', 'evangelism',
];

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

// Used right after sign-up (once a session exists) to file pending
// requests for the departments an applicant selected. Always role
// 'member' / status 'pending' — the DB also enforces this (see
// sql/015_membership_insert_fix.sql), self-service can never grant
// admin or auto-approve.
export async function requestDepartmentMemberships(userId, departmentKeys) {
  if (!departmentKeys || departmentKeys.length === 0) return;

  const { data: departments } = await supabase.from('departments').select('id, key').in('key', departmentKeys);
  const rows = (departments || []).map((d) => ({ user_id: userId, department_id: d.id }));
  if (rows.length === 0) return;

  await supabase.from('department_memberships').insert(rows);
}
