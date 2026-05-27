/**
 * CONTRACT STUB — Chores member screen (Phase 3, Task 10; handoff #05a
 * ChoresTeenScreen).
 *
 * Signature only. The implementer builds the screen to satisfy
 * ChoresMemberScreen.test.tsx (test-writer-owned; do not edit to fit).
 *
 * Designer-defined states this screen must render (see test "state traceability"):
 *  - LOADING            -> Skeleton (role="status", aria-busy)
 *  - EMPTY              -> friendly EmptyState (no chores assigned)
 *  - EARNINGS card      -> the member's current allowanceBalance, prominent
 *  - PENDING section    -> chore rows WITH a "Mark done" button
 *  - WAITING section    -> complete chores, "waiting for approval" (no button)
 *  - APPROVED section   -> approved chores, strike-through + "$X earned"
 *  - REJECTED           -> shows the parent's rejectionReason (no button)
 *  - RECURRING          -> a recurrence-frequency badge when isRecurring
 *  - status BADGE       -> tone from the STATIC statusBadgeClass map
 *
 * Feed state + actions are INJECTED so the screen renders deterministically
 * without Firestore. firestore.rules is the real authority boundary.
 *
 * DEFERRED ("earned this month"): the monthly-earnings sub-line depends on the
 * transactions ledger (Allowance History, not built yet). This screen shows the
 * BALANCE only; it must NOT compute month sums or read transactions. A "View
 * history" affordance is acceptable but optional.
 */
import { type ReactElement } from 'react';
import type { Role } from '../../lib/types';
import type { ChoreWithId } from './choresMemberService';

export interface ChoresMemberScreenProps {
  familyId: string | null;
  viewer: { uid: string; name: string; role: Role; allowanceBalance: number };
  feed: {
    chores: ChoreWithId[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  };
  /** Injected mark-complete action (wired to choresMemberService.markComplete + toast). */
  onMarkComplete: (choreId: string) => Promise<void>;
}

export declare function ChoresMemberScreen(props: ChoresMemberScreenProps): ReactElement;
