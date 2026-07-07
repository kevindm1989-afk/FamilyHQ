/**
 * Managed-child synthetic sign-in address — pure helper
 * (docs/specs/managed-child-accounts.md §3).
 *
 * Kept dependency-free ON PURPOSE (no Firebase import): the LoginScreen is the
 * cold-load entry point and must not pull the Firebase SDK into its bundle, but
 * it needs to compose a child's sign-in address from the family code + username
 * the child types. The createManagedChild callable composes the SAME string
 * server-side; both sides are pinned by tests.
 *
 * `.familyhq.invalid` is the IETF-reserved TLD (RFC 2606): it can never resolve
 * in DNS, so this address is a login identifier only, never a routable mailbox.
 */

/** Synthetic-address suffix. MUST match functions/src/createManagedChild.ts. */
export const CHILD_LOGIN_EMAIL_DOMAIN = 'familyhq.invalid';

/** Parent-chosen child username: 2–20 lowercase letters or digits. */
export const CHILD_HANDLE_RE = /^[a-z0-9]{2,20}$/;

/**
 * Minimum child password length (matches the server-side check in
 * functions/src/createManagedChild.ts + resetManagedChildPassword.ts). Lives
 * here (not managedChildService) so UI that only VALIDATES — the reset sheet,
 * the login screen — can import it without pulling firebase/functions into
 * its chunk.
 */
export const CHILD_MIN_PASSWORD_LENGTH = 8;

/**
 * Compose the managed child's synthetic sign-in address from the family login
 * code + the child's handle. Inputs are normalised (trimmed, lower-cased) so a
 * child can type "OTTER42 / Maya" and still reproduce the exact address the
 * server minted at creation. Pure — no I/O.
 */
export function composeChildLoginEmail(loginCode: string, handle: string): string {
  const code = loginCode.trim().toLowerCase();
  const h = handle.trim().toLowerCase();
  return `${h}@${code}.${CHILD_LOGIN_EMAIL_DOMAIN}`;
}
