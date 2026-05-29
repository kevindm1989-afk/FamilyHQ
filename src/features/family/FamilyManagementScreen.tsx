/**
 * Family Management screen (Phase 4 — parent-only at /family).
 *
 * Designer-defined states:
 *  - LOADING -> Skeleton (role="status")
 *  - EMPTY (defensive — usually viewer is in the list) -> EmptyState
 *  - ACTIVE-LIST DEFAULT -> <section> + <h2> + <ul>/<li> per active member
 *  - INACTIVE-LIST DEFAULT -> <section> + <h2> + <ul>/<li> per inactive member
 *  - RENAME -> per-row "Rename {name}" -> BottomSheet w/ labelled input + Save/Cancel
 *  - DEACTIVATE -> per-active-MEMBER-row "Deactivate {name}" -> confirm BottomSheet
 *                  (never on any parent, never on the viewer's own row)
 *  - REACTIVATE -> per-inactive-row one-tap "Reactivate {name}" (no confirm; also
 *                  never on the viewer's own row — F6 defensive race guard)
 *  - ERROR -> single user-safe toast (no raw Firebase, no PII)
 *
 * Privacy (ADR-0008): NO email anywhere on screen — `User` carries no email
 * field; the adult email lives on `userPrivate/{uid}`. WCAG: status conveyed
 * as TEXT (sections + role badge + "Inactive" label), never colour alone;
 * every action is a real focusable <button> with a 44px tap target.
 *
 * Firebase is OUT of this screen — props inject the data and the action
 * callbacks (mirrors ChoresParentScreen / BoardScreen).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, Badge, BottomSheet, EmptyState, Skeleton } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { UserWithId } from '../../lib/types';
import { NAME_MAX_LENGTH } from './familyManagementService';
import {
  MONEY_INVALID_INDICATOR,
  formatMoney,
  isValidMoneyCents,
} from '../chores/choresParentService';

export interface FamilyManagementScreenProps {
  /** The signed-in parent viewing the screen. */
  viewer: UserWithId;
  /** ALL in-family members (active + inactive). */
  members: UserWithId[];
  loading: boolean;
  error: string | null;
  onRename: (uid: string, name: string) => Promise<void>;
  onSetActive: (uid: string, isActive: boolean) => Promise<void>;
  onRefresh: () => void;
}

interface RenameTarget {
  uid: string;
  name: string;
}

interface ConfirmTarget {
  uid: string;
  name: string;
}

/**
 * F5 — deterministic display order. Sort active and inactive lists
 * alphabetically by name (case-insensitive, locale-aware) with the uid as a
 * stable secondary tiebreak. We sort a COPY (never mutate the prop array).
 */
