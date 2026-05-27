/**
 * Allowance-history feed hook (Allowance History feature; ADR-0004).
 *
 * SIGNATURE ONLY — declare-only contract stub. The implementer replaces the
 * body; the tests (useAllowanceHistory.test.tsx) PIN the behaviour and the
 * implementer MUST NOT change this signature without updating the tests.
 *
 * Mirrors useMyChores: subscribes to the existing `transactions` ledger scoped
 * with BOTH equality filters the rules allow —
 * `where('familyId','==', familyId)` AND `where('uid','==', uid)` — plus
 * `orderBy('createdAt','desc')`, so a viewer sees ONLY the selected member's
 * OWN ledger, never a peer's nor another family's. NEVER a familyId-only query
 * (that would leak peers). `createdAt` (Timestamp / pending serverTimestamp) is
 * Timestamp->ms converted. CLEARS transactions on a uid OR familyId CHANGE
 * (cross-display leak guard). A null uid OR null familyId issues no query.
 */
import type { TransactionWithId } from './allowanceService';

export interface UseAllowanceHistoryResult {
  transactions: TransactionWithId[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAllowanceHistory(
  _uid: string | null,
  _familyId: string | null,
): UseAllowanceHistoryResult {
  throw new Error('not implemented');
}
