/**
 * Pure family-member derivation (system-design §2.6).
 *
 * Kept Firebase-free so it is unit-testable without initializing the SDK.
 * Re-exported from hooks/useFamily for the documented import surface.
 */
import type { UserWithId } from './types';

/**
 * Keep only ACTIVE members whose familyId EXACTLY equals the target. Exact
 * equality (not prefix) prevents `fam-A` leaking `fam-A10`.
 */
export function deriveActiveMembers(allUsers: UserWithId[], familyId: string): UserWithId[] {
  return allUsers.filter((u) => u.familyId === familyId && u.isActive);
}
