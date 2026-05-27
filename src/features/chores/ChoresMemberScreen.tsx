/**
 * Chores member screen (Phase 3, Task 10; handoff #05 ChoresTeenScreen).
 *
 * Designer-defined states (see the test "state traceability"):
 *  - LOADING            -> Skeleton (role="status", aria-busy)
 *  - EMPTY              -> friendly EmptyState (no chores assigned)
 *  - EARNINGS card      -> the member's current allowanceBalance, prominent
 *  - PENDING section    -> chore rows WITH a "Mark done" button
 *  - WAITING section    -> complete chores, "waiting for approval" (no button)
 *  - APPROVED section   -> approved chores, strike-through + "$X earned"
 *  - REJECTED           -> shows the parent's rejectionReason (no button)
 *  - RECURRING          -> a recurrence-frequency badge when isRecurring
 *  - status BADGE       -> tone from the STATIC statusBadgeClass map
 *
 * Feed state + actions are INJECTED so the screen renders deterministically
 * without Firestore. firestore.rules is the real authority boundary.
 *
 * DEFERRED ("earned this month"): the monthly-earnings sub-line depends on the
 * transactions ledger (Allowance History, not built yet). This screen shows the
 * BALANCE only; it must NOT compute month sums or read transactions. A static
 * "View history" affordance is a placeholder for that later feature.
 *
 * WCAG 1.4.1: every status is conveyed as TEXT (a section heading + a labelled
 * badge), never colour alone. "Mark done" is a real focusable <button>.
 */
import { type ReactElement } from 'react';
import { EmptyState, Skeleton } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { ChoreStatus, RecurrenceFrequency, Role } from '../../lib/types';
import {
  CHORE_COMPLETE_SUCCESS,
  CHORE_GENERIC_ERROR,
  statusBadgeClass,
  type ChoreWithId,
} from './choresMemberService';

