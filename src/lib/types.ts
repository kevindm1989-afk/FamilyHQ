/**
 * CONTRACT — Family HQ data model (system-design §2.2, ADR-0001/0006).
 *
 * Types only, no logic. This file is authored by the test-writer to PIN the
 * shape the implementer must fulfill (the tests below import these). The
 * implementer may extend with helpers but must not change these field names /
 * unions without updating the tests + the threat model.
 *
 * `familyId` is on every non-`families` doc and is IMMUTABLE from the client
 * (enforced in firestore.rules — see test/rules/). Role naming is parent|member
 * everywhere (the handoff's "teen" maps to "member").
 */

export type Role = 'parent' | 'member';
export type Theme = 'light' | 'dark';

export type ChoreStatus = 'pending' | 'complete' | 'approved' | 'rejected';
export type RecurrenceFrequency = 'none' | 'weekly' | 'biweekly';
export type EventTag = 'school' | 'sports' | 'family' | 'work';
export type PostTone = 'family' | 'amber';
export type TransactionType = 'earning';
export type InviteStatus = 'pending' | 'accepted';

/** `families/{familyId}` — replaces the spec's settings/family singleton. */
export interface Family {
  familyName: string;
  createdBy: string; // founding parent uid
  createdAt: number;
}

/**
 * `users/{uid}` — keyed by Auth UID. FAMILY-READABLE doc.
 *
 * Privacy finding 2 (review of Phases 1-2): `email` is adult [PI] and MUST NOT
 * be exposed to other members of the family (children must not see an adult's
 * email). It is therefore NOT on this family-readable doc — it lives on the
 * per-subject `userPrivate/{uid}` doc instead (readable only by the subject and
 * a same-family parent). Do not re-add `email` here.
 */
export interface User {
  name: string; // [PI/PI-child]
  role: Role; // immutable from client
  familyId: string; // immutable from client
  /**
   * INTEGER CENTS (money). The member's running allowance balance in whole
   * cents (e.g. $38.50 is `3850`), `>= 0` and `<= MONEY_MAX_CENTS`. Stored as
   * cents everywhere; format to "$X.XX" only for display. Parent/transaction-
   * written only (firestore.rules `parentAllowanceCredit`).
   */
  allowanceBalance: number;
  isActive: boolean; // parent-written only
  theme: Theme; // self-writable
  /**
   * Audit-only: when the user joined via an invite (not the founding-parent
   * bootstrap), this carries the invite doc id that authorised their join.
   * Required by firestore.rules' `isInviteBootstrap` so the rules can verify
   * the invite is valid for this email/familyId/role. Permanent + read-only
   * after create (both selfUpdate and parentUpdate enforce `immutable('inviteId')`).
   * Absent for founding parents.
   */
  inviteId?: string;
}

/**
 * `userPrivate/{uid}` — per-subject private doc (privacy finding 2).
 *
 * Holds the adult `email` [PI] that was removed from the family-readable `users`
 * doc. Readable ONLY by the subject (uid == auth.uid) and a same-family PARENT;
 * NOT readable by other members (a child cannot read another member's email).
 * `familyId` is carried solely so firestore.rules can scope the parent-read
 * predicate; it is immutable from the client.
 */
export interface UserPrivate {
  email: string; // [PI] adult email (child credential model per ADR-0006 Q3)
  familyId: string; // immutable from client — for rule scoping only
}

export interface FamilyEvent {
  title: string;
  description: string;
  date: string; // ISO date
  tag: EventTag;
  familyId: string;
  createdBy: string;
  createdAt: number;
}

export interface Post {
  content: string; // [PI/PI-child]
  authorId: string;
  authorName: string; // [PI]
  familyId: string;
  createdAt: number;
  tone?: PostTone;
}

