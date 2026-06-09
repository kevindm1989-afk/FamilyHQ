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
import { useTranslation } from 'react-i18next';
import { EmptyState, Skeleton } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { ChoreStatus, RecurrenceFrequency, Role } from '../../lib/types';
import { statusBadgeClass, type ChoreWithId } from './choresMemberService';

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
   * Optional photo-proof submission path (Feature 2). When the kid picks
   * an image for a pending chore, the Mark done button dispatches THIS
   * action instead of the plain `onMarkComplete` — uploading the file to
   * Firebase Storage and patching the chore doc atomically (see
   * chorePhotoService.markCompleteWithProof). If the route doesn't
   * provide this prop (e.g. in a unit test), the photo input is hidden
   * and the existing text-only flow runs unchanged.
   */
  onMarkCompleteWithProof?: (choreId: string, file: File) => Promise<void>;
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

// Badge text label per status, resolved via i18n at render. NOTE: the `complete`
// badge says "Waiting" (NOT "Waiting for approval") so the section heading
// "Waiting for approval" is the single element carrying that exact phrase —
// a getByText(/waiting for approval/i) must resolve to one element.
// WCAG 1.4.1: status conveyed as TEXT, not colour alone.
const STATUS_I18N_KEY: Record<ChoreStatus, string> = {
  pending: 'chores.status.pending',
  complete: 'chores.status.waiting',
  approved: 'chores.status.approved',
  rejected: 'chores.status.needsAnotherTry',
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

/**
 * Friendly, human-readable due date. `dueDate` is a plain ISO date string; parse
 * it at UTC-noon so the displayed calendar day is stable regardless of the
 * viewer's timezone. The formatter is built per call against the active i18n
 * locale so a French viewer reads "28 mai 2026" instead of "May 28, 2026".
 * This is the VISIBLE text inside the `<time>` element (WCAG: the date must
 * not live only in the attribute / aria-label).
 */
function friendlyDueDate(iso: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

const RECURRENCE_I18N_KEY: Record<RecurrenceFrequency, string | null> = {
  none: null,
  weekly: 'chores.recurrence.weekly',
  biweekly: 'chores.recurrence.biweekly',
  // monthly is unused on the chores surface today (the AddChore picker
  // only offers weekly/biweekly), but the RecurrenceFrequency union was
  // widened for the Recurring calendar events feature. Keep the map
  // exhaustive — a future "monthly chore" toggle just needs i18n copy.
  monthly: 'chores.recurrence.monthly',
};

function formatMoney(value: number): string {
  return CURRENCY.format(Number.isFinite(value) ? value : 0);
}

export function ChoresMemberScreen(props: ChoresMemberScreenProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { viewer, feed, onMarkComplete, onMarkCompleteWithProof, onViewHistory } = props;
  const { showToast } = useToast();
  const locale = i18n.resolvedLanguage ?? 'en';

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

  const handleMarkComplete = (choreId: string, file?: File): void => {
    // Guard: ignore a click while ANY mark-complete is in flight.
    if (submittingId !== null) return;
    setSubmittingId(choreId);
    // Pick the right action: with-proof when a file was attached AND the
    // route supplied the handler; otherwise the existing text-only path.
    const action =
      file !== undefined && onMarkCompleteWithProof !== undefined
        ? onMarkCompleteWithProof(choreId, file)
        : onMarkComplete(choreId);
    void action
      .then(() => {
        // Defer the success toast to a macrotask so the steady-state UI (the
        // chore moving into the "Waiting for approval" section) settles first.
        // The toast copy itself contains "waiting for approval", so announcing
        // it synchronously would briefly duplicate that phrase with the section
        // heading; the queued announcement still fires for assistive tech.
        setTimeout(() => showToast(t('chores.toast.completed')), 0);
        pendingFocusRef.current = true;
      })
      .catch((err: unknown) =>
        showToast(err instanceof Error ? err.message : t('chores.toast.generic')),
      )
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
        <h1 className="text-display font-display font-extrabold text-ink">{t('chores.title')}</h1>

        {/* EARNINGS card — the member's current balance, prominent (amber-light).
            No "earned this month" sum: the transactions ledger is a later
            feature. "View history" is a placeholder affordance for it. */}
        <div className="flex flex-col gap-8 rounded-card bg-accent-light p-16 shadow-card">
          <span className="text-meta font-semibold text-accent-dark">
            {t('chores.yourBalance')}
          </span>
          <span
            className="text-display font-display font-extrabold text-accent-dark"
            aria-label={`Your balance ${formatMoney(viewer.allowanceBalance)}`}
          >
            {formatMoney(viewer.allowanceBalance)}
          </span>
          {/* Allowance History shipped: a live control that navigates to the
              member's ledger (no longer the aria-disabled "coming soon"
              placeholder). */}
          <button
            type="button"
            onClick={onViewHistory}
            className="inline-flex min-h-tap items-center self-start text-meta font-semibold text-accent-dark underline focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            View history
          </button>
        </div>

        {feed.loading ? (
          <Skeleton label={t('chores.loadingMine')} />
        ) : !hasChores ? (
          <EmptyState message={t('chores.emptyMine')} />
        ) : (
          <>
            <ChoreSection
              title={t('chores.section.toDo')}
              chores={pending}
              locale={locale}
              onMarkComplete={handleMarkComplete}
              submittingId={submittingId}
              allowProof={onMarkCompleteWithProof !== undefined}
            />
            <ChoreSection
              title={t('chores.section.waitingForApproval')}
              chores={waiting}
              locale={locale}
              faded
              headingRef={waitingHeadingRef}
            />
            <ChoreSection
              title={t('chores.section.recentlyApproved')}
              chores={approved}
              locale={locale}
              strikeThrough
            />
            {/* Rejected chores get their OWN section with a "Try again" redo
                affordance (rejected -> complete; the rule now permits it). It
                reuses the SAME mark-complete action as the pending bucket. */}
            <ChoreSection
              title={t('chores.section.needsAnotherTry')}
              chores={rejected}
              locale={locale}
              onTryAgain={handleMarkComplete}
              submittingId={submittingId}
              allowProof={onMarkCompleteWithProof !== undefined}
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
  /** Active locale for friendlyDueDate (passed through from the screen). */
  locale: string;
  faded?: boolean | undefined;
  strikeThrough?: boolean | undefined;
  onMarkComplete?: ((choreId: string, file?: File) => void) | undefined;
  onTryAgain?: ((choreId: string, file?: File) => void) | undefined;
  submittingId?: string | null | undefined;
  headingRef?: RefObject<HTMLHeadingElement> | undefined;
  /** When true, the row shows an optional "Attach proof photo" affordance. */
  allowProof?: boolean | undefined;
}

function ChoreSection(props: ChoreSectionProps): ReactElement | null {
  const {
    title,
    chores,
    locale,
    faded,
    strikeThrough,
    onMarkComplete,
    onTryAgain,
    submittingId,
    headingRef,
    allowProof,
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
              locale={locale}
              faded={faded}
              strikeThrough={strikeThrough}
              onMarkComplete={onMarkComplete}
              onTryAgain={onTryAgain}
              submitting={submittingId === chore.id}
              allowProof={allowProof}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

interface ChoreRowProps {
  chore: ChoreWithId;
  locale: string;
  faded?: boolean | undefined;
  strikeThrough?: boolean | undefined;
  onMarkComplete?: ((choreId: string, file?: File) => void) | undefined;
  onTryAgain?: ((choreId: string, file?: File) => void) | undefined;
  submitting?: boolean | undefined;
  allowProof?: boolean | undefined;
}

function ChoreRow(props: ChoreRowProps): ReactElement {
  const { t } = useTranslation();
  const {
    chore,
    locale,
    faded,
    strikeThrough,
    onMarkComplete,
    onTryAgain,
    submitting,
    allowProof,
  } = props;
  // Per-row staged photo. State is local to the row because the file is
  // ephemeral until the kid taps Mark done — there's no shared state to
  // hoist. Cleared via setProofFile(null) after a successful submit.
  const [proofFile, setProofFile] = useState<File | null>(null);
  const proofInputId = useId();
  const isPending = chore.status === 'pending';
  const isApproved = chore.status === 'approved';
  const isRejected = chore.status === 'rejected';
  const recurrenceKey = chore.isRecurring ? RECURRENCE_I18N_KEY[chore.recurrenceFrequency] : null;
  const recurrenceLabel = recurrenceKey ? t(recurrenceKey) : '';
  const reasonId = useId();

  // Robust rejection reason: trim and fall back to a sensible visible line when
  // the parent sent the chore back without a note (absent/empty/whitespace).
  const trimmedReason = (chore.rejectionReason ?? '').trim();
  const reasonText = trimmedReason.length > 0 ? trimmedReason : t('chores.noReasonGiven');

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
          {t(STATUS_I18N_KEY[chore.status])}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-12 text-meta text-ink-mute">
        {/* The friendly date is VISIBLE text inside <time> (WCAG: not hidden in
            the attribute / aria-label alone); datetime carries the machine ISO. */}
        <span className="inline-flex items-center gap-4">
          {t('chores.due')}
          <time dateTime={chore.dueDate}>{friendlyDueDate(chore.dueDate, locale)}</time>
        </span>
        {/* Point value (the chore's reward for a member); the dollar value is
            surfaced as the EARNED amount once approved (below), mirroring the
            allowance flow. */}
        <span aria-label={`${chore.pointValue} points`}>{chore.pointValue} pts</span>
        <span aria-label={t('chores.worthLabel', { amount: formatMoney(chore.dollarValue) })}>
          {formatMoney(chore.dollarValue)}
        </span>
        {isApproved && (
          <span className="font-semibold text-status-ok-text">
            {t('chores.earnedSuffix', { amount: formatMoney(chore.dollarValue) })}
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
          <span className="font-semibold">{t('chores.rejectionReasonPrefix')} </span>
          {reasonText}
        </p>
      )}

      {(isRejected || isPending) && allowProof && (
        <ProofPicker
          inputId={proofInputId}
          file={proofFile}
          onPick={setProofFile}
          choreTitle={chore.title}
          disabled={submitting}
        />
      )}

      {isRejected && onTryAgain && (
        <button
          type="button"
          disabled={submitting}
          aria-disabled={submitting ? 'true' : undefined}
          aria-label={t('chores.tryAgainLabel', { title: chore.title })}
          onClick={() => onTryAgain(chore.id, proofFile ?? undefined)}
          className="inline-flex min-h-tap items-center justify-center self-start rounded-control bg-accent px-20 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-accent-dark active:bg-accent-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 motion-reduce:transition-none"
        >
          {t('chores.tryAgain')}
        </button>
      )}

      {isPending && onMarkComplete && (
        <button
          type="button"
          disabled={submitting}
          aria-disabled={submitting ? 'true' : undefined}
          aria-label={t('chores.markDoneLabel', { title: chore.title })}
          onClick={() => onMarkComplete(chore.id, proofFile ?? undefined)}
          className="inline-flex min-h-tap items-center justify-center self-start rounded-control bg-accent px-20 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-accent-dark active:bg-accent-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 motion-reduce:transition-none"
        >
          {t('chores.markDone')}
        </button>
      )}
    </div>
  );
}

/**
 * Tiny labelled file picker for chore proof photos. Kept inline (no new
 * file) because the only consumer is ChoreRow above. Real <label>+<input>
 * for full keyboard + screen-reader support. Type/size validation is
 * client-side defense in depth; chorePhotoService validates again before
 * Storage, and storage.rules validates one more time at the boundary.
 */
function ProofPicker(props: {
  inputId: string;
  file: File | null;
  onPick: (file: File | null) => void;
  choreTitle: string;
  disabled?: boolean | undefined;
}): ReactElement {
  const { t } = useTranslation();
  const { inputId, file, onPick, choreTitle, disabled } = props;
  return (
    <div className="flex flex-col gap-4 self-start">
      <label
        htmlFor={inputId}
        className="text-meta font-semibold text-ink-mute cursor-pointer underline focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus"
      >
        {t('chores.proof.attachLabel', { title: choreTitle })}
      </label>
      <input
        id={inputId}
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        onChange={(e) => {
          const picked = e.target.files?.[0] ?? null;
          onPick(picked);
        }}
        className="text-meta text-ink"
      />
      {file !== null && (
        <p className="text-meta text-status-info-text">{t('chores.proof.submitted')}</p>
      )}
    </div>
  );
}
