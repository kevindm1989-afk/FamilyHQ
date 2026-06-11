/**
 * Push-notifications feature flag (PR C bonus).
 *
 * Strict-equality contract with the literal string "true". No truthiness
 * games: "1", "yes", "True", "TRUE", " true ", and the empty string all
 * return false. When the flag is OFF, callers must hide the Account-screen
 * link, redirect the notifications route, and skip App Check client
 * initialisation. The server-side callable continues to enforce App Check
 * regardless -- this flag is a client UX gate, not a security boundary.
 *
 * CRITICAL: this module is dependency-free on purpose. Importing the
 * notifications service from AppShell.tsx (per the aborted PR B fix)
 * transitively pulled the entire FCM SDK into the login bundle and blew
 * the AuthedApp-shell bundle budget. The whole point of this file is to
 * give AppShell a cheap predicate it can import WITHOUT paying for the
 * messaging chunk. The contract is enforced by a source-scan test
 * (featureFlag.test.ts) that grep-asserts no Firebase static import
 * appears here -- DO NOT add one, ever. If a new caller needs an FCM
 * initialisation path, do it behind a dynamic await-import inside the
 * caller, not via a static import in this module.
 */
export function isPushNotificationsEnabled(): boolean {
  return import.meta.env.VITE_FCM_ENABLED === 'true';
}
