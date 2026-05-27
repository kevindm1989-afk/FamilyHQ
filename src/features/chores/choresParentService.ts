/**
 * Chores PARENT service — CONTRACT STUB (Phase 3, Task 11; ADR-0004; handoff
 * #05b ChoresParentScreen + #06 AddChoreScreen; threat-model M27/M28/F4).
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
import type { Firestore } from 'firebase/firestore';
import type { RecurrenceFrequency, Role, UserWithId } from '../../lib/types';
import type { ChoreWithId } from './choresMemberService';

export { ChoreActionError, type ChoreWithId } from './choresMemberService';

/** User-safe copy the parent flows surface; asserted by the tests. */
export const CHORE_APPROVE_SUCCESS = 'Approved — allowance updated.';
export const CHORE_REJECT_SUCCESS = 'Sent back to try again.';
export const CHORE_ADD_SUCCESS = 'Chore added.';
export const CHORE_PARENT_GENERIC_ERROR = 'Something went wrong. Please try again.';

/**
 * Approve a COMPLETE chore in ONE Firestore transaction (ADR-0004). Re-reads the
 * chore inside the transaction and ABORTS unless status=='complete' && the
 * chore is in the caller's family; otherwise sets status='approved', increments
 * the assignee's allowanceBalance by dollarValue, and appends one earning
 * transaction doc — atomically. Idempotent: a second approve sees status !=
 * 'complete' and aborts (no double credit). Maps any failure to the generic
 * PII-free error (never the raw Firebase text nor the chore id).
 */
export function approveChore(_deps: { db: Firestore }, _choreId: string): Promise<void> {
  throw new Error('not implemented');
}

/**
 * Reject a chore: set status='rejected' + the parent's rejectionReason. NO
 * balance change, NO ledger doc. The reason is trimmed and a blank/whitespace-
 * only reason is REJECTED (throws ChoreActionError) BEFORE any write. Maps any
 * failure to the generic PII-free error.
 */
export function rejectChore(
  _deps: { db: Firestore },
  _choreId: string,
  _reason: string,
): Promise<void> {
  throw new Error('not implemented');
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
export function addChore(_deps: { db: Firestore }, _input: CreateChoreInput): Promise<void> {
  throw new Error('not implemented');
}

/**
 * PURE SELECTOR — the count of chores awaiting approval (status=='complete').
 * Drives the nav/approval-queue badge. No side effects, no clock.
 */
export function pendingApprovalCount(_chores: ChoreWithId[]): number {
  throw new Error('not implemented');
}

/**
 * PURE SELECTOR — chores awaiting approval (status=='complete'), for the
 * approvals queue list.
 */
export function approvalQueue(_chores: ChoreWithId[]): ChoreWithId[] {
  throw new Error('not implemented');
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

export function memberFilterTabs(_members: UserWithId[]): MemberTab[] {
  throw new Error('not implemented');
}

/**
 * PURE SELECTOR — filter a chore list to a selected tab. The "All" sentinel
 * returns every chore; any other id returns only chores assignedTo that uid.
 */
export function choresForTab(_chores: ChoreWithId[], _tabId: string): ChoreWithId[] {
  throw new Error('not implemented');
}

/**
 * PURE UI-permission derivation (mirrors the firestore.rules chore-write rule):
 * only a PARENT may create/approve/reject chores. Cosmetic affordance — the
 * server rule is authoritative.
 */
export function canManageChores(_viewer: { role: Role }): boolean {
  throw new Error('not implemented');
}
