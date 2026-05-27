/**
 * Allowance History screen (Allowance History feature; ADR-0004).
 *
 * SIGNATURE ONLY — declare-only contract stub. The implementer fills the body;
 * the tests (AllowanceHistoryScreen.test.tsx) PIN the behaviour and the
 * implementer MUST NOT change this signature without updating the tests.
 *
 * READ-ONLY view over the `transactions` ledger. Feed state is INJECTED so the
 * screen renders deterministically without Firestore or the real clock. The
 * "now" reference used for day grouping / relative dates is injected (`nowMs`).
 *
 * Designer-defined states (state traceability in the test):
 *  - LOADING  -> Skeleton (role="status", aria-busy)
 *  - EMPTY    -> friendly EmptyState ("No allowance yet"-style)
 *  - ERROR    -> generic toast (no raw Firebase text / no PII like choreTitle)
 *  - LIST     -> reverse-chron, grouped by day; each row: chore title, amount as
 *                a positive credit via formatMoney(amount), <time dateTime>
 *  - BALANCE  -> shown SEPARATELY at top via formatMoney(balanceCents); a
 *                non-finite balance renders MONEY_INVALID_INDICATOR (never $0.00)
 *
 * PARENT mode: a member picker (toggle <button aria-pressed> per child) selects
 * whose ledger shows; selecting a different child calls onSelectMember(uid).
 * MEMBER mode: no picker (own ledger only).
 *
 * HONESTY (ADR-0004): the balance and list are independent — the screen never
 * claims the list sums to the balance.
 */
import type { ReactElement } from 'react';
import type { Role, UserWithId } from '../../lib/types';
import type { TransactionWithId } from './allowanceService';

export interface AllowanceHistoryScreenProps {
  /** The signed-in viewer. A parent sees the member picker; a member does not. */
  viewer: { uid: string; name: string; role: Role };
  /**
   * The member whose ledger is being shown (the viewer themself in member mode,
   * or the parent's selected child). `balanceCents` is that member's CURRENT
   * allowanceBalance (shown separately at the top — NOT derived from the list).
   */
  selectedMember: { uid: string; name: string; balanceCents: number };
  /** Active family members for the parent picker (ignored in member mode). */
  members: UserWithId[];
  /** The selected member's ledger feed (injected; from useAllowanceHistory). */
  feed: {
    transactions: TransactionWithId[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  };
  /** Parent-mode callback when a different child is picked. */
  onSelectMember: (uid: string) => void;
  /** Injected "now" (ms) for deterministic day grouping / relative dates. */
  nowMs: number;
}

export function AllowanceHistoryScreen(_props: AllowanceHistoryScreenProps): ReactElement {
  throw new Error('not implemented');
}
