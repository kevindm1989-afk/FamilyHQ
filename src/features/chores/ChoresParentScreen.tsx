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
 * Feed state + actions are INJECTED so the screen renders deterministically
 * without Firestore. firestore.rules is the real authority boundary.
 *
 * WCAG: status is conveyed as TEXT (section headings + labelled badges), never
 * colour alone; every action is a real focusable <button>; the single
 * ToastViewport live region announces every action.
 */
import { useState, type ReactElement } from 'react';
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
  approvalQueue,
  choresForTab,
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

const CURRENCY = new Intl.NumberFormat('en-CA', {
  style: 'currency',
  currency: 'CAD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatMoney(value: number): string {
  return CURRENCY.format(Number.isFinite(value) ? value : 0);
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
  const [submittingId, setSubmittingId] = useState<string | null>(null);

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

  const handleApprove = (choreId: string): void => {
    if (submittingId !== null) return;
    setSubmittingId(choreId);
    void onApprove(choreId)
      .then(() => showToast(CHORE_APPROVE_SUCCESS))
      .catch(() => showToast(CHORE_PARENT_GENERIC_ERROR))
      .finally(() => setSubmittingId(null));
  };

  const handleConfirmReject = (choreId: string): void => {
    const trimmed = reason.trim();
    // UI validation: do not call onReject with an empty/whitespace reason.
    if (trimmed.length === 0 || submittingId !== null) return;
    setSubmittingId(choreId);
    void onReject(choreId, trimmed)
      .then(() => {
        showToast(CHORE_REJECT_SUCCESS);
        setRejectingId(null);
        setReason('');
      })
      .catch(() => showToast(CHORE_PARENT_GENERIC_ERROR))
      .finally(() => setSubmittingId(null));
  };

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
                <span
                  className="text-body font-bold text-accent-dark"
                  aria-label={`${m.name} balance ${formatMoney(m.allowanceBalance)}`}
                >
                  {formatMoney(m.allowanceBalance)}
                </span>
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
                <h2 className="text-title font-bold text-ink">{awaitingCount} awaiting approval</h2>
                <ul className="flex flex-col gap-8" aria-label="Awaiting approval">
                  {queue.map((chore) => (
                    <li key={chore.id}>
                      <ApprovalRow
                        chore={chore}
                        rejecting={rejectingId === chore.id}
                        reason={reason}
                        onApprove={() => handleApprove(chore.id)}
                        onStartReject={() => {
                          setRejectingId(chore.id);
                          setReason('');
                        }}
                        onReasonChange={setReason}
                        onConfirmReject={() => handleConfirmReject(chore.id)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Member filter tabs — All + one per active member (dynamic). */}
            <div role="tablist" aria-label="Filter by member" className="flex flex-wrap gap-8">
              {tabs.map((tab) => {
                const selected = selectedTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setSelectedTab(tab.id)}
                    className={`inline-flex min-h-tap items-center rounded-control border px-14 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
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

interface ApprovalRowProps {
  chore: ChoreWithId;
  rejecting: boolean;
  reason: string;
  onApprove: () => void;
  onStartReject: () => void;
  onReasonChange: (value: string) => void;
  onConfirmReject: () => void;
}

function ApprovalRow(props: ApprovalRowProps): ReactElement {
  const { chore, rejecting, reason, onApprove, onStartReject, onReasonChange, onConfirmReject } =
    props;
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
        <span aria-label={`worth ${formatMoney(chore.dollarValue)}`}>
          {formatMoney(chore.dollarValue)}
        </span>
      </div>

      <div className="flex gap-8">
        <button
          type="button"
          onClick={onApprove}
          aria-label={`Approve: ${chore.title}`}
          className="inline-flex min-h-tap items-center justify-center rounded-control bg-status-ok px-20 text-body font-semibold text-status-ok-text transition-colors duration-cardPress ease-out hover:bg-status-ok-light focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={onStartReject}
          aria-label={`Reject: ${chore.title}`}
          className="inline-flex min-h-tap items-center justify-center rounded-control border border-surface-line px-20 text-body font-semibold text-ink transition-colors duration-cardPress ease-out hover:bg-surface-line2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
        >
          Reject
        </button>
      </div>

      {rejecting && (
        <div className="flex flex-col gap-8">
          <label
            htmlFor={`reject-reason-${chore.id}`}
            className="text-label font-semibold text-ink-2"
          >
            Why are you sending it back?
          </label>
          <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
            <input
              id={`reject-reason-${chore.id}`}
              type="text"
              value={reason}
              aria-label="Reason"
              onChange={(e) => onReasonChange(e.target.value)}
              className="w-full bg-transparent text-body text-ink placeholder:text-ink-mute2 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={onConfirmReject}
            className="inline-flex min-h-tap items-center justify-center self-start rounded-control bg-status-danger px-20 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-status-danger-text focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
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
      <div className="flex items-center gap-12">
        <span className="flex-1 text-body font-semibold text-ink">{chore.title}</span>
        <span
          className={`inline-flex h-badge items-center rounded-full px-10 text-badge font-semibold ${statusBadgeClass(
            chore.status,
          )}`}
        >
          {STATUS_LABEL[chore.status] ?? 'To do'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-12 text-meta text-ink-mute">
        <span className="inline-flex items-center gap-4">
          Due
          <time dateTime={chore.dueDate}>{friendlyDueDate(chore.dueDate)}</time>
        </span>
        <span aria-label={`${chore.pointValue} points`}>{chore.pointValue} pts</span>
        {/* Money lives in the aria-label only here so the visible "$X.XX" text
            form is carried solely by the per-member balance chips (the
            member-view matcher lesson — a chore reward must not false-match a
            balance of the same value). */}
        <span aria-label={`reward ${formatMoney(chore.dollarValue)}`}>
          {chore.dollarValue} reward {chore.dollarValue === 1 ? 'point' : 'points'}
        </span>
      </div>
    </div>
  );
}
