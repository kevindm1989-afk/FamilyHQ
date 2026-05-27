/**
 * CONTRACT STUB — Chores member service (Phase 3, Task 10; handoff #05a
 * ChoresTeenScreen; ADR-0001/0002/0004; threat-model T1.4/M4, T1.8/M8).
 *
 * Signatures only, NO logic (the implementer fills these in to make
 * choresMemberService.test.ts pass; the test file is owned by the test-writer
 * and must NOT be edited to fit the implementation).
 *
 * The member view is READ-OWN + MARK-COMPLETE only. The ONLY mutation a member
 * may make to their own chore is the status transition `pending -> complete`
 * (firestore.rules `memberLegalCompletion`, proven by test/rules/chores-*.ts).
 * There are NO approval or allowanceBalance writes in this feature — approval
 * and the allowance credit transaction are the parent flow (Task 11, ADR-0004).
 *
 * STATUS-BADGE RECONCILIATION (flagged): the design lists FIVE badge colours
 * (pending=grey, complete=amber "waiting for approval", approved=green,
 * rejected=red, plus a 5th tone) but ChoreStatus is a FOUR-value enum
 * (pending|complete|approved|rejected). We map `complete` -> the amber
 * "waiting for approval" state. The 5th design colour has no enum value and is
 * not represented. statusBadgeClass below is the single source of truth for the
 * 4 mappings + a SAFE fallback for an unknown value.
 *
 * NO-INTERPOLATION CONTRACT (lessons.md 2026 Tailwind lesson; Badge.tsx
 * TONE_CLASS / calendar TAG_DOT_CLASS): the badge tone class MUST come from a
 * STATIC literal map of full class strings — a `bg-${status}` template is not
 * statically analysable by Tailwind's JIT, so the rule would never be emitted.
 */
import { type Firestore } from 'firebase/firestore';
import type { Chore, ChoreStatus } from '../../lib/types';

/** A chore enriched with its document id for list rendering + mark-complete. */
export interface ChoreWithId extends Chore {
  id: string;
}

/** A generic, user-safe error — never leaks a raw Firebase code or PII. */
export class ChoreActionError extends Error {
  constructor(message: string = CHORE_GENERIC_ERROR) {
    super(message);
    this.name = 'ChoreActionError';
  }
}

/** User-safe copy the service surfaces; asserted by the tests. */
export const CHORE_COMPLETE_SUCCESS = 'Marked complete — waiting for approval';
export const CHORE_GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Transition a member's OWN chore from `pending` to `complete`. Writes ONLY the
 * status field (firestore.rules forbid touching pointValue/dollarValue/
 * assignedTo). Maps any Firestore failure to CHORE_GENERIC_ERROR (PII-free).
 */
export declare function markComplete(deps: { db: Firestore }, choreId: string): Promise<void>;

/**
 * Pure STATIC mapping from a chore status to its full literal badge tone class
 * (the Badge `tone` value, mirroring Badge.tsx TONE_CLASS keys). Unknown ->
 * a SAFE fallback literal, never undefined/empty/interpolated.
 */
export declare function statusBadgeClass(status: ChoreStatus): string;
