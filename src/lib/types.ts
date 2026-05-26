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

/** `users/{uid}` — keyed by Auth UID. */
export interface User {
  name: string; // [PI/PI-child]
  email: string; // [PI] (adults; child credential model per ADR-0006 Q3)
  role: Role; // immutable from client
  familyId: string; // immutable from client
  allowanceBalance: number; // parent/transaction-written only
  isActive: boolean; // parent-written only
  theme: Theme; // self-writable
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
  pointValue: number;
  dollarValue: number;
  status: ChoreStatus;
  rejectionReason?: string;
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
  amount: number;
  type: TransactionType;
  familyId: string;
  createdAt: number;
}

export interface Invite {
  email: string; // [PI] adult email
  role: Role;
  familyId: string;
  invitedBy: string;
  createdAt: number;
  status: InviteStatus;
}

/** A user enriched with its document id (uid) for UI lists. */
export interface UserWithId extends User {
  id: string;
}
