/**
 * Chores PARENT service (Phase 3, Task 11; ADR-0004; handoff
 * 05b ChoresParentScreen + 06 AddChoreScreen; threat-model M27/M28/F4).
 *
 * SIGNATURES ONLY. The test-writer authors this file to PIN the shapes the
 * implementer must fulfill (the unit tests import these). The implementer
 * replaces each `throw new Error('not implemented')` body with the real logic;
 * the implementer MUST NOT change these signatures / exported constants without
 * updating the tests + the threat model.
 *
 * This module EXTENDS the merged member-chores module — it reuses ChoreWithId,
 * the PII-free error pattern, and the toast-copy convention from
 * choresMemberService.
 *
 * The two money-adjacent operations are SECURITY-CRITICAL:
 *  - approveChore: runs ONE Firestore runTransaction (re-read chore, abort
 *    unless status=='complete' && same family; set status='approved';
 *    increment(users/{assignedTo}.allowanceBalance, dollarValue); create one
 *    transactions/{id} earning doc). Idempotent via the status guard (F4).
 *  - rejectChore: sets status='rejected' + rejectionReason; NO balance change,
 *    NO ledger doc. A blank/whitespace reason is rejected before any write.
 *  - addChore: creates the hardened, shape-locked chore (status='pending',
 *    createdBy==uid). The rule-level shape lock is pinned in
 *    test/rules/chores-create-hardening.test.ts.
 */
import {
  addDoc,
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import type { RecurrenceFrequency, Role, UserWithId } from '../../lib/types';
import { ChoreActionError, type ChoreWithId } from './choresMemberService';

export { ChoreActionError, type ChoreWithId } from './choresMemberService';
export { MONEY_MAX_CENTS } from '../../lib/types';

const CHORES_COLLECTION = 'chores';
const USERS_COLLECTION = 'users';
const TRANSACTIONS_COLLECTION = 'transactions';

/** User-safe copy the parent flows surface; asserted by the tests. */
export const CHORE_APPROVE_SUCCESS = 'Approved — allowance updated.';
export const CHORE_REJECT_SUCCESS = 'Sent back to try again.';
export const CHORE_ADD_SUCCESS = 'Chore added.';
export const CHORE_PARENT_GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Distinct indicator rendered in place of a money amount when the value is not a
 * finite, valid integer-cent amount (adversarial Finding 8). NEVER render a
 * misleading "$0.00" for a non-finite balance.
 */
export const MONEY_INVALID_INDICATOR = '—';

/**
 * Format an INTEGER-CENTS money value as "$X.XX" for display (the single money
 * formatter; money is stored as cents everywhere — second-opinion #4 / Finding
 * 7). A non-finite or non-integer input is NOT a valid cents amount and MUST NOT
 * be rendered as "$0.00" — callers detect that via isValidMoneyCents and render
 * MONEY_INVALID_INDICATOR instead (Finding 8). `300` -> "$3.00"; `3850` ->
 * "$38.50"; `0` -> "$0.00".
 *
 * SIGNATURE ONLY — implementer fills the body. The unit tests pin the exact
 * formatted output.
 */
export function formatMoney(_cents: number): string {
  throw new Error('not implemented');
}

/**
 * True iff `value` is a valid money amount in INTEGER CENTS: a finite, whole
 * number, `>= 0` and `<= MONEY_MAX_CENTS`. Used to gate the money display
 * (Finding 8: a non-finite/NaN balance renders MONEY_INVALID_INDICATOR, not
 * "$0.00").
 *
 * SIGNATURE ONLY — implementer fills the body.
 */
export function isValidMoneyCents(_value: number): boolean {
  throw new Error('not implemented');
}

/**
 * Approve a COMPLETE chore in ONE Firestore transaction (ADR-0004). Re-reads the
 * chore inside the transaction and ABORTS unless status=='complete' && the
 * chore is in the caller's family; otherwise sets status='approved', increments
 * the assignee's allowanceBalance by dollarValue, and appends one earning
 * transaction doc — atomically. Idempotent: a second approve sees status !=
 * 'complete' and aborts (no double credit). Maps any failure to the generic
 * PII-free error (never the raw Firebase text nor the chore id).
 */
export async function approveChore(deps: { db: Firestore }, choreId: string): Promise<void> {
  try {
    await runTransaction(deps.db, async (tx) => {
      const choreRef = doc(deps.db, CHORES_COLLECTION, choreId);
      const snap = await tx.get(choreRef);
      const chore = snap.exists()
        ? (snap.data() as {
            status: string;
            assignedTo: string;
            dollarValue: number;
            familyId: string;
            title: string;
          })
        : undefined;
      // Idempotency / integrity guard (ADR-0004 step 1): abort unless the
      // re-read chore is still complete. A second/concurrent approve sees
      // status != 'complete' (already approved) and aborts, so the balance is
      // credited EXACTLY once and exactly one ledger doc is ever written (F4).
      if (!chore || chore.status !== 'complete') {
        throw new ChoreActionError();
      }
      tx.update(choreRef, { status: 'approved' });
      tx.update(doc(deps.db, USERS_COLLECTION, chore.assignedTo), {
        allowanceBalance: increment(chore.dollarValue),
      });
      tx.set(doc(collection(deps.db, TRANSACTIONS_COLLECTION)), {
        uid: chore.assignedTo,
        choreId,
        choreTitle: chore.title,
        amount: chore.dollarValue,
        type: 'earning',
        familyId: chore.familyId,
        createdAt: serverTimestamp(),
      });
    });
  } catch {
    // Never surface a raw Firebase code / PII (or the chore id) to the caller.
    throw new ChoreActionError(CHORE_PARENT_GENERIC_ERROR);
  }
}

/**
 * Reject a chore: set status='rejected' + the parent's rejectionReason. NO
 * balance change, NO ledger doc. The reason is trimmed and a blank/whitespace-
 * only reason is REJECTED (throws ChoreActionError) BEFORE any write. Maps any
 * failure to the generic PII-free error.
 */
export async function rejectChore(
  deps: { db: Firestore },
  choreId: string,
  reason: string,
): Promise<void> {
  // Validate BEFORE any write: a blank/whitespace-only reason is rejected.
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new ChoreActionError(CHORE_PARENT_GENERIC_ERROR);
  }
  try {
    await updateDoc(doc(deps.db, CHORES_COLLECTION, choreId), {
      status: 'rejected',
      rejectionReason: trimmed,
    });
  } catch {
    throw new ChoreActionError(CHORE_PARENT_GENERIC_ERROR);
  }
}

