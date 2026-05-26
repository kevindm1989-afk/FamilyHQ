/**
 * CONTRACT — family context (Task 7, system-design §2.6).
 *
 * Signatures only. Provides the caller's own user doc (incl. role + familyId)
 * and the live list of ACTIVE members of the caller's family — derived from the
 * `users` collection scoped to the caller's familyId (never cross-family;
 * deactivated members excluded — they must not appear in member pickers/lists).
 *
 * `role` here is for UI affordances only; firestore.rules enforce authority.
 */
import type { ReactElement, ReactNode } from 'react';
import type { Role, UserWithId } from '../lib/types';

export interface FamilyState {
  familyId: string | null;
  role: Role | null;
  /** The caller's own user doc, or null while loading / signed out. */
  currentUser: UserWithId | null;
  /** ACTIVE members of the caller's family only (deactivated excluded). */
  members: UserWithId[];
  loading: boolean;
}

export declare function FamilyProvider(props: { children: ReactNode }): ReactElement;

export declare function useFamily(): FamilyState;

/**
 * Pure derivation helper the provider uses: given a raw users list, keep only
 * active members of the target family. Exposed so it is unit-testable without a
 * live Firestore.
 */
export declare function deriveActiveMembers(
  allUsers: UserWithId[],
  familyId: string,
): UserWithId[];
