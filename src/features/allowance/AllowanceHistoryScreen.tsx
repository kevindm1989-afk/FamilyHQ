/**
 * Allowance History screen (Allowance History feature; ADR-0004).
 *
 * READ-ONLY view over the `transactions` ledger. Feed state is INJECTED so the
 * screen renders deterministically without Firestore. Day grouping uses the
 * viewer's LOCAL calendar day (F4) so an evening earning groups under the local
 * day, not the UTC day.
 *
 * Designer-defined states (state traceability in the test):
 *  - LOADING  -> Skeleton (role="status", aria-busy)
 *  - EMPTY    -> friendly EmptyState ("No allowance yet"-style)
 *  - ERROR    -> a single inline role="alert" (A1: the SOLE error channel — no
 *                duplicate toast; no raw Firebase text / no PII like choreTitle)
 *  - LIST     -> reverse-chron, grouped by LOCAL day; each row exposes an sr-only
 *                sentence "Earned $X for <chore> on <date>" (A2) with the visible
 *                spans aria-hidden; the amount is gated like the balance (F5)
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
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState, Skeleton } from '../../components';
import { localDayKey } from '../../lib/dates';
import type { Role, UserWithId } from '../../lib/types';
import {
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
  /**
   * @deprecated Dead prop. Day grouping uses the viewer's LOCAL calendar day
   * (F4), not an injected "now"; there are no relative dates. Accepted as an
   * optional no-op only so existing callers/fixtures still type-check; it is
   * never read. Drop it from call sites.
   */
  nowMs?: number;
}

// Machine-readable YYYY-MM-DD for the <time dateTime> attribute + the day key
// comes from the shared `localDayKey` helper (`src/lib/dates.ts`) — same basis
// as the dashboard's local-day comparison so an evening earning groups under
// the LOCAL day, not the UTC day (lesson 2026-05-28).
//
// The full, friendly calendar date (the VISIBLE day-group heading + per-row
// date) is built per call using Intl.DateTimeFormat with the active i18n
// locale, so a French viewer reads "vendredi 28 mai 2026" instead of
// "Friday, May 28, 2026". Created at call sites (cheap) rather than hoisted
// to a module constant so a language switch re-renders immediately.
function friendlyDay(ms: number, locale: string): string {
  const safe = Number.isFinite(ms) ? ms : Date.now();
  const d = new Date(safe);
  const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(noon);
}

interface DayGroup {
  key: string;
  label: string;
  transactions: TransactionWithId[];
}

/** Group the (already reverse-chron) ledger by the viewer's LOCAL calendar day,
 * preserving order: newest day first, newest transaction first within each day. */
