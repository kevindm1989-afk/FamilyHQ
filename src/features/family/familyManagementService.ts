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
 * F13 — family timezone update:
 *  - setFamilyTimezone writes EXACTLY `{ timezone: <string> }` to
 *    families/{familyId}. The firestore.rules `timezoneFieldValid()` predicate
 *    requires the value to be a string ≤ 50 chars; parent-only via the outer
 *    `isParent()` gate. Service mirrors the same shape: validate type +
 *    length BEFORE any write, map every failure to FamilyManagementError,
 *    never echo the raw Firebase text or the familyId.
 *
 * Mirrors the choresParentService.ts shape (typed input, exported success-copy
 * constants, an ActionError class, updateDoc -> generic error mapping).
 */
import { doc, updateDoc, type Firestore } from 'firebase/firestore';

const USERS_COLLECTION = 'users';
const FAMILIES_COLLECTION = 'families';

/** Generic user-safe error — never leaks raw Firebase text / PII (name, uid). */
export const FAMILY_GENERIC_ERROR = 'Something went wrong. Please try again.';

/** Success toast copy. */
export const RENAME_SUCCESS = 'Name updated.';
export const MEMBER_DEACTIVATED = 'Member deactivated.';
export const MEMBER_REACTIVATED = 'Member reactivated.';
/** Success toast copy for an F13 timezone update. */
export const TIMEZONE_UPDATED = 'Family timezone updated.';

/** Maximum name length the service accepts (chars, post-trim). */
export const NAME_MAX_LENGTH = 60;

/**
 * Maximum timezone length the service accepts. Mirrors the firestore.rules
 * `timezoneFieldValid()` cap (≤ 50 chars).
 */
export const TIMEZONE_MAX_LENGTH = 50;

/**
 * Canonical Canadian timezone shortlist offered by the F13 settings UI
 * (covers ~95% of real users). The runtime `families.timezone` value MAY be
 * any of these OR a legacy string outside the shortlist; the screen surfaces
 * a "(current)" option for the latter so a parent is never trapped on an
 * unlisted value. The first entry is the universal default written by
 * `authService.ts` at family bootstrap.
 */
export const TIMEZONE_OPTIONS = [
  'America/Toronto',
  'America/Vancouver',
  'America/Edmonton',
  'America/Halifax',
  'America/St_Johns',
] as const;

export type TimezoneOption = (typeof TIMEZONE_OPTIONS)[number];

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

/**
 * F13 — update the family timezone. Writes EXACTLY `{ timezone: <string> }`
 * to families/{familyId} — never any other field (the rules contract is
 * `timezoneFieldValid()` plus parent-only outer gate; affectedKeys
 * intentionally NOT pinned in the family rule, but the service stays narrow
 * so a future tightening just works).
 *
 * Validates BEFORE any write:
 *  - timezone must be a string (TS escape hatches via `unknown as string`
 *    map to FamilyManagementError, never a raw TypeError).
 *  - trimmed length 1..TIMEZONE_MAX_LENGTH (matches the rules cap of 50).
 * IANA-shape validation is intentionally NOT enforced here — the rules
 * cannot load a tz database either; the runtime sweep (PR F §14.2 / M50)
 * falls back to `America/Toronto` on invalid values, and the screen
 * constrains the chooser to a shortlist + the existing value.
 *
 * Surfaces only the generic PII-free copy on any failure (never echoes
 * the raw Firebase text or the familyId).
 */
export async function setFamilyTimezone(
  deps: { db: Firestore },
  familyId: string,
  timezone: string,
): Promise<void> {
  try {
    if (typeof timezone !== 'string') {
      throw new FamilyManagementError();
    }
    const trimmed = timezone.trim();
    if (trimmed.length === 0 || trimmed.length > TIMEZONE_MAX_LENGTH) {
      throw new FamilyManagementError();
    }
    if (typeof familyId !== 'string' || familyId.length === 0) {
      throw new FamilyManagementError();
    }
    // EXACT payload — only `timezone`. Never spread the full family doc;
    // never include familyName / createdBy / createdAt.
    await updateDoc(doc(deps.db, FAMILIES_COLLECTION, familyId), {
      timezone: trimmed,
    });
  } catch (err) {
    if (err instanceof FamilyManagementError) throw err;
    throw new FamilyManagementError();
  }
}
