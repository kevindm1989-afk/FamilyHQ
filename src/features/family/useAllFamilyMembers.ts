/**
 * All-family-members feed hook (Phase 4 — Family Management screen).
 *
 * Approach (test-writer decision, pinned by useAllFamilyMembers.test.tsx):
 * a NEW hook file (not an extension of useFamily) mirroring useFamilyChores's
 * shape — `{ members, loading, error, refresh }`, lazy `firebase/config`
 * import, monotonic refresh-token coordination, clears on familyId change,
 * null familyId -> no query. Family Management is a parent-only screen and
 * needs INACTIVE members visible so the parent can reactivate them — that is
 * NOT the same query useFamily already runs (which filters to active members
 * via deriveActiveMembers). Splitting the hook keeps useFamily's contract
 * untouched (every screen still gets ACTIVE-only via useFamily) while this
 * surface adds the all-status feed only to the screen that needs it.
 *
 * Query: `where('familyId','==', familyId)` ONLY — NO `where('isActive',…)`
 * filter (the list MUST include inactive members so the parent can reactivate
 * them). Defense-in-depth: `deriveAllMembers` post-filters by familyId so a
 * prefix-collision in cached docs cannot leak across families.
 *
 * SIGNATURES ONLY — implementer fills the body. The unit test pins the wiring.
 */
import type { UserWithId } from '../../lib/types';

export interface UseAllFamilyMembersResult {
  members: UserWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAllFamilyMembers(_familyId: string | null): UseAllFamilyMembersResult {
  throw new Error('not implemented');
}
