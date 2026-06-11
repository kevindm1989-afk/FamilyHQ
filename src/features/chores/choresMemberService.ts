/**
 * Chores member service (Phase 3, Task 10; handoff #05 ChoresTeenScreen;
 * ADR-0001/0002/0004; threat-model T1.4/M4, T1.8/M8). Mirrors boardService /
 * calendarService.
 *
 * The member view is READ-OWN + MARK-COMPLETE only. The ONLY mutation a member
 * may make to their own chore is the status transition `pending -> complete`
 * (firestore.rules `memberLegalCompletion`, proven by test/rules/chores-*.ts).
 * There are NO approval or allowanceBalance writes in this feature — approval
 * and the allowance credit transaction are the parent flow (Task 11, ADR-0004).
 *
 * STATUS-BADGE RECONCILIATION (flagged): the design lists FIVE badge colours
 * but ChoreStatus is a FOUR-value enum (pending|complete|approved|rejected). We
 * map `complete` -> the amber "waiting for approval" state. statusBadgeClass is
 * the single source of truth for the 4 mappings + a SAFE fallback for an unknown
 * value.
 *
 * NO-INTERPOLATION CONTRACT (lessons.md Tailwind lesson; Badge.tsx TONE_CLASS /
 * calendar TAG_DOT_CLASS): the badge tone class MUST come from a STATIC literal
 * map of full class strings — a `bg-${status}` template is not statically
 * analysable by Tailwind's JIT, so the rule would never be emitted.
 */
import { doc, updateDoc, type Firestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { Chore, ChoreStatus } from '../../lib/types';

/** A chore enriched with its document id for list rendering + mark-complete. */
export interface ChoreWithId extends Chore {
  id: string;
}

/** User-safe copy the service surfaces; asserted by the tests. */
export const CHORE_COMPLETE_SUCCESS = 'Marked complete — waiting for approval';
export const CHORE_GENERIC_ERROR = 'Something went wrong. Please try again.';

/** A generic, user-safe error — never leaks a raw Firebase code or PII. */
export class ChoreActionError extends Error {
  constructor(message: string = CHORE_GENERIC_ERROR) {
    super(message);
    this.name = 'ChoreActionError';
  }
}

const CHORES_COLLECTION = 'chores';

/**
 * Transition a member's OWN chore from `pending` to `complete`. Writes ONLY the
 * status field (firestore.rules forbid touching pointValue/dollarValue/
 * assignedTo/familyId/createdBy — touching any of those denies the whole
 * update). Maps any Firestore failure to CHORE_GENERIC_ERROR (PII-free; never
 * the raw provider text nor the chore id).
 */
export async function markComplete(deps: { db: Firestore }, choreId: string): Promise<void> {
  try {
    await updateDoc(doc(deps.db, CHORES_COLLECTION, choreId), { status: 'complete' });
  } catch {
    // Never surface a raw Firebase code / PII (or the chore id) to the caller.
    throw new ChoreActionError();
  }
  // PR D1: fire-and-forget the notifyChoreSubmitted callable AFTER the
  // transactional write has landed. The callable's failure must NEVER
  // undo the mark-complete — push is non-essential (ADR-0014); the
  // in-app inbox is the source of truth. Both a sync throw at
  // `httpsCallable(...)` lookup time AND an async rejection from the
  // callable invocation are swallowed here; M39 keeps any raw provider
  // text out of the surface. The payload is EXACTLY `{ choreId }` — no
  // kid uid, no amount, no chore title (the server re-derives
  // everything it needs).
  try {
    const fns = getFunctions();
    const fn = httpsCallable<
      { choreId: string },
      { sent: number; cleaned?: number; reason?: string }
    >(fns, 'notifyChoreSubmitted');
    await fn({ choreId });
  } catch {
    // Intentionally swallowed — push is fire-and-forget.
  }
}

/**
 * STATIC lookup from a chore status to its FULL literal badge tone class (the
 * Badge `tone` value literals, mirroring Badge.tsx TONE_CLASS). The full literal
 * strings are what make the token utilities visible to Tailwind's JIT — a
 * `bg-${status}` template is NOT statically analysable, so the rule would never
 * be emitted and the badge would lose its colour in production.
 *
 *  - pending  -> muted/grey  (mute tone)
 *  - complete -> amber       ("waiting for approval")
 *  - approved -> green       (ok tone)
 *  - rejected -> red         (danger tone)
 */
const STATUS_BADGE_CLASS: Record<ChoreStatus, string> = {
  pending: 'bg-surface-line2 text-ink-2',
  complete: 'bg-accent-light text-accent-dark',
  approved: 'bg-status-ok-light text-status-ok-text',
  rejected: 'bg-status-danger-light text-status-danger-text',
};

/**
 * Pure mapping from a chore status to its full literal badge tone class.
 *
 * An UNKNOWN/invalid status (stale cache, a future schema value) falls SAFE to a
 * real literal token class (the muted/pending tone) — never `undefined`, empty,
 * or an interpolated non-token like `bg-${status}`.
 */
export function statusBadgeClass(status: ChoreStatus): string {
  return STATUS_BADGE_CLASS[status] ?? STATUS_BADGE_CLASS.pending;
}
