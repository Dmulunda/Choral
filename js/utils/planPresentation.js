// Shared between plansModal.js (signed-in, in-app "Plans & Pricing")
// and welcomePage.js (public marketing site, anonymous visitors) so
// the two never describe a plan's limits/features differently. Pure
// display logic only -- no Supabase calls, no DOM.
import { t } from '../i18n.js';

// Core functionality included in every tier -- not gated per plan, so
// not stored in plan_features (that table is only for things a plan
// can turn on/off, like vpd_academy).
export const BASE_FEATURE_KEYS = [
  'plans.featureChoirManagement',
  'plans.featureMemberManagement',
  'plans.featureDepartmentManagement',
  'plans.featureProgramsEvents',
  'plans.featureFinancialManagement',
  'plans.featurePastoralScheduling',
  'plans.featureAttendanceTracking',
  'plans.featureTeamScheduling',
];

export function buildLimitBullets(plan, hasCourses) {
  const bullets = [];

  if (plan.max_extensions === 0) {
    bullets.push(t('plans.limitNoExtensions'));
  } else if (plan.max_extensions === null) {
    bullets.push(t('plans.limitExtensionsUnlimited'));
  } else {
    bullets.push(t('plans.limitExtensionsUpTo', { count: plan.max_extensions }));
  }

  bullets.push(plan.max_super_admins_per_tenant === null
    ? t('plans.limitSuperAdminsUnlimited')
    : t('plans.limitSuperAdmins', { count: plan.max_super_admins_per_tenant }));

  bullets.push(plan.max_members === null
    ? t('plans.limitMembersUnlimited')
    : t('plans.limitMembers', { count: plan.max_members }));

  if (plan.max_admins !== undefined) {
    bullets.push(plan.max_admins === null
      ? t('plans.limitAdminsUnlimited')
      : t('plans.limitAdmins', { count: plan.max_admins }));
  }

  if (plan.max_global_admins !== undefined) {
    bullets.push(plan.max_global_admins === null
      ? t('plans.limitGlobalAdminsUnlimited')
      : plan.max_global_admins === 0
        ? t('plans.limitGlobalAdminsNone')
        : t('plans.limitGlobalAdmins', { count: plan.max_global_admins }));
  }

  // Projection/Flyers/Member Card/department-tier access are now real
  // plan_features rows (sql/saas_platform/86_pricing_v2.sql) -- they
  // already appear via the generic feature-name bullet list in
  // plansModal.js, so no hardcoded "Projection included" bullet here
  // any more (it used to be unconditional, which went stale/wrong the
  // moment Projection stopped being included on every plan).

  bullets.push(hasCourses ? t('plans.limitCoursesIncluded') : t('plans.limitCoursesNotIncluded'));

  if (hasCourses) {
    bullets.push(plan.storage_gb === null ? t('plans.limitStorageUnlimited') : t('plans.limitStorage', { count: plan.storage_gb }));
  }

  return bullets;
}

// toFixed(0) would round 59.99/99.99/199.99 to whole dollars
// ($60/$100/$200) -- keep the exact cents, comma as the decimal
// separator per how these prices were originally given (59,99).
export function formatPlanPrice(priceCents, billingInterval = 'monthly') {
  if (priceCents === 0) return t('plans.free');
  const suffix = billingInterval === 'yearly' ? t('plans.perYear') : t('plans.perMonth');
  return `$${(priceCents / 100).toFixed(2).replace('.', ',')}${suffix}`;
}

// The "≈ $X/mo billed annually" subtitle shown under a yearly card's
// price -- same comma-decimal convention as formatPlanPrice above.
export function formatMonthlyEquivalent(yearlyPriceCents) {
  return `$${(yearlyPriceCents / 1200).toFixed(2).replace('.', ',')}`;
}
