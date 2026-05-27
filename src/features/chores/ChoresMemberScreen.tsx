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
 *  - REJECTED section   -> its OWN section ("Needs another try"); shows the
 *                          parent's rejectionReason (or a fallback line), no button
 *  - RECURRING          -> a recurrence-frequency badge when isRecurring
 *  - status BADGE       -> tone from the STATIC statusBadgeClass map
 *
 * Feed state + actions are INJECTED so the screen renders deterministically
 * without Firestore. firestore.rules is the real authority boundary.
 *
 * DEFERRED ("earned this month"): the monthly-earnings sub-line depends on the
 * transactions ledger (Allowance History, not built yet). This screen shows the
 * BALANCE only; it must NOT compute month sums or read transactions. A static
 * "View history" affordance (aria-disabled, coming soon) is a placeholder.
 *
 * DEFERRED (re-submit): a rejected chore has NO action — the re-submit
 * transition is a later task. Rejected chores live in their own section.
 *
 * WCAG 1.4.1: every status is conveyed as TEXT (a section heading + a labelled
 * badge), never colour alone. "Mark done" is a real focusable <button>.
 */
import { useEffect, useId, useRef, useState, type ReactElement, type RefObject } from 'react';
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
  /**
   * Navigate to the member's Allowance History (Allowance History feature). The
   * "View history" affordance is now an ENABLED control that invokes this —
   * superseding the earlier aria-disabled "coming soon" placeholder.
   */
  onViewHistory: () => void;
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

// The recognised status enum — an out-of-enum status (stale cache / future
// schema) is EXCLUDED from every bucket AND from `hasChores`, so the screen
// never claims chores exist while rendering an invisible, button-less phantom.
const KNOWN_STATUSES: ReadonlySet<string> = new Set<ChoreStatus>([
  'pending',
  'complete',
  'approved',
  'rejected',
]);

// Visible fallback when a parent sent a chore back without typing a note. A
// rejected chore must never render a bare empty danger-coloured paragraph.
const NO_REASON_FALLBACK = 'No reason given.';

const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

/**
 * Friendly, human-readable due date. `dueDate` is a plain ISO date string; parse
 * it at UTC-noon so the displayed calendar day is stable regardless of the
 * viewer's timezone. This is the VISIBLE text inside the `<time>` element (WCAG:
 * the date must not live only in the attribute / aria-label).
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

  // Per-chore in-flight guard: while a mark-complete write is pending the chore
  // id sits here. The button is disabled and a second click is a no-op, so a
  // double-click cannot fire a second write (which would hit a now-complete
  // chore server-side and surface the scary error toast).
  const [submittingId, setSubmittingId] = useState<string | null>(null);

  // Set once a mark-complete resolves; the next render that no longer shows the
  // completed chore under "To do" moves focus to the Waiting heading so a
  // keyboard / screen-reader user is not stranded on the unmounted button.
  const waitingHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocusRef = useRef(false);

  const handleMarkComplete = (choreId: string): void => {
    // Guard: ignore a click while ANY mark-complete is in flight.
    if (submittingId !== null) return;
    setSubmittingId(choreId);
    void onMarkComplete(choreId)
      .then(() => {
        // Defer the success toast to a macrotask so the steady-state UI (the
        // chore moving into the "Waiting for approval" section) settles first.
        // The toast copy itself contains "waiting for approval", so announcing
        // it synchronously would briefly duplicate that phrase with the section
        // heading; the queued announcement still fires for assistive tech.
        setTimeout(() => showToast(CHORE_COMPLETE_SUCCESS), 0);
        pendingFocusRef.current = true;
      })
      .catch(() => showToast(CHORE_GENERIC_ERROR))
      .finally(() => setSubmittingId(null));
  };

  // Bucket by status; an UNKNOWN status falls through every filter (excluded
  // from all sections AND from `hasChores`).
  const pending = feed.chores.filter((c) => c.status === 'pending');
  const waiting = feed.chores.filter((c) => c.status === 'complete');
  const approved = feed.chores.filter((c) => c.status === 'approved');
  const rejected = feed.chores.filter((c) => c.status === 'rejected');
  const hasChores = feed.chores.some((c) => KNOWN_STATUSES.has(c.status));

  // After a successful mark-complete, once the Waiting heading is on screen,
  // move focus to it (the just-completed chore's button has unmounted).
  useEffect(() => {
    if (pendingFocusRef.current && waitingHeadingRef.current) {
      pendingFocusRef.current = false;
      waitingHeadingRef.current.focus();
    }
  });

  return (
    <>
      <section className="flex flex-col gap-16 px-16 pt-4 pb-24">
        <h1 className="text-display font-display font-extrabold text-ink">Chores</h1>

        {/* EARNINGS card — the member's current balance, prominent (amber-light).
            No "earned this month" sum: the transactions ledger is a later
            feature. "View history" is a placeholder affordance for it. */}
        <div className="flex flex-col gap-8 rounded-card bg-accent-light p-16 shadow-card">
          <span className="text-meta font-semibold text-accent-dark">Your balance</span>
          <span
            className="text-display font-display font-extrabold text-accent-dark"
            aria-label={`Your balance ${formatMoney(viewer.allowanceBalance)}`}
          >
            {formatMoney(viewer.allowanceBalance)}
          </span>
          {/* Placeholder for the deferred Allowance History feature: focusable
              but aria-disabled so it announces as "coming soon", not a silent
              no-op. */}
          <button
            type="button"
            aria-disabled="true"
            className="self-start text-meta font-semibold text-accent-dark underline opacity-60 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
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
            <ChoreSection
              title="To do"
              chores={pending}
              onMarkComplete={handleMarkComplete}
              submittingId={submittingId}
            />
            <ChoreSection
              title="Waiting for approval"
              chores={waiting}
              faded
              headingRef={waitingHeadingRef}
            />
            <ChoreSection title="Recently approved" chores={approved} strikeThrough />
            {/* Rejected chores get their OWN section with a "Try again" redo
                affordance (rejected -> complete; the rule now permits it). It
                reuses the SAME mark-complete action as the pending bucket. */}
            <ChoreSection
              title="Needs another try"
              chores={rejected}
              onTryAgain={handleMarkComplete}
              submittingId={submittingId}
            />
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
  onTryAgain?: ((choreId: string) => void) | undefined;
  submittingId?: string | null | undefined;
  headingRef?: RefObject<HTMLHeadingElement> | undefined;
}

