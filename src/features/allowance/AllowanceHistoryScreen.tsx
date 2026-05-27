/**
 * Allowance History screen (Allowance History feature; ADR-0004).
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
import { useEffect, useRef, type ReactElement } from 'react';
import { EmptyState, Skeleton } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { Role, UserWithId } from '../../lib/types';
import {
  ALLOWANCE_EMPTY_MESSAGE,
  MONEY_INVALID_INDICATOR,
  formatMoney,
  isValidMoneyCents,
  type TransactionWithId,
} from './allowanceService';

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

// A full, friendly calendar date (the VISIBLE day-group heading + per-row date).
const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

// Machine-readable YYYY-MM-DD for the <time dateTime> attribute + the day key.
function isoDay(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : Date.now();
  const d = new Date(safe);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function friendlyDay(ms: number): string {
  const safe = Number.isFinite(ms) ? ms : Date.now();
  // Parse at UTC-noon of the day so the displayed calendar day is stable across
  // the viewer's timezone (mirrors the chores date helper).
  const d = new Date(safe);
  const noon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12));
  return DATE_FORMAT.format(noon);
}

interface DayGroup {
  key: string;
  label: string;
  transactions: TransactionWithId[];
}

/** Group the (already reverse-chron) ledger by UTC calendar day, preserving
 * order: newest day first, newest transaction first within each day. */
function groupByDay(transactions: TransactionWithId[]): DayGroup[] {
  const ordered = [...transactions].sort((a, b) => b.createdAt - a.createdAt);
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const txn of ordered) {
    const key = isoDay(txn.createdAt);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: friendlyDay(txn.createdAt), transactions: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.transactions.push(txn);
  }
  return groups;
}

export function AllowanceHistoryScreen(props: AllowanceHistoryScreenProps): ReactElement {
  const { viewer, selectedMember, members, feed, onSelectMember } = props;
  const { showToast } = useToast();

  const isParent = viewer.role === 'parent';

  // Surface the feed error as a single generic, PII-free toast (the hook already
  // mapped any raw Firebase code to user-safe copy).
  const lastErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (feed.error && feed.error !== lastErrorRef.current) {
      lastErrorRef.current = feed.error;
      showToast(feed.error);
    }
    if (!feed.error) lastErrorRef.current = null;
  }, [feed.error, showToast]);

  const balanceValid = isValidMoneyCents(selectedMember.balanceCents);
  const balanceText = balanceValid
    ? formatMoney(selectedMember.balanceCents)
    : MONEY_INVALID_INDICATOR;
  const balanceLabel = balanceValid
    ? `Current balance ${balanceText}`
    : 'Current balance unavailable';

  const groups = groupByDay(feed.transactions);

  return (
    <>
      <section className="flex flex-col gap-16 px-16 pt-4 pb-24">
        <h1 className="text-display font-display font-extrabold text-ink">Allowance</h1>

        {/* CURRENT BALANCE — shown SEPARATELY at the top (ADR-0004: the balance
            is an independent fact, NOT a sum of the list). */}
        <div className="flex flex-col gap-8 rounded-card bg-accent-light p-16 shadow-card">
          <span className="text-meta font-semibold text-accent-dark">Current balance</span>
          <span
            className="text-display font-display font-extrabold text-accent-dark"
            aria-label={balanceLabel}
          >
            {balanceText}
          </span>
        </div>

        {/* PARENT mode: member picker (toggle buttons with aria-pressed). A
            member never sees a peer picker. Mirrors the chores filter toggles:
            real, individually focusable <button>s with a >=44px tap target. */}
        {isParent && members.length > 0 && (
          <div aria-label="Choose a family member" className="flex flex-wrap gap-8">
            {members.map((member) => {
              const selected = selectedMember.uid === member.id;
              return (
                <button
                  key={member.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectMember(member.id)}
                  className={`inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border px-14 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
                    selected
                      ? 'border-brand bg-brand-light text-brand'
                      : 'border-surface-line bg-surface-card text-ink'
                  }`}
                >
                  {member.name}
                </button>
              );
            })}
          </div>
        )}

        {/* Generic, PII-free error surface (the hook already mapped any raw
            Firebase code to user-safe copy). role="alert" so assistive tech is
            notified; a parallel toast is fired in the effect above. */}
        {feed.error && (
          <p
            role="alert"
            className="rounded-control border border-surface-line bg-status-danger-light px-14 py-12 text-meta font-semibold text-status-danger-text"
          >
            {feed.error}
          </p>
        )}

        {feed.loading ? (
          <Skeleton label="Loading allowance history…" />
        ) : feed.transactions.length === 0 ? (
          <EmptyState message={ALLOWANCE_EMPTY_MESSAGE} />
        ) : (
          <div className="flex flex-col gap-16">
            {groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-12">
                <h2 className="text-title font-bold text-ink">{group.label}</h2>
                <ul className="flex flex-col gap-8" aria-label={group.label}>
                  {group.transactions.map((txn) => (
                    <li key={txn.id}>
                      <TransactionRow txn={txn} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <ToastViewport />
    </>
  );
}

function TransactionRow(props: { txn: TransactionWithId }): ReactElement {
  const { txn } = props;
  const amount = formatMoney(txn.amount);
  const iso = isoDay(txn.createdAt);
  const friendly = friendlyDay(txn.createdAt);
  // The row reads as one accessible sentence ("Earned $X for <chore> on <date>")
  // rather than three disconnected fragments (a11y).
  const rowLabel = `Earned ${amount} for ${txn.choreTitle} on ${friendly}`;

  return (
    <div
      className="flex flex-col gap-8 rounded-control border border-surface-line bg-surface-card px-14 py-12"
      aria-label={rowLabel}
    >
      <div className="flex items-start gap-12">
        <span className="flex-1 text-body font-semibold text-ink">{txn.choreTitle}</span>
        {/* Positive credit — the amount earned for this chore. */}
        <span className="text-body font-bold text-status-ok-text">{amount}</span>
      </div>
      <div className="flex flex-wrap items-center gap-12 text-meta text-ink-mute">
        <span className="inline-flex items-center gap-4">
          Earned
          <time dateTime={iso}>{friendly}</time>
        </span>
      </div>
    </div>
  );
}