export interface Chore {
  title: string;
  assignedTo: string; // uid of a same-family user
  dueDate: string;
  /** INTEGER POINTS (not money). A whole number >= 0; never formatted as money. */
  pointValue: number;
  /**
   * INTEGER CENTS (money). A whole number of cents (e.g. a $3.00 reward is
   * `dollarValue: 300`), `>= 0` and `<= MONEY_MAX_CENTS` ($1,000,000). Stored as
   * cents EVERYWHERE (second-opinion #4 / adversarial Finding 7) to avoid float
   * drift; format to "$X.XX" only for DISPLAY (see formatMoney). NEVER stored as
   * a fractional dollar amount (350.5 is invalid — denied by firestore.rules).
   */
  dollarValue: number;
  status: ChoreStatus;
  rejectionReason?: string;
  /**
   * Optional epoch ms — set when a parent rejects a chore. Paired with
   * `rejectionReason`. Both fields are cleared on the next mark-complete
   * attempt (the kid retries with a fresh submission).
   */
  rejectedAt?: number;
  /**
   * Optional Firebase Storage download URL (Feature 2 — Chore Photo
   * Verification). When the kid attaches a photo on mark-complete, the
   * file is uploaded under `families/{familyId}/chores/{choreId}/proof.jpg`
   * and the resulting download URL is stored here. Visible to same-family
   * callers via storage.rules; chore writers attach via the
   * markCompleteWithProof service. Optional — text-only completion still
   * works.
   */
  proofImageUrl?: string;
  /** Epoch ms when the proof image was attached. Paired with proofImageUrl. */
  proofSubmittedAt?: number;
  familyId: string;
  createdBy: string;
  createdAt: number;
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency;
}

/** Append-only ledger (ADR-0004). */
export interface Transaction {
  uid: string;
  choreId: string;
  choreTitle: string;
  /**
   * INTEGER CENTS — equals the approved chore's `dollarValue` (whole cents,
   * `>= 0`, `<= MONEY_MAX_CENTS`). Money is cents everywhere; format only for
   * display.
   */
  amount: number;
  type: TransactionType;
  familyId: string;
  createdAt: number;
}

/**
 * The maximum money value (in INTEGER CENTS) the rules + UI accept: $1,000,000.
 * Any `dollarValue`/`amount`/`allowanceBalance` above this is denied at the
 * authorization boundary (adversarial Finding 7 — bound the money fields).
 */
export const MONEY_MAX_CENTS = 100000000;

/**
 * Lifecycle of a savings goal (Feature 1 — savings goals & jars).
 *  - 'active'    : the goal is being saved toward. Default on create.
 *  - 'completed' : the parent has marked the goal as fulfilled (kid bought
 *                  the thing). Terminal — no more contributions allowed.
 *  - 'archived'  : the goal was given up on (kid changed their mind /
 *                  parent retired a stale goal). Terminal — no more
 *                  contributions, can be re-opened by re-creating.
 */
export type SavingsGoalStatus = 'active' | 'completed' | 'archived';

export interface SavingsGoal {
  familyId: string;
  /** uid of the SUBJECT (the member whose goal this is). Set ONCE at create. */
  ownerUid: string;
  /** Free-text label the kid picks (e.g. "Nintendo Switch"). Trimmed by service. */
  title: string;
  /** INTEGER CENTS — how much to save in total. `>= 0` and `<= MONEY_MAX_CENTS`. */
  targetAmount: number;
  /** INTEGER CENTS — how much has been allocated/contributed so far. */
  currentAmount: number;
  /**
   * Optional aspirational target date (ISO YYYY-MM-DD). Pure UI hint; no
   * automatic deadline action.
   */
  targetDate?: string;
  createdAt: number;
  updatedAt: number;
  status: SavingsGoalStatus;
}

export interface Invite {
  email: string; // [PI] adult email
  role: Role;
  familyId: string;
  invitedBy: string;
  createdAt: number;
  status: InviteStatus;
  /**
   * Epoch ms after which the invite is no longer redeemable. Optional for
   * backward compatibility with invites created before the TTL feature
   * landed — those default to `createdAt + INVITE_TTL_MS` at read time.
   * New invites always write this explicitly. Client-side enforcement
   * (getInviteById returns null when past expiry); rules-level enforcement
   * is a follow-up.
   */
  expiresAt?: number;
}

/** A user enriched with its document id (uid) for UI lists. */
export interface UserWithId extends User {
  id: string;
}
