/**
 * Allowance History service (Phase 4; Allowance History feature; ADR-0004).
 *
 * SIGNATURES + RE-EXPORTS ONLY. The test-writer authors this file to PIN the
 * shapes the tests import; the implementer fills the bodies. The implementer
 * MUST NOT change these signatures / exported constants without updating the
 * tests.
 *
 * This is a READ-ONLY view over the existing append-only `transactions` ledger
 * (ADR-0004). NO schema change, NO new index, NO firestore.rules change. The
 * money helpers are REUSED from choresParentService (cents everywhere; format
 * to "$X.XX" only for display); they are re-exported here so the allowance
 * feature has one import surface.
 *
 * HONESTY (ADR-0004): the balance and the transaction list are INDEPENDENT
 * facts. This module never sums the list into a balance, and the screen never
 * claims the list "adds up to" the balance.
 */
import type { Transaction } from '../../lib/types';

// Reuse the single money formatter / validator / invalid indicator — do NOT
// reimplement (cents everywhere; non-finite balance -> indicator, never $0.00).
export {
  formatMoney,
  isValidMoneyCents,
  MONEY_INVALID_INDICATOR,
} from '../chores/choresParentService';

/** A ledger transaction enriched with its document id for list rendering. */
export interface TransactionWithId extends Transaction {
  id: string;
}

/**
 * User-safe copy the allowance flows surface; asserted by the tests. Never
 * leaks a raw Firebase code or PII (a child's name / choreTitle).
 */
export const ALLOWANCE_LOAD_ERROR = 'We could not load the allowance history. Please try again.';
export const ALLOWANCE_EMPTY_MESSAGE = 'No allowance yet — earnings will show up here.';
