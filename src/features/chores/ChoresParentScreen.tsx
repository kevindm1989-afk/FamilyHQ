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
import { useTranslation } from 'react-i18next';
import { EmptyState, Fab, Skeleton } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { ChoreStatus, Role, UserWithId } from '../../lib/types';
import { statusBadgeClass, type ChoreWithId } from './choresMemberService';
import {
  ALL_MEMBERS_TAB_ID,
  MONEY_INVALID_INDICATOR,
  approvalQueue,
  choresForTab,
  formatMoney,
  isEditable as isChoreEditable,
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
  /** Open the (shared) chore sheet pre-filled with this chore for editing. */
  onEditChore: (chore: ChoreWithId) => void;
  /** Hard delete the chore. The screen wraps the call in a confirm step
   *  (two-tap inline confirmation) so a single tap never destroys data. */
  onDeleteChore: (choreId: string) => Promise<void>;
}

function friendlyDueDate(iso: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)));
}

export function ChoresParentScreen(props: ChoresParentScreenProps): ReactElement {
  const { t, i18n } = useTranslation();
  const { members, feed, onApprove, onReject, onAddChore, onEditChore, onDeleteChore } = props;
  // Per-row inline delete confirmation: first tap arms the row; second tap
  // commits. Tapping anything else (or another delete) cancels. Avoids a
  // modal dialog — keeps the tap target close to the action being confirmed.
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());

  const handleDelete = (choreId: string): void => {
    if (confirmingDeleteId !== choreId) {
      setConfirmingDeleteId(choreId);
      return;
    }
    setConfirmingDeleteId(null);
    setDeleting((prev) => new Set(prev).add(choreId));
    void onDeleteChore(choreId).finally(() => {
      setDeleting((prev) => {
        const next = new Set(prev);
        next.delete(choreId);
        return next;
      });
    });
  };
  const { showToast } = useToast();
  const locale = i18n.resolvedLanguage ?? 'en';

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
        showToast(t('chores.toast.approved'));
        pendingFocusRef.current = true;
      })
      .catch(() => showToast(t('chores.toast.generic')))
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
        showToast(t('chores.toast.rejected'));
        setRejectingId(null);
        setReason('');
        setReasonInvalid(false);
        pendingFocusRef.current = true;
      })
      .catch(() => showToast(t('chores.toast.generic')))
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
        <h1 className="text-display font-display font-extrabold text-ink">{t('chores.title')}</h1>

        {/* Per-member allowance balance chips (dynamic from active members). */}
        {members.length > 0 && (
          <ul className="flex flex-wrap gap-8" aria-label={t('chores.memberBalancesLabel')}>
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
          <Skeleton label={t('chores.loadingAll')} />
        ) : !hasAnyChores ? (
          <EmptyState message={t('chores.emptyAll')} />
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
                  {t('chores.awaitingApprovalCount', { count: awaitingCount })}
                </h2>
                <ul className="flex flex-col gap-8" aria-label={t('chores.awaitingApprovalLabel')}>
                  {queue.map((chore) => (
                    <li key={chore.id}>
                      <ApprovalRow
                        chore={chore}
                        assigneeName={nameById.get(chore.assignedTo) ?? t('chores.thisMember')}
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
            <div aria-label={t('chores.filterByMember')} className="flex flex-wrap gap-8">
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
                    {tab.id === ALL_MEMBERS_TAB_ID ? t('chores.filterAll') : tab.label}
                  </button>
                );
              })}
            </div>

            {visibleChores.length === 0 ? (
              <EmptyState message={t('chores.emptyForMember')} />
            ) : (
              <ul className="flex flex-col gap-8" aria-label={t('chores.choresList')}>
                {visibleChores.map((chore) => (
                  <li key={chore.id}>
                    <ChoreCard
                      chore={chore}
                      locale={locale}
                      editable={isChoreEditable(chore)}
                      onEdit={() => onEditChore(chore)}
                      confirmingDelete={confirmingDeleteId === chore.id}
                      deleting={deleting.has(chore.id)}
                      onDelete={() => handleDelete(chore.id)}
                      onCancelDelete={() => setConfirmingDeleteId(null)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="fixed bottom-fab-from-bottom right-16 z-fab">
        <Fab label={t('chores.addChoreFab')} onClick={onAddChore} />
      </div>

      <ToastViewport />
    </>
  );
}

/** Render a member's balance as formatted money, or a DISTINCT invalid indicator
 * (with an accessible name) when the cents value is non-finite/invalid — never a
 * misleading "$0.00" (Finding 8). */
function BalanceAmount(props: { name: string; cents: number }): ReactElement {
  const { t } = useTranslation();
  const { name, cents } = props;
  if (!isValidMoneyCents(cents)) {
    return (
      <span
        className="text-body font-bold text-ink-mute"
        aria-label={t('chores.balanceUnavailable', { name })}
      >
        {MONEY_INVALID_INDICATOR}
      </span>
    );
  }
  return (
    <span
      className="text-body font-bold text-accent-dark"
      aria-label={t('chores.balanceLabel', { name, amount: formatMoney(cents) })}
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
  const { t } = useTranslation();
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
          {t('chores.status.waiting')}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-12 text-meta text-ink-mute">
        <span aria-label={`${chore.pointValue} points`}>
          {chore.pointValue} {chore.pointValue === 1 ? 'pt' : 'pts'}
        </span>
        {/* Dollar reward shown as VISIBLE formatted money, labelled as a dollar
            reward — NOT mislabelled "points" (Finding 4). */}
        <span aria-label={t('chores.rewardLabel', { amount: formatMoney(chore.dollarValue) })}>
          {formatMoney(chore.dollarValue)} {t('chores.rewardSuffix')}
        </span>
      </div>
      {chore.proofImageUrl !== undefined && chore.proofImageUrl !== '' && (
        // Feature 2 — Phase 2: kid attached a proof photo. Show a small
        // thumbnail with a "View full size" link that opens the original in
        // a new tab. Image is wrapped in an anchor (real link semantics +
        // open in new tab via target=_blank rel=noopener). Alt-text names
        // the chore so a screen-reader user gets the context.
        <a
          href={chore.proofImageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block self-start focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          aria-label={t('chores.proof.viewFull')}
        >
          <img
            src={chore.proofImageUrl}
            alt={t('chores.proof.thumbAlt', { title: chore.title })}
            className="h-64 w-64 rounded-control border border-surface-line object-cover"
            loading="lazy"
            data-testid="chore-proof-thumb"
          />
        </a>
      )}

      <div className="flex gap-8">
        <button
          type="button"
          onClick={onApprove}
          disabled={submitting}
          aria-disabled={submitting ? 'true' : undefined}
          aria-busy={submitting ? 'true' : undefined}
          aria-label={t('chores.approveLabel', { title: chore.title, assignee: assigneeName })}
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-status-ok px-20 text-body font-semibold text-status-ok-text transition-colors duration-cardPress ease-out hover:bg-status-ok-light focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 motion-reduce:transition-none"
        >
          {t('chores.approve')}
        </button>
        <button
          type="button"
          onClick={onStartReject}
          aria-expanded={rejecting}
          aria-controls={regionId}
          aria-label={t('chores.rejectLabel', { title: chore.title, assignee: assigneeName })}
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line px-20 text-body font-semibold text-ink transition-colors duration-cardPress ease-out hover:bg-surface-line2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
        >
          {t('chores.reject')}
        </button>
      </div>

      {rejecting && (
        <div id={regionId} className="flex flex-col gap-8">
          <label
            htmlFor={`reason-${chore.id}`}
            id={labelId}
            className="text-label font-semibold text-ink-2"
          >
            {t('chores.reasonPrompt')}
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
              {t('chores.reasonRequired')}
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
            {t('chores.sendBack')}
          </button>
        </div>
      )}
    </div>
  );
}

interface ChoreCardProps {
  chore: ChoreWithId;
  locale: string;
  /** True when the chore's status permits content edit (pending|rejected). */
  editable: boolean;
  onEdit: () => void;
  /** True after the FIRST delete tap on this row — the button text + style
   *  flips to a confirm prompt. A second tap commits. */
  confirmingDelete: boolean;
  /** True while the delete request is in flight. */
  deleting: boolean;
  onDelete: () => void;
  /** Tapping anywhere else cancels confirm; this lets the row's own
   *  on-blur-style escape cancel without a global listener. */
  onCancelDelete: () => void;
}

function ChoreCard(props: ChoreCardProps): ReactElement {
  const { t } = useTranslation();
  const { chore, locale, editable, onEdit, confirmingDelete, deleting, onDelete, onCancelDelete } =
    props;
  const STATUS_I18N_KEY: Record<ChoreStatus, string> = {
    pending: 'chores.status.pending',
    complete: 'chores.status.waiting',
    approved: 'chores.status.approved',
    rejected: 'chores.status.sentBack',
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
          {t(STATUS_I18N_KEY[chore.status] ?? 'chores.status.pending')}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-12 text-meta text-ink-mute">
        <span className="inline-flex items-center gap-4">
          {t('chores.due')}
          <time dateTime={chore.dueDate}>{friendlyDueDate(chore.dueDate, locale)}</time>
        </span>
        {/* Point value shown SEPARATELY as points. */}
        <span aria-label={`${chore.pointValue} points`}>
          {chore.pointValue} {chore.pointValue === 1 ? 'pt' : 'pts'}
        </span>
        {/* Dollar reward shown as VISIBLE formatted money, labelled as a dollar
            reward — NOT mislabelled "points" (Finding 4). The money text node is
            money-only so it never reads "reward points". */}
        <span className="inline-flex items-center gap-4">
          <span aria-label={t('chores.rewardLabel', { amount: formatMoney(chore.dollarValue) })}>
            {formatMoney(chore.dollarValue)}
          </span>
          {t('chores.rewardSuffix')}
        </span>
      </span>
      {/* Parent-only management controls. Edit is hidden when the chore is
          past the pre-earned window (status=complete|approved) — mirrors the
          firestore.rules `parentChoreEdit` guard via the isEditable selector
          so a button never tempts a user into a server-side rejection. */}
      <span className="flex flex-wrap items-center justify-end gap-8 pt-4">
        {editable ? (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line bg-surface-card px-12 text-label font-semibold text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            {t('chores.edit')}
          </button>
        ) : null}
        {confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={onCancelDelete}
              className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line bg-surface-card px-12 text-label font-semibold text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-status-danger-text bg-status-danger-text px-12 text-label font-semibold text-white focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('chores.confirmDelete')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line bg-surface-card px-12 text-label font-semibold text-status-danger-text focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('chores.delete')}
          </button>
        )}
      </span>
    </div>
  );
}
