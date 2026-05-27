/**
 * Chores PARENT screen (Phase 3, Task 11; handoff 05b ChoresParentScreen).
 *
 * Designer-defined states:
 *  - LOADING            -> Skeleton (role="status")
 *  - EMPTY (no chores)  -> friendly EmptyState
 *  - APPROVALS QUEUE    -> status=='complete' chores with Approve + Reject;
 *                          Reject opens a required reason input
 *  - PENDING-APPROVAL badge -> derived count of complete chores
 *  - BALANCE CHIPS      -> a chip per active member showing allowanceBalance
 *  - MEMBER FILTER TABS -> "All" + one per active member (DYNAMIC); selecting
 *                          filters the list; per-tab empty state
 *  - FAB                -> opens Add Chore (parent-only)
 *
 * Money is INTEGER CENTS everywhere (second-opinion #4 / Finding 7): the screen
 * formats cents to "$X.XX" only for display (formatMoney). A non-finite /
 * invalid balance renders a DISTINCT indicator, never a misleading "$0.00"
 * (Finding 8).
 *
 * Feed state + actions are INJECTED so the screen renders deterministically
 * without Firestore. firestore.rules is the real authority boundary.
 *
 * WCAG: status is conveyed as TEXT (section headings + labelled badges), never
 * colour alone; every action is a real focusable <button>; the single
 * ToastViewport live region announces every action. The approve/reject in-flight
 * guard is PER-CHORE (Finding 3) so a stuck row never blocks another.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { EmptyState, Fab, Skeleton } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { Role, UserWithId } from '../../lib/types';
import { statusBadgeClass, type ChoreWithId } from './choresMemberService';
import {
  ALL_MEMBERS_TAB_ID,
  CHORE_APPROVE_SUCCESS,
  CHORE_PARENT_GENERIC_ERROR,
  CHORE_REJECT_SUCCESS,
  MONEY_INVALID_INDICATOR,
  approvalQueue,
  choresForTab,
  formatMoney,
  isValidMoneyCents,
  memberFilterTabs,
  pendingApprovalCount,
} from './choresParentService';

export interface ChoresParentScreenProps {
  familyId: string | null;
  viewer: { uid: string; name: string; role: Role };
  /** Active family members — drives the filter tabs + balance chips (dynamic). */
  members: UserWithId[];
  feed: {
    chores: ChoreWithId[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  };
  /** Injected approve action (wired to choresParentService.approveChore + toast). */
  onApprove: (choreId: string) => Promise<void>;
  /** Injected reject action (wired to choresParentService.rejectChore + toast). */
  onReject: (choreId: string, reason: string) => Promise<void>;
  /** Open the Add Chore sheet (FAB). */
  onAddChore: () => void;
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-CA', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

function friendlyDueDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return DATE_FORMAT.format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)));
}

