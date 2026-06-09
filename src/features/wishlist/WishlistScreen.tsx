/**
 * WishlistScreen — props-injected wishlist + redemption queue.
 *
 * Layout:
 *  - Header
 *  - LOADING → Skeleton
 *  - ERROR → role=alert inline (single channel — no parallel toast)
 *  - PENDING APPROVALS section (parent-only) — items where status='requested';
 *    Approve and Deny actions, Deny opens a required reason input
 *  - WISHLIST list (everyone) — wishing + denied items, grouped by status
 *    so a denied item can be revived ("Try again") and a wishing item can
 *    be Requested.
 *  - REDEEMED list (collapsed below) — recent redemptions, read-only
 *  - FAB → opens "Add wish" sheet
 *
 * Per-row actions are gated by viewer relationship to the item:
 *  - Owner of a wishing item: Edit / Delete / Request
 *  - Owner of a requested item: Cancel request
 *  - Parent (any item, status='requested'): Approve / Deny (with reason)
 *  - Owner of a denied item: Try again (denied → wishing)
 *
 * Authority is enforced by firestore.rules — these affordances are
 * cosmetic. Money is INTEGER CENTS everywhere; format only for display.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, BottomSheet, Button, EmptyState, Fab, Skeleton, TextField } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { Role, UserWithId, WishlistStatus } from '../../lib/types';
import { formatMoney, isValidMoneyCents } from '../allowance/allowanceService';
import { parseDollarsToCents } from './parseDollars';
import {
  WISHLIST_DENIED_REASON_MAX,
  WISHLIST_TITLE_MAX,
  pendingRedemptions,
  totalRequestedCents,
  type WishlistItemWithId,
} from './wishlistService';

export interface WishlistScreenProps {
  viewer: { uid: string; name: string; role: Role };
  members: UserWithId[];
  feed: {
    items: WishlistItemWithId[];
    loading: boolean;
    error: string | null;
  };
  onCreate?: (input: { title: string; costCents: number }) => Promise<void>;
  onUpdate?: (itemId: string, patch: { title?: string; costCents?: number }) => Promise<void>;
  onDelete?: (itemId: string) => Promise<void>;
  onRequest?: (itemId: string) => Promise<void>;
  onCancelRequest?: (itemId: string) => Promise<void>;
  onApprove?: (itemId: string) => Promise<void>;
  onDeny?: (itemId: string, reason: string) => Promise<void>;
}

export function WishlistScreen(props: WishlistScreenProps): ReactElement {
  const { t } = useTranslation();
  const {
    viewer,
    members,
    feed,
    onCreate,
    onUpdate,
    onDelete,
    onRequest,
    onCancelRequest,
    onApprove,
    onDeny,
  } = props;
  const { showToast } = useToast();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<WishlistItemWithId | null>(null);
  const [denyingId, setDenyingId] = useState<string | null>(null);
  const [denyReason, setDenyReason] = useState('');
  const [denyReasonInvalid, setDenyReasonInvalid] = useState(false);
  const [submitting, setSubmitting] = useState<ReadonlySet<string>>(new Set());

  const isParent = viewer.role === 'parent';
  const nameById = new Map(members.map((m) => [m.id, m.name] as const));

  const queue = useMemo(() => pendingRedemptions(feed.items), [feed.items]);
  const requestedTotalCents = useMemo(() => totalRequestedCents(feed.items), [feed.items]);

  const ownItems = feed.items.filter((i) => i.ownerUid === viewer.uid);
  // Show YOUR own wishing/requested/denied items in the main list; redeemed
  // siblings sit in a "Recently redeemed" footer so the queue stays tight.
  const myActive = ownItems.filter((i) => i.status !== 'redeemed');
  const myRedeemed = ownItems.filter((i) => i.status === 'redeemed');
  myActive.sort(
    (a, b) => statusOrder(a.status) - statusOrder(b.status) || b.createdAt - a.createdAt,
  );
  myRedeemed.sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));

  // Parent-only: a focus target after a resolve action so the resolved row's
  // unmounted buttons don't strand the keyboard / screen-reader user.
  const queueHeadingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocusRef = useRef(false);
  useEffect(() => {
    if (pendingFocusRef.current && queueHeadingRef.current) {
      pendingFocusRef.current = false;
      queueHeadingRef.current.focus();
    }
  });

  const markSubmitting = (id: string, on: boolean): void => {
    setSubmitting((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleApprove = (id: string): void => {
    if (submitting.has(id) || onApprove === undefined) return;
    markSubmitting(id, true);
    void onApprove(id)
      .then(() => {
        showToast(t('wishlist.toast.approved'));
        pendingFocusRef.current = true;
      })
      .catch((err) => showToast(err instanceof Error ? err.message : t('wishlist.toast.generic')))
      .finally(() => markSubmitting(id, false));
  };

  const handleStartDeny = (id: string): void => {
    setDenyingId(id);
    setDenyReason('');
    setDenyReasonInvalid(false);
  };

  const handleConfirmDeny = (id: string): void => {
    if (submitting.has(id) || onDeny === undefined) return;
    const trimmed = denyReason.trim();
    if (trimmed.length === 0) {
      setDenyReasonInvalid(true);
      return;
    }
    markSubmitting(id, true);
    void onDeny(id, trimmed)
      .then(() => {
        showToast(t('wishlist.toast.denied'));
        setDenyingId(null);
        setDenyReason('');
        setDenyReasonInvalid(false);
        pendingFocusRef.current = true;
      })
      .catch((err) => showToast(err instanceof Error ? err.message : t('wishlist.toast.generic')))
      .finally(() => markSubmitting(id, false));
  };

  const handleRequest = (id: string): void => {
    if (submitting.has(id) || onRequest === undefined) return;
    markSubmitting(id, true);
    void onRequest(id)
      .then(() => showToast(t('wishlist.toast.requested')))
      .catch((err) => showToast(err instanceof Error ? err.message : t('wishlist.toast.generic')))
      .finally(() => markSubmitting(id, false));
  };

  const handleCancel = (id: string): void => {
    if (submitting.has(id) || onCancelRequest === undefined) return;
    markSubmitting(id, true);
    void onCancelRequest(id)
      .then(() => showToast(t('wishlist.toast.cancelled')))
      .catch((err) => showToast(err instanceof Error ? err.message : t('wishlist.toast.generic')))
      .finally(() => markSubmitting(id, false));
  };

  const handleDelete = (id: string): void => {
    if (submitting.has(id) || onDelete === undefined) return;
    markSubmitting(id, true);
    void onDelete(id)
      .then(() => showToast(t('wishlist.toast.deleted')))
      .catch((err) => showToast(err instanceof Error ? err.message : t('wishlist.toast.generic')))
      .finally(() => markSubmitting(id, false));
  };

  const viewerBalance = members.find((m) => m.id === viewer.uid)?.allowanceBalance;

  return (
    <>
      <section aria-label={t('wishlist.title')} className="flex flex-col gap-16 px-16 pt-4 pb-24">
        <h1 className="text-display font-display font-extrabold text-ink">{t('wishlist.title')}</h1>

        {/* Viewer balance — shown to members so they can tell whether they
            can afford their wish. Parents see per-member chips instead. */}
        {!isParent && viewerBalance !== undefined && <BalanceCard amountCents={viewerBalance} />}
        {isParent && members.length > 0 && (
          <ul className="flex flex-wrap gap-8" aria-label={t('wishlist.memberBalancesLabel')}>
            {members
              .filter((m) => m.role === 'member')
              .map((m) => (
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

        {feed.loading && <Skeleton label={t('wishlist.loading')} />}
        {feed.error !== null && !feed.loading && (
          <p
            role="alert"
            className="rounded-control border border-surface-line bg-status-danger-light px-14 py-12 text-meta font-semibold text-status-danger-text"
          >
            {feed.error}
          </p>
        )}

        {!feed.loading && feed.error === null && (
          <>
            {/* Parent-only: pending redemption requests across the whole
                family. Approve / Deny actions live here. */}
            {isParent && queue.length > 0 && (
              <div className="flex flex-col gap-12">
                <h2
                  ref={queueHeadingRef}
                  tabIndex={-1}
                  className="text-title font-bold text-ink outline-none focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                >
                  {t('wishlist.queue.heading', { count: queue.length })}
                </h2>
                <p className="text-meta text-ink-mute">
                  {t('wishlist.queue.totalRequested', {
                    amount: formatMoney(requestedTotalCents),
                  })}
                </p>
                <ul className="flex flex-col gap-8" aria-label={t('wishlist.queue.listLabel')}>
                  {queue.map((item) => (
                    <li key={item.id}>
                      <ApprovalRow
                        item={item}
                        ownerName={nameById.get(item.ownerUid) ?? t('wishlist.unknownMember')}
                        denying={denyingId === item.id}
                        reason={denyReason}
                        reasonInvalid={denyReasonInvalid}
                        submitting={submitting.has(item.id)}
                        canApprove={onApprove !== undefined}
                        canDeny={onDeny !== undefined}
                        onApprove={() => handleApprove(item.id)}
                        onStartDeny={() => handleStartDeny(item.id)}
                        onReasonChange={(v) => {
                          setDenyReason(v);
                          if (v.trim().length > 0) setDenyReasonInvalid(false);
                        }}
                        onConfirmDeny={() => handleConfirmDeny(item.id)}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Everyone's own active items (wishing / requested / denied). */}
            <div className="flex flex-col gap-12">
              <h2 className="text-title font-bold text-ink">
                {isParent ? t('wishlist.yours.headingForParent') : t('wishlist.yours.heading')}
              </h2>
              {myActive.length === 0 ? (
                <EmptyState message={t('wishlist.empty')} />
              ) : (
                <ul className="flex flex-col gap-8" aria-label={t('wishlist.yours.listLabel')}>
                  {myActive.map((item) => (
                    <li key={item.id}>
                      <ItemRow
                        item={item}
                        ownerName={nameById.get(item.ownerUid) ?? t('wishlist.unknownMember')}
                        isOwner={item.ownerUid === viewer.uid}
                        submitting={submitting.has(item.id)}
                        canEdit={onUpdate !== undefined}
                        canDelete={onDelete !== undefined}
                        canRequest={onRequest !== undefined}
                        canCancel={onCancelRequest !== undefined}
                        onEdit={() => setEditing(item)}
                        onDelete={() => handleDelete(item.id)}
                        onRequest={() => handleRequest(item.id)}
                        onCancel={() => handleCancel(item.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {myRedeemed.length > 0 && (
              <div className="flex flex-col gap-12">
                <h2 className="text-title font-semibold text-ink">
                  {t('wishlist.redeemed.heading')}
                </h2>
                <ul className="flex flex-col gap-8" aria-label={t('wishlist.redeemed.listLabel')}>
                  {myRedeemed.map((item) => (
                    <li key={item.id}>
                      <ItemRow
                        item={item}
                        ownerName={nameById.get(item.ownerUid) ?? t('wishlist.unknownMember')}
                        isOwner={item.ownerUid === viewer.uid}
                        submitting={false}
                        canEdit={false}
                        canDelete={false}
                        canRequest={false}
                        canCancel={false}
                      />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </section>

      {onCreate !== undefined && (
        <div className="fixed bottom-fab-from-bottom right-16 z-fab">
          <Fab label={t('wishlist.action.create')} onClick={() => setCreateOpen(true)} />
        </div>
      )}

      <CreateWishSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        {...(onCreate !== undefined ? { onCreate } : {})}
      />
      {editing !== null && onUpdate !== undefined && (
        <EditWishSheet item={editing} onClose={() => setEditing(null)} onEdit={onUpdate} />
      )}

      <ToastViewport />
    </>
  );
}

function statusOrder(s: WishlistStatus): number {
  switch (s) {
    case 'requested':
      return 0;
    case 'wishing':
      return 1;
    case 'denied':
      return 2;
    case 'redeemed':
      return 3;
  }
}

function BalanceCard(props: { amountCents: number }): ReactElement {
  const { t } = useTranslation();
  const valid = isValidMoneyCents(props.amountCents);
  const amount = valid ? formatMoney(props.amountCents) : t('wishlist.balanceUnavailable');
  return (
    <div className="flex flex-col gap-4 rounded-card bg-accent-light p-16 shadow-card">
      <span className="text-meta font-semibold text-accent-dark">
        {t('wishlist.currentBalance')}
      </span>
      <span
        className="text-display font-display font-extrabold text-accent-dark"
        aria-label={t('wishlist.currentBalanceLabel', { amount })}
      >
        {amount}
      </span>
    </div>
  );
}

function BalanceAmount(props: { name: string; cents: number }): ReactElement {
  const { t } = useTranslation();
  const { name, cents } = props;
  if (!isValidMoneyCents(cents)) {
    return (
      <span
        className="text-body font-bold text-ink-mute"
        aria-label={t('wishlist.balanceUnavailableFor', { name })}
      >
        {t('wishlist.balanceUnavailable')}
      </span>
    );
  }
  return (
    <span
      className="text-body font-bold text-accent-dark"
      aria-label={t('wishlist.balanceLabel', { name, amount: formatMoney(cents) })}
    >
      {formatMoney(cents)}
    </span>
  );
}

interface ItemRowProps {
  item: WishlistItemWithId;
  ownerName: string;
  isOwner: boolean;
  submitting: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canRequest: boolean;
  canCancel: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onRequest?: () => void;
  onCancel?: () => void;
}

function ItemRow(props: ItemRowProps): ReactElement {
  const { t } = useTranslation();
  const {
    item,
    ownerName,
    isOwner,
    submitting,
    canEdit,
    canDelete,
    canRequest,
    canCancel,
    onEdit,
    onDelete,
    onRequest,
    onCancel,
  } = props;

  const costValid = isValidMoneyCents(item.costCents);
  const costText = costValid ? formatMoney(item.costCents) : t('wishlist.amountUnavailable');

  const statusBadgeTone: 'mute' | 'info' | 'ok' | 'danger' =
    item.status === 'requested'
      ? 'info'
      : item.status === 'redeemed'
        ? 'ok'
        : item.status === 'denied'
          ? 'danger'
          : 'mute';

  return (
    <article className="flex flex-col gap-8 rounded-card border border-surface-line bg-surface-card p-12">
      <div className="flex flex-wrap items-start gap-12">
        <div className="flex flex-1 flex-col gap-2">
          <span className="text-body font-bold text-ink">{item.title}</span>
          <span className="text-caption text-ink-mute2">
            {t('wishlist.ownedBy', { name: ownerName })}
          </span>
        </div>
        <Badge tone={statusBadgeTone} size="sm">
          {t(`wishlist.status.${item.status}`)}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-8 text-meta">
        <span
          className="font-semibold text-ink"
          aria-label={t('wishlist.costLabel', { amount: costText })}
        >
          {costText}
        </span>
      </div>
      {item.status === 'denied' && item.deniedReason !== undefined && item.deniedReason !== '' && (
        <p className="rounded-control bg-status-danger-light px-12 py-8 text-meta text-status-danger-text">
          <span className="font-semibold">{t('wishlist.deniedReasonPrefix')}</span>{' '}
          {item.deniedReason}
        </p>
      )}
      {isOwner && (canEdit || canDelete || canRequest || canCancel) && (
        <div className="flex flex-wrap justify-end gap-8">
          {item.status === 'wishing' && canEdit && onEdit !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onEdit}
              aria-label={t('wishlist.action.editLabel', { title: item.title })}
            >
              {t('wishlist.action.edit')}
            </Button>
          )}
          {item.status === 'wishing' && canDelete && onDelete !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={submitting}
              aria-label={t('wishlist.action.deleteLabel', { title: item.title })}
            >
              {t('wishlist.action.delete')}
            </Button>
          )}
          {item.status === 'denied' && canRequest && onRequest !== undefined && (
            <Button
              size="sm"
              onClick={onRequest}
              loading={submitting}
              aria-label={t('wishlist.action.tryAgainLabel', { title: item.title })}
            >
              {t('wishlist.action.tryAgain')}
            </Button>
          )}
          {item.status === 'wishing' && canRequest && onRequest !== undefined && (
            <Button
              size="sm"
              onClick={onRequest}
              loading={submitting}
              aria-label={t('wishlist.action.requestLabel', { title: item.title })}
            >
              {t('wishlist.action.request')}
            </Button>
          )}
          {item.status === 'requested' && canCancel && onCancel !== undefined && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={submitting}
              aria-label={t('wishlist.action.cancelLabel', { title: item.title })}
            >
              {t('wishlist.action.cancel')}
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

interface ApprovalRowProps {
  item: WishlistItemWithId;
  ownerName: string;
  denying: boolean;
  reason: string;
  reasonInvalid: boolean;
  submitting: boolean;
  canApprove: boolean;
  canDeny: boolean;
  onApprove: () => void;
  onStartDeny: () => void;
  onReasonChange: (value: string) => void;
  onConfirmDeny: () => void;
}

function ApprovalRow(props: ApprovalRowProps): ReactElement {
  const { t } = useTranslation();
  const {
    item,
    ownerName,
    denying,
    reason,
    reasonInvalid,
    submitting,
    canApprove,
    canDeny,
    onApprove,
    onStartDeny,
    onReasonChange,
    onConfirmDeny,
  } = props;
  const reasonInputRef = useRef<HTMLInputElement>(null);
  const labelId = useId();
  const regionId = useId();
  const errorId = useId();

  useEffect(() => {
    if (denying) reasonInputRef.current?.focus();
  }, [denying]);

  const costValid = isValidMoneyCents(item.costCents);
  const costText = costValid ? formatMoney(item.costCents) : t('wishlist.amountUnavailable');

  return (
    <div className="flex flex-col gap-8 rounded-control border border-surface-line bg-surface-card px-14 py-12">
      <div className="flex flex-wrap items-center gap-12">
        <span className="flex-1 text-body font-semibold text-ink">{item.title}</span>
        <Badge tone="info" size="sm">
          {t('wishlist.status.requested')}
        </Badge>
      </div>
      <p className="text-caption text-ink-mute2">{t('wishlist.ownedBy', { name: ownerName })}</p>
      <div className="flex flex-wrap items-center gap-12 text-meta">
        <span className="font-semibold text-ink">{costText}</span>
      </div>
      <div className="flex flex-wrap gap-8">
        {canApprove && (
          <button
            type="button"
            onClick={onApprove}
            disabled={submitting}
            aria-disabled={submitting ? 'true' : undefined}
            aria-busy={submitting ? 'true' : undefined}
            aria-label={t('wishlist.approveLabel', {
              title: item.title,
              owner: ownerName,
              amount: costText,
            })}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-status-ok px-20 text-body font-semibold text-status-ok-text transition-colors duration-cardPress ease-out hover:bg-status-ok-light focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 motion-reduce:transition-none"
          >
            {t('wishlist.approve')}
          </button>
        )}
        {canDeny && !denying && (
          <Button variant="ghost" size="md" onClick={onStartDeny} disabled={submitting}>
            {t('wishlist.deny')}
          </Button>
        )}
      </div>
      {denying && (
        <div
          id={regionId}
          className="flex flex-col gap-8 rounded-control border border-surface-line bg-surface-bg px-14 py-12"
        >
          <label
            id={labelId}
            htmlFor={`${labelId}-input`}
            className="text-meta font-semibold text-ink-2"
          >
            {t('wishlist.denyReasonPrompt')}
          </label>
          <input
            id={`${labelId}-input`}
            ref={reasonInputRef}
            type="text"
            value={reason}
            maxLength={WISHLIST_DENIED_REASON_MAX}
            onChange={(e) => onReasonChange(e.target.value)}
            aria-invalid={reasonInvalid ? 'true' : undefined}
            aria-describedby={reasonInvalid ? errorId : undefined}
            className="min-h-tap rounded-control border border-surface-line bg-surface-card px-12 text-body text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          />
          {reasonInvalid && (
            <p id={errorId} role="alert" className="text-meta text-status-danger-text">
              {t('wishlist.denyReasonRequired')}
            </p>
          )}
          <div className="flex justify-end gap-8">
            <Button
              type="button"
              onClick={onConfirmDeny}
              loading={submitting}
              aria-label={t('wishlist.denyConfirmLabel', {
                title: item.title,
                owner: ownerName,
              })}
            >
              {t('wishlist.denyConfirm')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface CreateSheetProps {
  open: boolean;
  onClose: () => void;
  onCreate?: (input: { title: string; costCents: number }) => Promise<void>;
}

function CreateWishSheet(props: CreateSheetProps): ReactElement | null {
  const { t } = useTranslation();
  if (!props.open || props.onCreate === undefined) return null;
  return (
    <BottomSheet open onClose={props.onClose} title={t('wishlist.create.title')}>
      <WishForm
        initialTitle=""
        initialCostDollars=""
        submitLabel={t('wishlist.create.submit')}
        onSubmit={props.onCreate}
        onClose={props.onClose}
      />
    </BottomSheet>
  );
}

interface EditSheetProps {
  item: WishlistItemWithId;
  onClose: () => void;
  onEdit: (itemId: string, patch: { title?: string; costCents?: number }) => Promise<void>;
}

function EditWishSheet(props: EditSheetProps): ReactElement {
  const { t } = useTranslation();
  return (
    <BottomSheet open onClose={props.onClose} title={t('wishlist.edit.title')}>
      <WishForm
        initialTitle={props.item.title}
        initialCostDollars={(props.item.costCents / 100).toFixed(2)}
        submitLabel={t('wishlist.edit.submit')}
        onSubmit={async (input) => {
          await props.onEdit(props.item.id, input);
        }}
        onClose={props.onClose}
      />
    </BottomSheet>
  );
}

interface WishFormProps {
  initialTitle: string;
  initialCostDollars: string;
  submitLabel: string;
  onSubmit: (input: { title: string; costCents: number }) => Promise<void>;
  onClose: () => void;
}

function WishForm(props: WishFormProps): ReactElement {
  const { t } = useTranslation();
  const [title, setTitle] = useState(props.initialTitle);
  const [cost, setCost] = useState(props.initialCostDollars);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    const trimmed = title.trim();
    if (trimmed.length === 0) {
      setError(t('wishlist.error.titleRequired'));
      return;
    }
    if (trimmed.length > WISHLIST_TITLE_MAX) {
      setError(t('wishlist.error.titleTooLong'));
      return;
    }
    const cents = parseDollarsToCents(cost);
    if (cents === null || cents <= 0) {
      setError(t('wishlist.error.costInvalid'));
      return;
    }
    setBusy(true);
    try {
      await props.onSubmit({ title: trimmed, costCents: cents });
      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('wishlist.error.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="flex flex-col gap-12" onSubmit={handleSubmit}>
      <TextField label={t('wishlist.form.titleLabel')} value={title} onChange={setTitle} />
      <TextField
        label={t('wishlist.form.costLabel')}
        value={cost}
        onChange={setCost}
        placeholder="0.00"
      />
      {error !== null && (
        <p role="alert" className="text-meta text-status-danger-text">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-8">
        <Button variant="ghost" type="button" onClick={props.onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={busy}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}