function sortByNameThenUid(list: UserWithId[]): UserWithId[] {
  return list.slice().sort((a, b) => {
    const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function FamilyManagementScreen(props: FamilyManagementScreenProps): ReactElement {
  const { t } = useTranslation();
  const { viewer, members, loading, error, onRename, onSetActive } = props;
  const { showToast } = useToast();

  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  // F3 — per-uid (or per-action) in-flight set. A double-tap of any action
  // must call the underlying callback ONCE while the first promise is in
  // flight; the action's button reflects busy via `disabled`. After
  // resolution (success OR failure) the action is removed from the set.
  // Keys: `reactivate:${uid}`, `deactivate:${uid}`, `rename:${uid}`.
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const beginPending = (key: string): boolean => {
    if (pending.has(key)) return false;
    setPending((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    return true;
  };
  const endPending = (key: string): void => {
    setPending((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  // The error string is surfaced as a single toast — mirror the rest of the app
  // (toast-everything rule). Sanitised callers guarantee it is PII-free.
  useEffect(() => {
    if (error) showToast(error);
  }, [error, showToast]);

  // F5 — sort before splitting so the order is deterministic and stable
  // across snapshots (the hook also sorts, but defending here keeps the
  // screen correct when fed unsorted data in tests / future callers).
  const sorted = useMemo(() => sortByNameThenUid(members), [members]);
  const activeMembers = sorted.filter((m) => m.isActive);
  const inactiveMembers = sorted.filter((m) => !m.isActive);

  const handleOpenRename = (member: UserWithId, btn: HTMLButtonElement | null): void => {
    // Focus the trigger so BottomSheet's `previouslyFocused` can capture it
    // and restore focus to this row's Rename button on close. jsdom does not
    // focus a button on click, so we set it explicitly; in a real browser the
    // click already moves focus there.
    btn?.focus();
    setRenameTarget({ uid: member.id, name: member.name });
  };

  const handleOpenConfirm = (member: UserWithId, btn: HTMLButtonElement | null): void => {
    btn?.focus();
    setConfirmTarget({ uid: member.id, name: member.name });
  };

  const handleReactivate = (member: UserWithId): void => {
    const key = `reactivate:${member.id}`;
    // F3 — collapse a double-tap to a single call.
    if (!beginPending(key)) return;
    void onSetActive(member.id, true)
      .then(() => showToast(t('family.toast.reactivated')))
      .catch(() => showToast(t('family.toast.generic')))
      .finally(() => endPending(key));
  };

  const handleRenameSubmit = (newName: string): void => {
    if (!renameTarget) return;
    const target = renameTarget;
    // F8 — UI-side no-op: if the trimmed value equals the current name, do
    // NOT call onRename. The server would deny on `affectedKeys().size() > 0`,
    // surfacing a confusing generic-error toast for a save the user perceives
    // as identical. Close the sheet silently.
    if (newName === target.name) {
      setRenameTarget(null);
      return;
    }
    const key = `rename:${target.uid}`;
    if (!beginPending(key)) return;
    void onRename(target.uid, newName)
      .then(() => {
        showToast(t('family.toast.renamed'));
        // F4 — sheet closes on SUCCESS (and on failure via .catch). Putting
        // setRenameTarget(null) in both branches keeps the close deterministic.
        setRenameTarget(null);
      })
      .catch(() => {
        showToast(t('family.toast.generic'));
        // F4 — sheet closes on REJECTION too. Staying open compounds the
        // double-tap risk and confuses retry semantics.
        setRenameTarget(null);
      })
      .finally(() => endPending(key));
  };

  const handleConfirmDeactivate = (): void => {
    if (!confirmTarget) return;
    const target = confirmTarget;
    const key = `deactivate:${target.uid}`;
    if (!beginPending(key)) return;
    void onSetActive(target.uid, false)
      .then(() => {
        showToast(t('family.toast.deactivated'));
        setConfirmTarget(null);
      })
      .catch(() => {
        // F10 — confirm sheet closes on failure too.
        showToast(t('family.toast.generic'));
        setConfirmTarget(null);
      })
      .finally(() => endPending(key));
  };

  return (
    <>
      {/* Outer wrapper is a <div> (not a <section>) so only the inner
          Active / Inactive sections show up in a `document.querySelectorAll
          ('section')` scope query. */}
      <div className="flex flex-col gap-16 px-16 pt-4 pb-24">
        <h1 className="text-display font-display font-extrabold text-ink">{t('family.title')}</h1>

        {loading ? (
          <Skeleton label={t('family.loading')} />
        ) : members.length === 0 ? (
          <EmptyState message={t('family.emptyAll')} />
        ) : (
          <>
            <MemberSection
              heading={t('family.section.active')}
              members={activeMembers}
              viewer={viewer}
              pending={pending}
              onOpenRename={handleOpenRename}
              onOpenConfirm={handleOpenConfirm}
              onReactivate={handleReactivate}
            />
            <MemberSection
              heading={t('family.section.inactive')}
              members={inactiveMembers}
              viewer={viewer}
              pending={pending}
              onOpenRename={handleOpenRename}
              onOpenConfirm={handleOpenConfirm}
              onReactivate={handleReactivate}
            />
          </>
        )}
      </div>

      {renameTarget && (
        <RenameSheet
          target={renameTarget}
          pending={pending.has(`rename:${renameTarget.uid}`)}
          onCancel={() => setRenameTarget(null)}
          onSubmit={handleRenameSubmit}
        />
      )}

      {confirmTarget && (
        <ConfirmDeactivateSheet
          target={confirmTarget}
          pending={pending.has(`deactivate:${confirmTarget.uid}`)}
          onCancel={() => setConfirmTarget(null)}
          onConfirm={handleConfirmDeactivate}
        />
      )}

      <ToastViewport />
    </>
  );
}

interface MemberSectionProps {
  heading: string;
  members: UserWithId[];
  viewer: UserWithId;
  pending: ReadonlySet<string>;
  onOpenRename: (member: UserWithId, btn: HTMLButtonElement | null) => void;
  onOpenConfirm: (member: UserWithId, btn: HTMLButtonElement | null) => void;
  onReactivate: (member: UserWithId) => void;
}

function MemberSection(props: MemberSectionProps): ReactElement {
  const { t } = useTranslation();
  const { heading, members, viewer, pending, onOpenRename, onOpenConfirm, onReactivate } = props;
  return (
    <section className="flex flex-col gap-12">
      <h2 className="text-title font-bold text-ink">{heading}</h2>
      {members.length === 0 ? (
        <EmptyState message={t('family.section.emptyGroup')} />
      ) : (
        // A1 — the <ul> carries NO aria-label. The section's <h2> is the
        // authoritative accessible name; duplicating it on the list would be
        // redundant for AT.
        <ul className="flex flex-col gap-8">
          {members.map((m) => (
            <li key={m.id}>
              <MemberRow
                member={m}
                viewer={viewer}
                pending={pending}
                onOpenRename={onOpenRename}
                onOpenConfirm={onOpenConfirm}
                onReactivate={onReactivate}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface MemberRowProps {
  member: UserWithId;
  viewer: UserWithId;
  pending: ReadonlySet<string>;
  onOpenRename: (member: UserWithId, btn: HTMLButtonElement | null) => void;
  onOpenConfirm: (member: UserWithId, btn: HTMLButtonElement | null) => void;
  onReactivate: (member: UserWithId) => void;
}

function MemberRow(props: MemberRowProps): ReactElement {
  const { t } = useTranslation();
  const { member, viewer, pending, onOpenRename, onOpenConfirm, onReactivate } = props;
  const isSelf = member.id === viewer.id;
  // Deactivate is OFFERED ONLY on role==='member' active rows (never any parent,
  // never on the viewer self). Parent-on-parent deactivation is deferred (v1).
  const canDeactivate = member.isActive && member.role === 'member' && !isSelf;
  // Reactivate is OFFERED on every inactive row EXCEPT the viewer's own (F6 —
  // defensive against an isActive race; rules deny self-edits of isActive too).
  const canReactivate = !member.isActive && !isSelf;
  const reactivatePending = pending.has(`reactivate:${member.id}`);

  return (
    <div className="flex items-center gap-12 rounded-control border border-surface-line bg-surface-card px-14 py-12">
      {/* The role is conveyed AS TEXT by the adjacent Badge (next sibling), so
          the avatar stays decorative — passing `showRoleForA11y` would add a
          second "Parent" node and collide with the Badge's text in row queries
          (lesson 2026-05-27 — collision guard). */}
      <Avatar name={member.name} role={member.role} size="default" />
      <div className="flex flex-1 flex-col gap-4">
        <span className="text-body font-semibold text-ink">{member.name}</span>
        <div className="flex flex-wrap items-center gap-8 text-meta text-ink-mute">
          <Badge tone={member.role === 'parent' ? 'amber' : 'indigo'} size="sm">
            {member.role === 'parent' ? t('family.role.parent') : t('family.role.member')}
          </Badge>
          {/* Status conveyed as TEXT (WCAG 1.4.1) — never colour-alone. */}
          {member.isActive ? (
            <span className="text-meta text-ink-mute">{t('family.status.active')}</span>
          ) : (
            <span className="text-meta font-semibold text-status-danger-text">
              {t('family.status.inactive')}
            </span>
          )}
          <BalanceAmount cents={member.allowanceBalance} name={member.name} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-8">
        <button
          type="button"
          aria-label={t('family.action.renameLabel', { name: member.name })}
          onClick={(e) => onOpenRename(member, e.currentTarget)}
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line bg-surface-card px-14 text-body font-semibold text-ink transition-colors duration-cardPress ease-out hover:bg-surface-line2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
        >
          {t('family.action.rename')}
        </button>
        {canDeactivate && (
          <button
            type="button"
            aria-label={t('family.action.deactivateLabel', { name: member.name })}
            onClick={(e) => onOpenConfirm(member, e.currentTarget)}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-status-danger px-14 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-status-danger-text focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
          >
            {t('family.action.deactivate')}
          </button>
        )}
        {canReactivate && (
          <button
            type="button"
            aria-label={t('family.action.reactivateLabel', { name: member.name })}
            // F3 — disable while a Reactivate is in flight to collapse a
            // double-tap to a single call. The click handler stays bound; the
            // pending-set guard inside the handler is the source of truth.
            disabled={reactivatePending}
            onClick={() => onReactivate(member)}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-brand px-14 text-body font-semibold text-brand-on transition-colors duration-cardPress ease-out hover:bg-brand-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 motion-reduce:transition-none"
          >
            {t('family.action.reactivate')}
          </button>
        )}
      </div>
    </div>
  );
}

/** Format an allowance balance, or render the distinct invalid indicator
 * when the cents value is non-finite/invalid — never a misleading "$0.00"
 * (Finding 8). */
function BalanceAmount(props: { cents: number; name: string }): ReactElement {
  const { t } = useTranslation();
  const { cents, name } = props;
  if (!isValidMoneyCents(cents)) {
    return (
      <span
        className="text-meta text-ink-mute"
        aria-label={t('family.balanceUnavailable', { name })}
      >
        {MONEY_INVALID_INDICATOR}
      </span>
    );
  }
  return (
    <span
      className="text-meta text-ink-mute"
      aria-label={t('family.balanceLabel', { name, amount: formatMoney(cents) })}
    >
      {formatMoney(cents)}
    </span>
  );
}

interface RenameSheetProps {
  target: RenameTarget;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (newName: string) => void;
}

function RenameSheet(props: RenameSheetProps): ReactElement {
  const { t } = useTranslation();
  const { target, pending, onCancel, onSubmit } = props;
  const [value, setValue] = useState<string>(target.name);
  const [touchedInvalid, setTouchedInvalid] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus the input when the sheet renders.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = value.trim();
  const isEmpty = trimmed.length === 0;
  // A5/F7 — without maxLength on the input, the user can type past the cap.
  // The error branch is now reachable, surfaced as an aria-live alert below.
  const isOverLength = trimmed.length > NAME_MAX_LENGTH;
  const canSave = !isEmpty && !isOverLength;

  const handleSave = (): void => {
    if (!canSave) {
      setTouchedInvalid(true);
      return;
    }
    onSubmit(trimmed);
  };

  const errorMessage =
    touchedInvalid && !canSave
      ? isOverLength
        ? t('family.rename.errorTooLong', { max: NAME_MAX_LENGTH + 1 })
        : t('family.rename.errorEmpty')
      : null;

  return (
    <BottomSheet
      open
      title={t('family.rename.sheetTitle', { name: target.name })}
      onClose={onCancel}
    >
      <div className="flex flex-col gap-16">
        <div className="flex flex-col gap-6">
          <label htmlFor={inputId} className="text-label font-semibold text-ink-2">
            {t('family.rename.nameLabel')}
          </label>
          <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              value={value}
              // A8 — no aria-required (the input is pre-filled and has no
              // native `required` attribute; aria-required would be a lie).
              aria-invalid={touchedInvalid && !canSave ? 'true' : undefined}
              aria-describedby={touchedInvalid && !canSave ? errorId : undefined}
              // A5/F7 — NO maxLength. Silent truncation is a cognitive harm;
              // the over-length state is surfaced as a visible/live error
              // below and Save is short-circuited via canSave.
              onChange={(e) => {
                setValue(e.target.value);
                if (touchedInvalid) setTouchedInvalid(false);
              }}
              className="w-full bg-transparent text-body text-ink placeholder:text-ink-mute2 focus:outline-none"
            />
          </div>
          {errorMessage && (
            <p
              id={errorId}
              role="alert"
              aria-live="polite"
              className="text-meta font-semibold text-status-danger-text"
            >
              {errorMessage}
            </p>
          )}
        </div>
        <div className="flex gap-8">
          <button
            type="button"
            onClick={handleSave}
            // F3 — disabled while the rename is in flight to collapse a
            // double-tap to a single call. canSave-driven aria-disabled stays
            // as the validation gate.
            disabled={pending}
            aria-disabled={canSave ? undefined : 'true'}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-brand px-20 text-body font-semibold text-brand-on transition-colors duration-cardPress ease-out hover:bg-brand-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 aria-disabled:opacity-60 motion-reduce:transition-none"
          >
            {t('family.rename.save')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line px-20 text-body font-semibold text-ink transition-colors duration-cardPress ease-out hover:bg-surface-line2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
          >
            {t('family.rename.cancel')}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

interface ConfirmDeactivateSheetProps {
  target: ConfirmTarget;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDeactivateSheet(props: ConfirmDeactivateSheetProps): ReactElement {
  const { t } = useTranslation();
  const { target, pending, onCancel, onConfirm } = props;
  // A3 — the consequence sentence is associated with the dialog via
  // aria-describedby (BottomSheet extension). The id is stable per mount
  // via useId().
  const consequenceId = useId();
  return (
    <BottomSheet
      open
      title={t('family.confirmDeactivate.sheetTitle', { name: target.name })}
      describedById={consequenceId}
      onClose={onCancel}
    >
      <div className="flex flex-col gap-16">
        <p id={consequenceId} className="text-body text-ink">
          {t('family.confirmDeactivate.consequence', { name: target.name })}
        </p>
        <div className="flex gap-8">
          <button
            type="button"
            onClick={onConfirm}
            // F3 — disabled while the deactivate is in flight to collapse a
            // double-tap.
            disabled={pending}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-status-danger px-20 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-status-danger-text focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus disabled:opacity-60 motion-reduce:transition-none"
          >
            {t('family.confirmDeactivate.confirm')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line px-20 text-body font-semibold text-ink transition-colors duration-cardPress ease-out hover:bg-surface-line2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
          >
            {t('family.confirmDeactivate.cancel')}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
