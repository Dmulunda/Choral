// Confirmed via supabase-js's own source (auth-js's _recoverAndRefresh,
// called from its internal visibilitychange handler): every time this
// tab regains visibility with a still-valid, not-near-expiry session,
// it unconditionally fires a 'SIGNED_IN' auth event -- indistinguishable
// by event name alone from a real, interactive login. app.js's
// onAuthStateChange handler previously guessed "fresh sign-in" from
// firing order (first callback vs. later ones), which wrongly treated
// every one of these spurious on-focus SIGNED_IN events as fresh too,
// forcing a Super Admin/Secretary back to Home on every tab switch.
//
// authScreen.js (and any other place that calls supabase.auth.signUp()/
// signInWithPassword() on the main client) calls markInteractiveSignIn()
// right before making that call; app.js's onAuthStateChange consumes
// (reads and clears) it the moment the next SIGNED_IN event fires,
// treating only that one as a genuine fresh sign-in.
let pendingInteractiveSignIn = false;

export function markInteractiveSignIn() {
  pendingInteractiveSignIn = true;
}

export function consumeInteractiveSignIn() {
  const was = pendingInteractiveSignIn;
  pendingInteractiveSignIn = false;
  return was;
}
