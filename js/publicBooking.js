// Entry point for booking.html — the public, unauthenticated booking
// page (outsiders, no login). Deliberately outside the normal app.js/
// index.html shell: no auth gate, no sidebar, just the shared booking
// calendar (js/components/pastorBookingCalendar.js) mounted directly.
// supabaseClient.js and i18n.js are both confirmed safe to use
// pre-login (the anon key is baked in at module load; loadLabelOverrides
// is just an unauthenticated-readable table).
import { supabase } from './supabaseClient.js';
import { loadLabelOverrides, applyStaticTranslations } from './i18n.js';
import { renderPastorBookingCalendar } from './components/pastorBookingCalendar.js';

async function main() {
  // Best-effort -- menu_labels has never been read by an anonymous
  // visitor before now; if RLS or anything else about that turns out
  // unfriendly to the anon role, the built-in TRANSLATIONS dictionary
  // (t()'s fallback) is a perfectly fine default, not worth blocking
  // the actual booking calendar below over.
  try {
    await loadLabelOverrides();
  } catch { /* fall through to built-in translations */ }
  applyStaticTranslations();

  const container = document.querySelector('#booking-content');
  renderPastorBookingCalendar(container, {
    supabase,
    currentUserProfile: null, // always a guest here -- collects name/email/phone
    onBooked: () => {},
  });
}

main();
