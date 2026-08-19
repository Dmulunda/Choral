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
  if (isViewingAs()) return viewAsDepartments || [];
  return myDepartments || [];
}

export function getGlobalRole() {
  return globalRole;
}

export function isSuperRole() {
  return globalRole === 'super_admin' || globalRole === 'super_viewer';
}

// A department's synthesized `.role` (see loadMyDepartments/startViewAs
// above) is either a department_role ('admin'/'secretary'/'member') or,
// for a global-role holder, the literal global_role string — these two
// helpers classify that value for the announcements feature, mirroring
// can_post_department_announcement()/can_approve_department_membership()
// in sql/021 and sql/023 so the UI predicts the same outcome the RLS
// policies will actually enforce.
export function canPostAnnouncements(role) {
  return ['admin', 'secretary', 'super_admin', 'pastor_admin', 'church_secretary'].includes(role);
}

export function isGlobalAnnouncer(role) {
  return ['super_admin', 'pastor_admin', 'church_secretary'].includes(role);
}

// ---- Super Admin "View-As" mode ----
// True impersonation (actually holding the target's session) would need
// a service-role backend we don't have, and would be indistinguishable
// from really being logged in as them. Instead: simulate the target's
// department memberships/roles (so the switcher, nav, and admin-gated
// UI reflect *their* world, not the super admin's), and — for the
// "write operations are completely disabled" requirement — swap in a
// wrapped Supabase client that blocks every mutating call at the
// network layer. That's a stronger guarantee than trying to hide every
// write button across the app; even a control that's still visible
// simply can't succeed while this is active.
let viewAsTarget = null; // { id, full_name } | null
let viewAsDepartments = null;

export function isViewingAs() {
  return viewAsTarget !== null;
}

export function getViewAsTarget() {
  return viewAsTarget;
}

export async function startViewAs(targetUserId, targetFullName) {
  const { data: profile } = await supabase.from('profiles').select('global_role').eq('id', targetUserId).single();
  const targetGlobalRole = profile?.global_role || null;

  if (targetGlobalRole) {
    const { data: allDepartments } = await supabase.from('departments').select('id, key, name, kind').order('name');
    viewAsDepartments = (allDepartments || []).map((d) => ({ ...d, role: targetGlobalRole }));
  } else {
    const { data: memberships } = await supabase
      .from('department_memberships')
      .select('role, departments ( id, key, name, kind )')
      .eq('user_id', targetUserId)
      .eq('status', 'approved');
    viewAsDepartments = (memberships || [])
      .filter((m) => m.departments)
      .map((m) => ({ ...m.departments, role: m.role }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  viewAsTarget = { id: targetUserId, full_name: targetFullName };
  setActiveDepartmentKey(viewAsDepartments[0]?.key || '');
}

export function stopViewAs() {
  viewAsTarget = null;
  viewAsDepartments = null;
}

const VIEW_AS_BLOCKED_MESSAGE = 'This action is disabled while viewing as another user.';

// A chainable stand-in for a blocked query: any method call (.eq(),
// .select(), .single(), .match(), ...) returns itself again, and
// awaiting it (its `.then`) always resolves to a blocked-action error —
// so code written for the real query builder works unmodified, it just
// never succeeds.
function createBlockedQuery() {
  const chainable = {
    then(resolve) {
      resolve({ data: null, error: { message: VIEW_AS_BLOCKED_MESSAGE } });
    },
  };
  return new Proxy(chainable, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => chainable;
    },
  });
}

let readOnlyClient = null;

function getReadOnlyClient() {
  if (readOnlyClient) return readOnlyClient;

  readOnlyClient = new Proxy(supabase, {
    get(target, prop) {
      if (prop === 'from') {
        return (table) => {
          const builder = target.from(table);
          return new Proxy(builder, {
            get(builderTarget, builderProp) {
              if (['insert', 'update', 'delete', 'upsert'].includes(builderProp)) {
                return () => createBlockedQuery();
              }
              const value = builderTarget[builderProp];
              return typeof value === 'function' ? value.bind(builderTarget) : value;
            },
          });
        };
      }
      if (prop === 'rpc') {
        return () => createBlockedQuery();
      }
      if (prop === 'storage') {
        return { from: () => ({ upload: () => Promise.resolve({ data: null, error: { message: VIEW_AS_BLOCKED_MESSAGE } }) }) };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return readOnlyClient;
}

// Every tab-entry file should call this instead of importing `supabase`
// directly, and pass the result down to its child components as usual —
// it's the real client when not viewing-as, and the write-blocked one
// when it is.
export function getEffectiveSupabase() {
  return isViewingAs() ? getReadOnlyClient() : supabase;
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
