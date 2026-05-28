/**
 * Family Management service (Phase 4 — Family Management screen; ADR-0002).
 *
 * SECURITY-CRITICAL payload contract (firestore.rules
 * `affectedKeys().hasOnly(['name','isActive'])`):
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
  deps: { db: Firestore },
  uid: string,
  name: string,
): Promise<void> {
  try {
    // Sec2 — the validation/trim runs INSIDE the try so a non-string `name`
    // (TS escape hatch via `unknown as string`, e.g. number / null /
    // undefined / object) maps to FamilyManagementError, NOT a raw TypeError
    // from `(undefined).trim()`. Every failure path surfaces the generic
    // PII-free copy.
    if (typeof name !== 'string') {
      throw new FamilyManagementError();
    }
    const trimmed = name.trim();
    // Validate BEFORE any write — a blank/whitespace-only or over-length name
    // is rejected. Surface ONLY the generic PII-free copy (never the raw
    // input/uid).
    if (trimmed.length === 0 || trimmed.length > NAME_MAX_LENGTH) {
      throw new FamilyManagementError();
    }
    // EXACT payload — only `name`. Never spread the full user doc; never
    // include role / familyId / email / allowanceBalance / theme. The rules
    // contract is `affectedKeys().hasOnly(['name','isActive'])`.
    await updateDoc(doc(deps.db, USERS_COLLECTION, uid), { name: trimmed });
  } catch (err) {
    // Preserve a real FamilyManagementError (carries the generic copy already);
    // re-wrap anything else (raw Firebase code, TypeError, etc.) into the
    // generic PII-free error.
    if (err instanceof FamilyManagementError) throw err;
    throw new FamilyManagementError();
  }
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
  deps: { db: Firestore },
  uid: string,
  isActive: boolean,
): Promise<void> {
  try {
    // Sec3 — a TS escape hatch (`'true' as unknown as boolean`) must NOT
    // round-trip into Firestore as a string. Reject any non-boolean BEFORE
    // updateDoc with the generic PII-free error.
    if (typeof isActive !== 'boolean') {
      throw new FamilyManagementError();
    }
    await updateDoc(doc(deps.db, USERS_COLLECTION, uid), { isActive });
  } catch (err) {
    if (err instanceof FamilyManagementError) throw err;
    throw new FamilyManagementError();
  }
}
