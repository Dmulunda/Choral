// Church logo + address (church_branding, a singleton row -- same
// boolean-PK pattern as app_theme in theme.js, since this app has only
// one church, unlike sandbox2's per-tenant tenants.logo_url/address).
// Loaded once at startup and cached here; churchLogoModal.js re-loads
// after a save so the next render of any consumer below picks up the
// change -- there's no persistent header logo element on this app to
// push a live update into, unlike sandbox2's applyTenantBranding().
import { supabase } from './supabaseClient.js';

let branding = null;

export async function loadChurchBranding() {
  const { data } = await supabase.from('church_branding').select('logo_url, address, email, phone').eq('id', true).maybeSingle();
  branding = data || null;
  return branding;
}

export function getChurchLogoUrl() {
  return branding?.logo_url || null;
}

export function getChurchAddress() {
  return branding?.address || null;
}

export function getChurchEmail() {
  return branding?.email || null;
}

export function getChurchPhone() {
  return branding?.phone || null;
}
