/**
 * CONTRACT STUB — My-chores feed hook (Phase 3, Task 10; handoff #05a
 * ChoresTeenScreen; threat-model P2/M7). Mirrors useFamilyEvents / useFamilyPosts.
 *
 * Signatures only, NO logic. The member view shows ONLY the logged-in member's
 * own chores: the query is scoped with BOTH equality filters the rules allow —
 * `where('familyId','==', familyId)` AND `where('assignedTo','==', uid)`. Never
 * an unconstrained or cross-assignee/cross-family query.
 *
 * Returns `{ chores, loading, error, refresh }`. `createdAt` (and a pending
 * serverTimestamp -> ~now) is Timestamp->millis converted via a toMillis helper
 * so a Timestamp object never reaches the UI (lessons.md Timestamp->millis).
 * `dueDate` is a plain ISO STRING (mirrors events `date`) and is surfaced as-is.
 *
 * Clears chores on a uid OR familyId CHANGE — not only when null — so one
 * member's chores never linger while another member's list loads.
 *
 * COMPOSITE INDEX NOTE (implementer): a query with two equality filters
 * (familyId + assignedTo) plus any orderBy may require a composite index in
 * firestore.indexes.json. Flagged here; not blocking the tests (the SDK mock
 * does not enforce indexes).
 */
import type { ChoreWithId } from './choresMemberService';

export interface UseMyChoresResult {
  chores: ChoreWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export declare function useMyChores(
  uid: string | null,
  familyId: string | null,
): UseMyChoresResult;