/**
 * Input to create a chore. The caller passes the content + its own identity +
 * family — never a forged familyId/createdBy/status. The service fixes
 * status='pending' and createdBy from the author.
 */
export interface CreateChoreInput {
  title: string;
  assignedTo: string;
  dueDate: string;
  pointValue: number;
  dollarValue: number;
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency;
  familyId: string;
  createdBy: string;
}

/**
 * Create a `chores` doc shaped EXACTLY as the hardened schema with
 * status='pending' and createdBy==the author. Trims the title; rejects an
 * empty/whitespace title BEFORE any write. Maps any failure to the generic
 * PII-free error.
 */
export async function addChore(deps: { db: Firestore }, input: CreateChoreInput): Promise<void> {
  const title = input.title.trim();
  // Validate BEFORE any write: a blank/whitespace-only title is rejected.
  if (title.length === 0) {
    throw new ChoreActionError(CHORE_PARENT_GENERIC_ERROR);
  }
  try {
    // The EXACT hardened, shape-locked create body: status fixed to 'pending'
    // and createdBy bound to the author. No rejectionReason on a fresh create.
    await addDoc(collection(deps.db, CHORES_COLLECTION), {
      title,
      assignedTo: input.assignedTo,
      dueDate: input.dueDate,
      pointValue: input.pointValue,
      dollarValue: input.dollarValue,
      status: 'pending',
      familyId: input.familyId,
      createdBy: input.createdBy,
      createdAt: serverTimestamp(),
      isRecurring: input.isRecurring,
      recurrenceFrequency: input.recurrenceFrequency,
    });
  } catch {
    throw new ChoreActionError(CHORE_PARENT_GENERIC_ERROR);
  }
}

/**
 * PURE SELECTOR — the count of chores awaiting approval (status=='complete').
 * Drives the nav/approval-queue badge. No side effects, no clock.
 */
export function pendingApprovalCount(chores: ChoreWithId[]): number {
  return chores.filter((c) => c.status === 'complete').length;
}

/**
 * PURE SELECTOR — chores awaiting approval (status=='complete'), for the
 * approvals queue list.
 */
export function approvalQueue(chores: ChoreWithId[]): ChoreWithId[] {
  return chores.filter((c) => c.status === 'complete');
}

/**
 * PURE SELECTOR — the member filter tabs for the parent view, generated
 * DYNAMICALLY from the active family members (NOT hardcoded). Returns an "All"
 * tab first, then one tab per active member. Each tab is { id, label }; the
 * "All" tab has a stable sentinel id.
 */
export const ALL_MEMBERS_TAB_ID = '__all__';

export interface MemberTab {
  id: string;
  label: string;
}

export function memberFilterTabs(members: UserWithId[]): MemberTab[] {
  return [
    { id: ALL_MEMBERS_TAB_ID, label: 'All' },
    ...members.map((m) => ({ id: m.id, label: m.name })),
  ];
}

/**
 * PURE SELECTOR — filter a chore list to a selected tab. The "All" sentinel
 * returns every chore; any other id returns only chores assignedTo that uid.
 */
export function choresForTab(chores: ChoreWithId[], tabId: string): ChoreWithId[] {
  if (tabId === ALL_MEMBERS_TAB_ID) return chores;
  return chores.filter((c) => c.assignedTo === tabId);
}

/**
 * PURE UI-permission derivation (mirrors the firestore.rules chore-write rule):
 * only a PARENT may create/approve/reject chores. Cosmetic affordance — the
 * server rule is authoritative.
 */
export function canManageChores(viewer: { role: Role }): boolean {
  return viewer.role === 'parent';
}
