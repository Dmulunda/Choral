// Shared between plansModal.js and planPickerModal.js so the "Have a
// promo code?" widget behaves identically in both places. Validation
// always goes through stripe-billing's validate_promo_code action
// (never a direct table read -- promo_codes is Site-Admin-only RLS,
// see sql/saas_platform/75_promo_codes.sql) and is re-checked again,
// for real, server-side inside create_checkout_session once a plan is
// actually picked -- this module's result is only ever used to drive
// the UI, never trusted on its own for what gets charged.
import { t } from '../i18n.js';

export async function validatePromoCode(supabase, code) {
  const { data, error } = await supabase.functions.invoke('stripe-billing', {
    body: { action: 'validate_promo_code', code },
  });
  if (error) return { valid: false, reason: 'not_found' };
  return data;
}

// supabase-js's functions.invoke() only populates `data` on a 2xx
// response -- create_checkout_session deliberately returns 400 for a
// rejected promo code (an existing, working plan/Stripe failure would
// use 404/500 the same way), which means `data` comes back null and
// the real `{ error, reason }` body is only reachable via
// error.context (a raw Response that hasn't been read yet). Without
// this, every one of those rejections fell back to supabase-js's own
// generic "Edge Function returned a non-2xx status code" instead of
// the actual reason.
export async function extractEdgeFunctionError(error) {
  if (!error) return {};
  try {
    const body = await error.context?.clone().json();
    if (body) return body;
  } catch { /* context wasn't JSON (e.g. a network failure) -- fall through */ }
  return { error: error.message };
}

export function discountedPriceCents(priceCents, discountPercent) {
  return Math.max(0, Math.round(priceCents * (1 - discountPercent / 100)));
}

// `reason` codes returned by validate_promo_code/create_checkout_session
// (see stripe-billing/index.ts) -- translated here, not server-side, so
// the message matches whichever language the admin is actually using.
export function promoErrorMessage(reason) {
  return t(`plans.promoError.${reason}`) || t('plans.promoError.not_found');
}