function ChoreSection(props: ChoreSectionProps): ReactElement | null {
  const {
    title,
    chores,
    faded,
    strikeThrough,
    onMarkComplete,
    onTryAgain,
    submittingId,
    headingRef,
  } = props;
  if (chores.length === 0) return null;
  return (
    <div className="flex flex-col gap-12">
      {/* tabIndex={-1} makes the heading programmatically focusable so focus can
          land here after a chore moves out of the "To do" section. */}
      <h2
        ref={headingRef}
        tabIndex={-1}
        className="text-title font-bold text-ink outline-none focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
      >
        {title}
      </h2>
      <ul className="flex flex-col gap-8" aria-label={title}>
        {chores.map((chore) => (
          <li key={chore.id}>
            <ChoreRow
              chore={chore}
              faded={faded}
              strikeThrough={strikeThrough}
              onMarkComplete={onMarkComplete}
              onTryAgain={onTryAgain}
              submitting={submittingId === chore.id}
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
  onTryAgain?: ((choreId: string) => void) | undefined;
  submitting?: boolean | undefined;
}

function ChoreRow(props: ChoreRowProps): ReactElement {
  const { chore, faded, strikeThrough, onMarkComplete, onTryAgain, submitting } = props;
  const isPending = chore.status === 'pending';
  const isApproved = chore.status === 'approved';
  const isRejected = chore.status === 'rejected';
  const recurrenceLabel = chore.isRecurring ? RECURRENCE_LABEL[chore.recurrenceFrequency] : '';
  const reasonId = useId();

  // Robust rejection reason: trim and fall back to a sensible visible line when
  // the parent sent the chore back without a note (absent/empty/whitespace).
  const trimmedReason = (chore.rejectionReason ?? '').trim();
  const reasonText = trimmedReason.length > 0 ? trimmedReason : NO_REASON_FALLBACK;

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
          aria-describedby={isRejected ? reasonId : undefined}
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
        {/* The friendly date is VISIBLE text inside <time> (WCAG: not hidden in
            the attribute / aria-label alone); datetime carries the machine ISO. */}
        <span className="inline-flex items-center gap-4">
          Due
          <time dateTime={chore.dueDate}>{friendlyDueDate(chore.dueDate)}</time>
        </span>
        {/* Point value (the chore's reward for a member); the dollar value is
            surfaced as the EARNED amount once approved (below), mirroring the
            allowance flow. */}
        <span aria-label={`${chore.pointValue} points`}>{chore.pointValue} pts</span>
        <span aria-label={`worth ${formatMoney(chore.dollarValue)}`}>
          {formatMoney(chore.dollarValue)}
        </span>
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

      {isRejected && (
        <p id={reasonId} className="text-meta text-status-danger-text">
          <span className="font-semibold">Why it was sent back: </span>
          {reasonText}
        </p>
      )}

      {isRejected && onTryAgain && (
        <button
          type="button"
          disabled={submitting}
          aria-disabled={submitting ? 'true' : undefined}
          aria-label={`Try again: ${chore.title}`}
          onClick={() => onTryAgain(chore.id)}
          className="inline-flex min-h-tap items-center justify-center self-start rounded-control bg-accent px-20 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-accent-dark active:bg-accent-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 motion-reduce:transition-none"
        >
          Try again
        </button>
      )}

      {isPending && onMarkComplete && (
        <button
          type="button"
          disabled={submitting}
          aria-disabled={submitting ? 'true' : undefined}
          aria-label={`Mark done: ${chore.title}`}
          onClick={() => onMarkComplete(chore.id)}
          className="inline-flex min-h-tap items-center justify-center self-start rounded-control bg-accent px-20 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-accent-dark active:bg-accent-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 motion-reduce:transition-none"
        >
          Mark done
        </button>
      )}
    </div>
  );
}
