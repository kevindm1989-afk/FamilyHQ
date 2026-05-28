/**
 * Family Management service (Phase 4 — Family Management screen; ADR-0002).
 *
 * SIGNATURES ONLY. The test-writer authors this file to PIN the EXACT payload
 * shapes the firestore.rules contract requires (`affectedKeys().hasOnly(
 * ['name','isActive'])`). The implementer replaces each `throw new Error(
 * 'not implemented')` body with the real logic; the implementer MUST NOT
 * change these signatures / exported constants without updating the tests.
 *
 * SECURITY-CRITICAL payload contract:
 *  - renameMember     writes EXACTLY `{ name: <trimmed> }` to users/{uid}.
 *  - setMemberActive  writes EXACTLY `{ isActive: <boolean> }` to users/{uid}.
 *  Neither path may spread/merge the full user doc, never include role /
 *  familyId / email / allowanceBalance / theme. A failed validation surfaces
 *  through FamilyManagementError carrying the generic PII-free copy
 *  (FAMILY_GENERIC_ERROR); the raw Firebase text and the member name/uid never
 *  leak.
 *
 * Mirrors the choresParentService.ts shape (typed input, exported success-copy
 * constants, an ActionError class, updateDoc -> generic error mapping).
 */
import { doc, updateDoc, type Firestore } from 'firebase/firestore';

const USERS_COLLECTION = 'users';

/** Generic user-safe error — never leaks raw Firebase text / PII (name, uid). */
export const FAMILY_GENERIC_ERROR = 'Something went wrong. Please try again.';

/** Success toast copy. */
export const RENAME_SUCCESS = 'Name updated.';
export const MEMBER_DEACTIVATED = 'Member deactivated.';
export const MEMBER_REACTIVATED = 'Member reactivated.';

/** Maximum name length the service accepts (chars, post-trim). */
export const NAME_MAX_LENGTH = 60;

/** Family-management action error — generic, user-safe. */
export class FamilyManagementError extends Error {
  constructor(message: string = FAMILY_GENERIC_ERROR) {
    super(message);
    this.name = 'FamilyManagementError';
  }
}

/**
 * Rename a family member. Writes EXACTLY `{ name: <trimmed> }` to users/{uid}
 * — never any other field (the rules contract is hasOnly(['name','isActive'])
 * and this path is the name-only branch). Trims surrounding whitespace; rejects
 * an empty / whitespace-only / over-length (`> NAME_MAX_LENGTH`) name BEFORE
 * any write with FamilyManagementError (generic copy). Maps any Firestore
 * failure to the same generic PII-free error.
 */
export async function renameMember(
  _deps: { db: Firestore },
  _uid: string,
  _name: string,
): Promise<void> {
  // Reference imports so unused-warnings stay quiet; the implementer fills in.
  void doc;
  void updateDoc;
  void USERS_COLLECTION;
  throw new Error('not implemented');
}

/**
 * (De)activate a family member. Writes EXACTLY `{ isActive: <boolean> }` to
 * users/{uid} — never any other field (the rules contract is
 * hasOnly(['name','isActive']) and this path is the isActive-only branch).
 * Maps any Firestore failure to the generic PII-free error.
 *
 * The UI never offers self-deactivation or parent-on-parent deactivation in
 * v1 (rules block self anyway; the last-active-parent invariant is a deferred
 * Cloud Function). This service is intentionally agnostic to those UI gates —
 * its single contract is the exact payload shape.
 */
export async function setMemberActive(
  _deps: { db: Firestore },
  _uid: string,
  _isActive: boolean,
): Promise<void> {
  throw new Error('not implemented');
}
