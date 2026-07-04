/**
 * Managed (email-less) child accounts feature flag
 * (docs/specs/managed-child-accounts.md §7).
 *
 * Strict-equality contract with the literal string "true" — no truthiness
 * games ("1", "yes", "True", " true ", "" all return false), mirroring
 * `isPushNotificationsEnabled` in ../notifications/featureFlag.ts. When OFF,
 * callers hide the "Add a child" affordance in Family Management and the
 * "Kid sign-in" tab on the login screen. This is a CLIENT UX gate only: the
 * createManagedChild / resetManagedChildPassword callables enforce App Check +
 * parent authorization server-side regardless of this flag.
 *
 * Kept dependency-free on purpose (same rationale as the notifications flag):
 * so the login/app shell can import the predicate without pulling in any
 * Firebase SDK. Do NOT add a Firebase import here.
 */
export function isManagedChildEnabled(): boolean {
  return import.meta.env.VITE_MANAGED_CHILD_ENABLED === 'true';
}
