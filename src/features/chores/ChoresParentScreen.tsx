/**
 * Chores PARENT screen — CONTRACT STUB (Phase 3, Task 11; handoff #05b
 * ChoresParentScreen). SIGNATURES ONLY — the implementer builds the body.
 *
 * Designer-defined states the tests pin:
 *  - LOADING            -> Skeleton (role="status")
 *  - EMPTY (no chores)  -> friendly EmptyState
 *  - APPROVALS QUEUE    -> rows of status=='complete' chores with Approve +
 *                          Reject buttons; Reject opens a required reason input
 *  - PENDING-APPROVAL badge -> derived count of complete chores
 *  - BALANCE CHIPS      -> a chip per active member showing allowanceBalance
 *  - MEMBER FILTER TABS -> "All" + one per active member (DYNAMIC); selecting
 *                          filters the list; empty state per tab
 *  - FAB                -> opens Add Chore (parent-only)
 *
 * Feed state + actions are INJECTED so the screen renders deterministically
 * without Firestore. firestore.rules is the real authority boundary.
 */
import type { ReactElement } from 'react';
import type { Role, UserWithId } from '../../lib/types';
import type { ChoreWithId } from './choresMemberService';

export interface ChoresParentScreenProps {
  familyId: string | null;
  viewer: { uid: string; name: string; role: Role };
  /** Active family members — drives the filter tabs + balance chips (dynamic). */
  members: UserWithId[];
  feed: {
    chores: ChoreWithId[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  };
  /** Injected approve action (wired to choresParentService.approveChore + toast). */
  onApprove: (choreId: string) => Promise<void>;
  /** Injected reject action (wired to choresParentService.rejectChore + toast). */
  onReject: (choreId: string, reason: string) => Promise<void>;
  /** Open the Add Chore sheet (FAB). */
  onAddChore: () => void;
}

export function ChoresParentScreen(_props: ChoresParentScreenProps): ReactElement {
  throw new Error('not implemented');
}