export interface ChoresMemberScreenProps {
  familyId: string | null;
  viewer: { uid: string; name: string; role: Role; allowanceBalance: number };
  feed: {
    chores: ChoreWithId[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  };
  /** Injected mark-complete action (wired to choresMemberService.markComplete + toast). */
  onMarkComplete: (choreId: string) => Promise<void>;
}

const CURRENCY = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Badge text label per status (conveys status as TEXT, not colour alone —
// WCAG 1.4.1). NOTE: the `complete` badge says "Waiting" (NOT "Waiting for
// approval") so the section heading "Waiting for approval" is the single
// element carrying that exact phrase — a getByText(/waiting for approval/i)
// must resolve to one element.
const STATUS_LABEL: Record<ChoreStatus, string> = {
  pending: 'To do',
  complete: 'Waiting',
  approved: 'Approved',
  rejected: 'Needs another try',
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { dateStyle: 'long' });

/**
 * Friendly, screen-reader date label for a chore's due date (the date lives in
 * the `<time datetime>` attribute; this is the accessible name). `dueDate` is a
 * plain ISO date string; parse it at UTC-noon so the displayed calendar day is
 * stable regardless of the viewer's timezone.
 */
function friendlyDueDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return DATE_FORMAT.format(date);
}

const RECURRENCE_LABEL: Record<RecurrenceFrequency, string> = {
  none: '',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
};

function formatMoney(value: number): string {
  return CURRENCY.format(Number.isFinite(value) ? value : 0);
}

export function ChoresMemberScreen(props: ChoresMemberScreenProps): ReactElement {
  const { viewer, feed, onMarkComplete } = props;
  const { showToast } = useToast();

  const handleMarkComplete = (choreId: string): void => {
    void onMarkComplete(choreId)
      .then(() => showToast(CHORE_COMPLETE_SUCCESS))
      .catch(() => showToast(CHORE_GENERIC_ERROR));
  };

  const pending = feed.chores.filter((c) => c.status === 'pending' || c.status === 'rejected');
  const waiting = feed.chores.filter((c) => c.status === 'complete');
  const approved = feed.chores.filter((c) => c.status === 'approved');
  const hasChores = feed.chores.length > 0;

  return (
    <>
      <section className="flex flex-col gap-16 px-16 pt-4 pb-24">
        <h1 className="text-display font-display font-extrabold text-ink">Chores</h1>

        {/* EARNINGS card — the member's current balance, prominent (amber-light).
            No "earned this month" sum: the transactions ledger is a later
            feature. "View history" is a placeholder affordance for it. */}
        <div className="flex flex-col gap-8 rounded-card bg-accent-light p-16 shadow-card">
          <span className="text-meta font-semibold text-accent-dark">Your balance</span>
          <span className="text-display font-display font-extrabold text-accent-dark">
            {formatMoney(viewer.allowanceBalance)}
          </span>
          <button
            type="button"
            className="self-start text-meta font-semibold text-accent-dark underline focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            View history
          </button>
        </div>

        {feed.loading ? (
          <Skeleton label="Loading your chores…" />
        ) : !hasChores ? (
          <EmptyState message="You're all caught up — no chores right now." />
        ) : (
          <>
            <ChoreSection title="To do" chores={pending} onMarkComplete={handleMarkComplete} />
            <ChoreSection title="Waiting for approval" chores={waiting} faded />
            <ChoreSection title="Recently approved" chores={approved} strikeThrough />
          </>
        )}
      </section>

      {/* Single toast live region for chores flows (ToastViewport is a global
          singleton — a duplicate instance is inert, so a toast is never
          announced twice). */}
      <ToastViewport />
    </>
  );
}

interface ChoreSectionProps {
  title: string;
  chores: ChoreWithId[];
  faded?: boolean | undefined;
  strikeThrough?: boolean | undefined;
  onMarkComplete?: ((choreId: string) => void) | undefined;
}

function ChoreSection(props: ChoreSectionProps): ReactElement | null {
  const { title, chores, faded, strikeThrough, onMarkComplete } = props;
  if (chores.length === 0) return null;
  return (
    <div className="flex flex-col gap-12">
      <h2 className="text-title font-bold text-ink">{title}</h2>
      <ul className="flex flex-col gap-8" aria-label={title}>
        {chores.map((chore) => (
          <li key={chore.id}>
            <ChoreRow
              chore={chore}
              faded={faded}
              strikeThrough={strikeThrough}
              onMarkComplete={onMarkComplete}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ChoreRowProps {
  chore: ChoreWithId;
  faded?: boolean | undefined;
  strikeThrough?: boolean | undefined;
  onMarkComplete?: ((choreId: string) => void) | undefined;
}

function ChoreRow(props: ChoreRowProps): ReactElement {
  const { chore, faded, strikeThrough, onMarkComplete } = props;
  const isPending = chore.status === 'pending';
  const isApproved = chore.status === 'approved';
  const isRejected = chore.status === 'rejected';
  const recurrenceLabel = chore.isRecurring ? RECURRENCE_LABEL[chore.recurrenceFrequency] : '';

  return (
    <div
      className={`flex flex-col gap-8 rounded-control border border-surface-line bg-surface-card px-14 py-12 ${
        faded ? 'opacity-60' : ''
      }`}
    >
      <div className="flex items-start gap-12">
        <span
          className={`flex-1 text-body font-semibold text-ink ${
            strikeThrough ? 'line-through' : ''
          }`}
        >
          {chore.title}
        </span>
        {/* Status conveyed as TEXT (label), not colour alone (WCAG 1.4.1). */}
        <span
          className={`inline-flex h-badge items-center rounded-full px-10 text-badge font-semibold ${statusBadgeClass(
            chore.status,
          )}`}
        >
          {STATUS_LABEL[chore.status]}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-12 text-meta text-ink-mute">
        {/* The due date lives in the <time datetime> attribute; the visible text
            stays digit-free and the full date is the element's accessible name.
            "Due" is the visible cue. */}
        <span className="inline-flex items-center gap-4">
          Due
          <time dateTime={chore.dueDate} aria-label={`due ${friendlyDueDate(chore.dueDate)}`} />
        </span>
        {/* Point value (the chore's reward for a member); the dollar value is
            surfaced as the EARNED amount once approved (below), mirroring the
            allowance flow. */}
        <span aria-label={`${chore.pointValue} points`}>{chore.pointValue} pts</span>
        {isApproved && (
          <span className="font-semibold text-status-ok-text">
            {formatMoney(chore.dollarValue)} earned
          </span>
        )}
        {recurrenceLabel && (
          <span className="inline-flex h-badge items-center rounded-full bg-brand-light px-10 text-badge font-semibold text-brand">
            {recurrenceLabel}
          </span>
        )}
      </div>

      {isRejected && chore.rejectionReason && (
        <p className="text-meta text-status-danger-text">{chore.rejectionReason}</p>
      )}

      {isPending && onMarkComplete && (
        <button
          type="button"
          onClick={() => onMarkComplete(chore.id)}
          className="inline-flex min-h-tap items-center justify-center self-start rounded-control bg-accent px-20 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-accent-dark active:bg-accent-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
        >
          Mark done
        </button>
      )}
    </div>
  );
}