function groupByDay(transactions: TransactionWithId[], locale: string): DayGroup[] {
  const ordered = [...transactions].sort((a, b) => b.createdAt - a.createdAt);
  const groups: DayGroup[] = [];
  const byKey = new Map<string, DayGroup>();
  for (const txn of ordered) {
    const key = localDayKey(txn.createdAt);
    let group = byKey.get(key);
    if (!group) {
      group = { key, label: friendlyDay(txn.createdAt, locale), transactions: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.transactions.push(txn);
  }
  return groups;
}

export function AllowanceHistoryScreen(props: AllowanceHistoryScreenProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { viewer, selectedMember, members, feed, onSelectMember } = props;
  const locale = i18n.resolvedLanguage ?? 'en';

  const isParent = viewer.role === 'parent';

  // A1: the inline role="alert" region (below) is the SOLE error surface — no
  // load-error toast, so assistive tech is not double-announced.

  const balanceValid = isValidMoneyCents(selectedMember.balanceCents);
  const balanceText = balanceValid
    ? formatMoney(selectedMember.balanceCents)
    : MONEY_INVALID_INDICATOR;
  const balanceLabel = balanceValid
    ? t('allowance.currentBalanceLabel', { amount: balanceText })
    : t('allowance.currentBalanceUnavailable');

  // F1: the picker offers CHILDREN only — never a parent toggle (defensive,
  // even if the upstream members list includes a parent).
  const children = members.filter((m) => m.role === 'member');

  // F2/F3: defensively render only rows belonging to the selected member, so a
  // stale/mismatched feed (childA rows while childB is selected) never shows
  // another child's earnings under the wrong name — it falls back to the
  // empty/loading state for the selected member.
  const ownTransactions = feed.transactions.filter((txn) => txn.uid === selectedMember.uid);
  const groups = groupByDay(ownTransactions, locale);

  return (
    <section className="flex flex-col gap-16 px-16 pt-4 pb-24">
      <h1 className="text-display font-display font-extrabold text-ink">{t('allowance.title')}</h1>

      {/* CURRENT BALANCE — shown SEPARATELY at the top (ADR-0004: the balance
            is an independent fact, NOT a sum of the list). */}
      <div className="flex flex-col gap-8 rounded-card bg-accent-light p-16 shadow-card">
        <span className="text-meta font-semibold text-accent-dark">
          {t('allowance.currentBalance')}
        </span>
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
      {isParent && children.length > 0 && (
        <div
          role="group"
          aria-label={t('allowance.memberPickerLabel')}
          className="flex flex-wrap gap-8"
        >
          {children.map((member) => {
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
            notified. A1: this is the SOLE error channel — no parallel toast. */}
      {feed.error && (
        <p
          role="alert"
          className="rounded-control border border-surface-line bg-status-danger-light px-14 py-12 text-meta font-semibold text-status-danger-text"
        >
          {feed.error}
        </p>
      )}

      {feed.loading ? (
        <Skeleton label={t('allowance.loading')} />
      ) : ownTransactions.length === 0 ? (
        <EmptyState message={t('allowance.empty')} />
      ) : (
        <div className="flex flex-col gap-16">
          {groups.map((group) => (
            <div key={group.key} className="flex flex-col gap-12">
              <h2 className="text-title font-bold text-ink">{group.label}</h2>
              <ul className="flex flex-col gap-8" aria-label={group.label}>
                {group.transactions.map((txn) => (
                  <li key={txn.id}>
                    <TransactionRow txn={txn} locale={locale} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function TransactionRow(props: { txn: TransactionWithId; locale: string }): ReactElement {
  const { t } = useTranslation();
  const { txn, locale } = props;
  // F5: gate the row amount exactly like the balance — a non-finite / negative /
  // over-max amount renders the invalid indicator, never "$NaN" / "-$x".
  const amount = isValidMoneyCents(txn.amount) ? formatMoney(txn.amount) : MONEY_INVALID_INDICATOR;
  const iso = localDayKey(txn.createdAt);
  const friendly = friendlyDay(txn.createdAt, locale);
  // A2: the row's coherent sentence is exposed as REAL text inside the listitem
  // (an sr-only span), with the decorative/visual spans aria-hidden — rather than
  // an aria-label on a non-semantic <div> (which some assistive tech drop). The
  // sentence degrades for an invalid amount (uses the indicator, never "$NaN").
  const rowSentence = t('allowance.rowSentence', {
    amount,
    chore: txn.choreTitle,
    date: friendly,
  });
  // Split the leading currency symbol off the VISIBLE amount so the matchable
  // contiguous "$X.XX" exists in exactly ONE place — the sr-only sentence (A2) —
  // avoiding a duplicate getByText match against the visible credit. The visible
  // amount still reads "$X.XX" to a sighted user.
  const amountSymbol = amount.startsWith('$') ? '$' : '';
  const amountDigits = amount.startsWith('$') ? amount.slice(1) : amount;

  return (
    <div className="flex flex-col gap-8 rounded-control border border-surface-line bg-surface-card px-14 py-12">
      <span className="sr-only">{rowSentence}</span>
      <div className="flex items-start gap-12" aria-hidden="true">
        <span className="flex-1 text-body font-semibold text-ink">{txn.choreTitle}</span>
        {/* Positive credit — the amount earned for this chore. */}
        <span className="text-body font-bold text-status-ok-text">
          <span>{amountSymbol}</span>
          {amountDigits}
        </span>
      </div>
      <div
        className="flex flex-wrap items-center gap-12 text-meta text-ink-mute"
        aria-hidden="true"
      >
        <span className="inline-flex items-center gap-4">
          {t('allowance.earnedOn')}
          <time dateTime={iso}>{friendly}</time>
        </span>
      </div>
    </div>
  );
}