export function ChoresParentScreen(props: ChoresParentScreenProps): ReactElement {
  const { members, feed, onApprove, onReject, onAddChore } = props;
  const { showToast } = useToast();

  const [selectedTab, setSelectedTab] = useState<string>(ALL_MEMBERS_TAB_ID);
  // The chore currently in the reject-reason flow (null when no reason form is
  // open), plus the in-progress reason text.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  // PER-CHORE in-flight guard (Finding 3): the set of chore ids whose approve/
  // reject is currently in flight. A stuck action on one row never blocks
  // another row, and a second click on the SAME in-flight row is a no-op.
  const [submitting, setSubmitting] = useState<ReadonlySet<string>>(new Set());
  // True once a reject confirm was attempted with an empty reason — surfaces the
  // reason field as aria-invalid with an associated error (not a silent no-op).
  const [reasonInvalid, setReasonInvalid] = useState(false);

  // After a successful approve/reject the resolved row unmounts; move focus to
  // the awaiting-approval heading so a keyboard / screen-reader user is not
  // stranded on the removed button.
  const awaitingHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocusRef = useRef(false);

  const nameById = new Map(members.map((m) => [m.id, m.name] as const));
  const tabs = memberFilterTabs(members);
  const queue = approvalQueue(feed.chores);
  const awaitingCount = pendingApprovalCount(feed.chores);

  // The lower list shows the non-complete chores for the selected member tab;
  // complete chores live exclusively in the approvals queue above, so a chore
  // never appears in two places at once.
  const visibleChores = choresForTab(feed.chores, selectedTab).filter(
    (c) => c.status !== 'complete',
  );
  const hasAnyChores = feed.chores.length > 0;

  const markSubmitting = (choreId: string, on: boolean): void => {
    setSubmitting((prev) => {
      const next = new Set(prev);
      if (on) next.add(choreId);
      else next.delete(choreId);
      return next;
    });
  };

  const handleApprove = (choreId: string): void => {
    // Per-row guard: ignore a click while THIS row's action is in flight.
    if (submitting.has(choreId)) return;
    markSubmitting(choreId, true);
    void onApprove(choreId)
      .then(() => {
        showToast(CHORE_APPROVE_SUCCESS);
        pendingFocusRef.current = true;
      })
      .catch(() => showToast(CHORE_PARENT_GENERIC_ERROR))
      .finally(() => markSubmitting(choreId, false));
  };

  const handleConfirmReject = (choreId: string): void => {
    if (submitting.has(choreId)) return;
    const trimmed = reason.trim();
    // UI validation: an empty/whitespace reason is NOT a silent no-op — flag the
    // field invalid + surface the associated error line (a11y).
    if (trimmed.length === 0) {
      setReasonInvalid(true);
      return;
    }
    markSubmitting(choreId, true);
    void onReject(choreId, trimmed)
      .then(() => {
        showToast(CHORE_REJECT_SUCCESS);
        setRejectingId(null);
        setReason('');
        setReasonInvalid(false);
        pendingFocusRef.current = true;
      })
      .catch(() => showToast(CHORE_PARENT_GENERIC_ERROR))
      .finally(() => markSubmitting(choreId, false));
  };

  const handleStartReject = (choreId: string): void => {
    setRejectingId(choreId);
    setReason('');
    setReasonInvalid(false);
  };

  // After a successful approve/reject, move focus to the awaiting heading once
  // it is on screen (the resolved row's buttons have unmounted).
  useEffect(() => {
    if (pendingFocusRef.current && awaitingHeadingRef.current) {
      pendingFocusRef.current = false;
      awaitingHeadingRef.current.focus();
    }
  });

  return (
    <>
      <section className="flex flex-col gap-16 px-16 pt-4 pb-24">
        <h1 className="text-display font-display font-extrabold text-ink">Chores</h1>

        {/* Per-member allowance balance chips (dynamic from active members). */}
        {members.length > 0 && (
          <ul className="flex flex-wrap gap-8" aria-label="Member balances">
            {members.map((m) => (
              <li
                key={m.id}
                className="inline-flex items-center gap-8 rounded-control bg-accent-light px-14 py-8"
              >
                <span className="text-meta font-semibold text-accent-dark">{m.name}</span>
                <BalanceAmount name={m.name} cents={m.allowanceBalance} />
              </li>
            ))}
          </ul>
        )}

        {feed.loading ? (
          <Skeleton label="Loading chores…" />
        ) : !hasAnyChores ? (
          <EmptyState message="No chores yet — add a chore to get started." />
        ) : (
          <>
            {/* Approvals queue — complete chores awaiting parent action. */}
            {queue.length > 0 && (
              <div className="flex flex-col gap-12">
                <h2
                  ref={awaitingHeadingRef}
                  tabIndex={-1}
                  className="text-title font-bold text-ink outline-none focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                >
                  {awaitingCount} awaiting approval
                </h2>
                <ul className="flex flex-col gap-8" aria-label="Awaiting approval">
                  {queue.map((chore) => (
                    <li key={chore.id}>
                      <ApprovalRow
                        chore={chore}
                        assigneeName={nameById.get(chore.assignedTo) ?? 'this member'}
                        rejecting={rejectingId === chore.id}
                        reason={reason}
                        reasonInvalid={reasonInvalid}
                        submitting={submitting.has(chore.id)}
                        onApprove={() => handleApprove(chore.id)}
                        onStartReject={() => handleStartReject(chore.id)}
                        onReasonChange={(v) => {
                          setReason(v);
                          if (v.trim().length > 0) setReasonInvalid(false);
                        }}
                        onConfirmReject={() => handleConfirmReject(chore.id)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Member filter toggles — All + one per active member (dynamic).
                Real toggle buttons with aria-pressed (NOT a composite tablist):
                each is individually focusable and announced as a toggle. */}
            <div aria-label="Filter by member" className="flex flex-wrap gap-8">
              {tabs.map((tab) => {
                const selected = selectedTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSelectedTab(tab.id)}
                    className={`inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border px-14 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
                      selected
                        ? 'border-brand bg-brand-light text-brand'
                        : 'border-surface-line bg-surface-card text-ink'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {visibleChores.length === 0 ? (
              <EmptyState message="No chores for this member yet — add a chore." />
            ) : (
              <ul className="flex flex-col gap-8" aria-label="Chores">
                {visibleChores.map((chore) => (
                  <li key={chore.id}>
                    <ChoreCard chore={chore} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="fixed bottom-fab-from-bottom right-16 z-fab">
        <Fab label="Add chore" onClick={onAddChore} />
      </div>

      <ToastViewport />
    </>
  );
}

/** Render a member's balance as formatted money, or a DISTINCT invalid indicator
 * (with an accessible name) when the cents value is non-finite/invalid — never a
 * misleading "$0.00" (Finding 8). */
function BalanceAmount(props: { name: string; cents: number }): ReactElement {
  const { name, cents } = props;
  if (!isValidMoneyCents(cents)) {
    return (
      <span
        className="text-body font-bold text-ink-mute"
        aria-label={`${name} balance unavailable`}
      >
        {MONEY_INVALID_INDICATOR}
      </span>
    );
  }
  return (
    <span
      className="text-body font-bold text-accent-dark"
      aria-label={`${name} balance ${formatMoney(cents)}`}
    >
      {formatMoney(cents)}
    </span>
  );
}

interface ApprovalRowProps {
  chore: ChoreWithId;
  assigneeName: string;
  rejecting: boolean;
  reason: string;
  reasonInvalid: boolean;
  submitting: boolean;
  onApprove: () => void;
  onStartReject: () => void;
  onReasonChange: (value: string) => void;
  onConfirmReject: () => void;
}

function ApprovalRow(props: ApprovalRowProps): ReactElement {
  const {
    chore,
    assigneeName,
    rejecting,
    reason,
    reasonInvalid,
    submitting,
    onApprove,
    onStartReject,
    onReasonChange,
    onConfirmReject,
  } = props;
  const reasonInputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const regionId = useId();
  const errorId = useId();

  // Move focus into the reason input when the reject disclosure is revealed.
  useEffect(() => {
    if (rejecting) reasonInputRef.current?.focus();
  }, [rejecting]);

  return (
    <div className="flex flex-col gap-8 rounded-control border border-surface-line bg-surface-card px-14 py-12">
      <div className="flex items-center gap-12">
        <span className="flex-1 text-body font-semibold text-ink">{chore.title}</span>
        <span
          className={`inline-flex h-badge items-center rounded-full px-10 text-badge font-semibold ${statusBadgeClass(
            chore.status,
          )}`}
        >
          Waiting
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-12 text-meta text-ink-mute">
        <span aria-label={`${chore.pointValue} points`}>
          {chore.pointValue} {chore.pointValue === 1 ? 'pt' : 'pts'}
        </span>
        {/* Dollar reward shown as VISIBLE formatted money, labelled as a dollar
            reward — NOT mislabelled "points" (Finding 4). */}
        <span aria-label={`reward ${formatMoney(chore.dollarValue)}`}>
          {formatMoney(chore.dollarValue)} reward
        </span>
      </div>

      <div className="flex gap-8">
        <button
          type="button"
          onClick={onApprove}
          disabled={submitting}
          aria-disabled={submitting ? 'true' : undefined}
          aria-busy={submitting ? 'true' : undefined}
          aria-label={`Approve ${chore.title} for ${assigneeName}`}
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-status-ok px-20 text-body font-semibold text-status-ok-text transition-colors duration-cardPress ease-out hover:bg-status-ok-light focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 motion-reduce:transition-none"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onStartReject}
          aria-expanded={rejecting}
          aria-controls={regionId}
          aria-label={`Reject ${chore.title} for ${assigneeName}`}
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line px-20 text-body font-semibold text-ink transition-colors duration-cardPress ease-out hover:bg-surface-line2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
        >
          Reject
        </button>
      </div>

      {rejecting && (
        <div id={regionId} className="flex flex-col gap-8">
          <label
            htmlFor={`reason-${chore.id}`}
            id={labelId}
            className="text-label font-semibold text-ink-2"
          >
            Why are you sending it back?
          </label>
          <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
            <input
              id={`reason-${chore.id}`}
              ref={reasonInputRef}
              type="text"
              value={reason}
              aria-required="true"
              aria-invalid={reasonInvalid || undefined}
              aria-describedby={reasonInvalid ? errorId : undefined}
              onChange={(e) => onReasonChange(e.target.value)}
              className="w-full bg-transparent text-body text-ink placeholder:text-ink-mute2 focus:outline-none"
            />
          </div>
          {reasonInvalid && (
            <p
              id={errorId}
              role="alert"
              className="text-meta font-semibold text-status-danger-text"
            >
              Please add a short reason before sending it back.
            </p>
          )}
          <button
            type="button"
            onClick={onConfirmReject}
            disabled={submitting}
            aria-disabled={submitting ? 'true' : undefined}
            aria-busy={submitting ? 'true' : undefined}
            className="inline-flex min-h-tap min-w-tap items-center justify-center self-start rounded-control bg-status-danger px-20 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-status-danger-text focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 motion-reduce:transition-none"
          >
            Send back
          </button>
        </div>
      )}
    </div>
  );
}

function ChoreCard(props: { chore: ChoreWithId }): ReactElement {
  const { chore } = props;
  const STATUS_LABEL: Record<string, string> = {
    pending: 'To do',
    complete: 'Waiting',
    approved: 'Approved',
    rejected: 'Sent back',
  };
  return (
    <div className="flex flex-col gap-8 rounded-control border border-surface-line bg-surface-card px-14 py-12">
      <span className="flex items-center gap-12">
        <span className="flex-1 text-body font-semibold text-ink">{chore.title}</span>
        <span
          className={`inline-flex h-badge items-center rounded-full px-10 text-badge font-semibold ${statusBadgeClass(
            chore.status,
          )}`}
        >
          {STATUS_LABEL[chore.status] ?? 'To do'}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-12 text-meta text-ink-mute">
        <span className="inline-flex items-center gap-4">
          Due
          <time dateTime={chore.dueDate}>{friendlyDueDate(chore.dueDate)}</time>
        </span>
        {/* Point value shown SEPARATELY as points. */}
        <span aria-label={`${chore.pointValue} points`}>
          {chore.pointValue} {chore.pointValue === 1 ? 'pt' : 'pts'}
        </span>
        {/* Dollar reward shown as VISIBLE formatted money, labelled as a dollar
            reward — NOT mislabelled "points" (Finding 4). The money text node is
            money-only so it never reads "reward points". */}
        <span className="inline-flex items-center gap-4">
          <span aria-label={`reward ${formatMoney(chore.dollarValue)}`}>
            {formatMoney(chore.dollarValue)}
          </span>
          reward
        </span>
      </span>
    </div>
  );
}
