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
 *  - REACTIVATE -> per-inactive-row one-tap "Reactivate {name}" (no confirm)
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
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { Avatar, Badge, BottomSheet, EmptyState, Skeleton } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { UserWithId } from '../../lib/types';
import {
  FAMILY_GENERIC_ERROR,
  MEMBER_DEACTIVATED,
  MEMBER_REACTIVATED,
  NAME_MAX_LENGTH,
  RENAME_SUCCESS,
} from './familyManagementService';
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

export function FamilyManagementScreen(props: FamilyManagementScreenProps): ReactElement {
  const { viewer, members, loading, error, onRename, onSetActive } = props;
  const { showToast } = useToast();

  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  // The error string is surfaced as a single toast — mirror the rest of the app
  // (toast-everything rule). Sanitised callers guarantee it is PII-free.
  useEffect(() => {
    if (error) showToast(error);
  }, [error, showToast]);

  const activeMembers = members.filter((m) => m.isActive);
  const inactiveMembers = members.filter((m) => !m.isActive);

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
    void onSetActive(member.id, true)
      .then(() => showToast(MEMBER_REACTIVATED))
      .catch(() => showToast(FAMILY_GENERIC_ERROR));
  };

  const handleRenameSubmit = (newName: string): void => {
    if (!renameTarget) return;
    void onRename(renameTarget.uid, newName)
      .then(() => {
        showToast(RENAME_SUCCESS);
        setRenameTarget(null);
      })
      .catch(() => showToast(FAMILY_GENERIC_ERROR));
  };

  const handleConfirmDeactivate = (): void => {
    if (!confirmTarget) return;
    void onSetActive(confirmTarget.uid, false)
      .then(() => {
        showToast(MEMBER_DEACTIVATED);
        setConfirmTarget(null);
      })
      .catch(() => showToast(FAMILY_GENERIC_ERROR));
  };

  return (
    <>
      {/* Outer wrapper is a <div> (not a <section>) so only the inner
          Active / Inactive sections show up in a `document.querySelectorAll
          ('section')` scope query. */}
      <div className="flex flex-col gap-16 px-16 pt-4 pb-24">
        <h1 className="text-display font-display font-extrabold text-ink">Family</h1>

        {loading ? (
          <Skeleton label="Loading family…" />
        ) : members.length === 0 ? (
          <EmptyState message="No family members yet — invite someone to get started." />
        ) : (
          <>
            <MemberSection
              heading="Active members"
              members={activeMembers}
              viewer={viewer}
              onOpenRename={handleOpenRename}
              onOpenConfirm={handleOpenConfirm}
              onReactivate={handleReactivate}
            />
            <MemberSection
              heading="Inactive members"
              members={inactiveMembers}
              viewer={viewer}
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
          onCancel={() => setRenameTarget(null)}
          onSubmit={handleRenameSubmit}
        />
      )}

      {confirmTarget && (
        <ConfirmDeactivateSheet
          target={confirmTarget}
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
  onOpenRename: (member: UserWithId, btn: HTMLButtonElement | null) => void;
  onOpenConfirm: (member: UserWithId, btn: HTMLButtonElement | null) => void;
  onReactivate: (member: UserWithId) => void;
}

function MemberSection(props: MemberSectionProps): ReactElement {
  const { heading, members, viewer, onOpenRename, onOpenConfirm, onReactivate } = props;
  return (
    <section className="flex flex-col gap-12">
      <h2 className="text-title font-bold text-ink">{heading}</h2>
      {members.length === 0 ? (
        <EmptyState message="No one here yet." />
      ) : (
        <ul className="flex flex-col gap-8" aria-label={heading}>
          {members.map((m) => (
            <li key={m.id}>
              <MemberRow
                member={m}
                viewer={viewer}
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
  onOpenRename: (member: UserWithId, btn: HTMLButtonElement | null) => void;
  onOpenConfirm: (member: UserWithId, btn: HTMLButtonElement | null) => void;
  onReactivate: (member: UserWithId) => void;
}

function MemberRow(props: MemberRowProps): ReactElement {
  const { member, viewer, onOpenRename, onOpenConfirm, onReactivate } = props;
  const isSelf = member.id === viewer.id;
  // Deactivate is OFFERED ONLY on role==='member' active rows (never any parent,
  // never on the viewer self). Parent-on-parent deactivation is deferred (v1).
  const canDeactivate = member.isActive && member.role === 'member' && !isSelf;
  // Reactivate is OFFERED on every inactive row.
  const canReactivate = !member.isActive;

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
            {member.role === 'parent' ? 'Parent' : 'Member'}
          </Badge>
          {/* Status conveyed as TEXT (WCAG 1.4.1) — never colour-alone. */}
          {member.isActive ? (
            <span className="text-meta text-ink-mute">Active</span>
          ) : (
            <span className="text-meta font-semibold text-status-danger-text">Inactive</span>
          )}
          <BalanceAmount cents={member.allowanceBalance} name={member.name} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-8">
        <button
          type="button"
          aria-label={`Rename ${member.name}`}
          onClick={(e) => onOpenRename(member, e.currentTarget)}
          className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line bg-surface-card px-14 text-body font-semibold text-ink transition-colors duration-cardPress ease-out hover:bg-surface-line2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
        >
          Rename
        </button>
        {canDeactivate && (
          <button
            type="button"
            aria-label={`Deactivate ${member.name}`}
            onClick={(e) => onOpenConfirm(member, e.currentTarget)}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-status-danger px-14 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-status-danger-text focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
          >
            Deactivate
          </button>
        )}
        {canReactivate && (
          <button
            type="button"
            aria-label={`Reactivate ${member.name}`}
            onClick={() => onReactivate(member)}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-brand px-14 text-body font-semibold text-brand-on transition-colors duration-cardPress ease-out hover:bg-brand-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
          >
            Reactivate
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
  const { cents, name } = props;
  if (!isValidMoneyCents(cents)) {
    return (
      <span className="text-meta text-ink-mute" aria-label={`${name} balance unavailable`}>
        {MONEY_INVALID_INDICATOR}
      </span>
    );
  }
  return (
    <span className="text-meta text-ink-mute" aria-label={`${name} balance ${formatMoney(cents)}`}>
      {formatMoney(cents)}
    </span>
  );
}

interface RenameSheetProps {
  target: RenameTarget;
  onCancel: () => void;
  onSubmit: (newName: string) => void;
}

function RenameSheet(props: RenameSheetProps): ReactElement {
  const { target, onCancel, onSubmit } = props;
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
  const isOverLength = trimmed.length > NAME_MAX_LENGTH;
  const canSave = !isEmpty && !isOverLength;

  const handleSave = (): void => {
    if (!canSave) {
      setTouchedInvalid(true);
      return;
    }
    onSubmit(trimmed);
  };

  return (
    <BottomSheet open title={`Rename ${target.name}`} onClose={onCancel}>
      <div className="flex flex-col gap-16">
        <div className="flex flex-col gap-6">
          <label htmlFor={inputId} className="text-label font-semibold text-ink-2">
            Name
          </label>
          <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              value={value}
              aria-required="true"
              aria-invalid={touchedInvalid && !canSave ? 'true' : undefined}
              aria-describedby={touchedInvalid && !canSave ? errorId : undefined}
              maxLength={NAME_MAX_LENGTH}
              onChange={(e) => {
                setValue(e.target.value);
                if (touchedInvalid) setTouchedInvalid(false);
              }}
              className="w-full bg-transparent text-body text-ink placeholder:text-ink-mute2 focus:outline-none"
            />
          </div>
          {touchedInvalid && !canSave && (
            <p
              id={errorId}
              role="alert"
              className="text-meta font-semibold text-status-danger-text"
            >
              Please enter a name.
            </p>
          )}
        </div>
        <div className="flex gap-8">
          <button
            type="button"
            onClick={handleSave}
            aria-disabled={canSave ? undefined : 'true'}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-brand px-20 text-body font-semibold text-brand-on transition-colors duration-cardPress ease-out hover:bg-brand-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus aria-disabled:opacity-60 motion-reduce:transition-none"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line px-20 text-body font-semibold text-ink transition-colors duration-cardPress ease-out hover:bg-surface-line2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
          >
            Cancel
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

interface ConfirmDeactivateSheetProps {
  target: ConfirmTarget;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDeactivateSheet(props: ConfirmDeactivateSheetProps): ReactElement {
  const { target, onCancel, onConfirm } = props;
  return (
    <BottomSheet open title={`Deactivate ${target.name}`} onClose={onCancel}>
      <div className="flex flex-col gap-16">
        <p className="text-body text-ink">
          {target.name} will no longer be able to sign in or earn allowance. You can reactivate them
          later.
        </p>
        <div className="flex gap-8">
          <button
            type="button"
            onClick={onConfirm}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-status-danger px-20 text-body font-semibold text-onAccent transition-colors duration-cardPress ease-out hover:bg-status-danger-text focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
          >
            Deactivate
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border border-surface-line px-20 text-body font-semibold text-ink transition-colors duration-cardPress ease-out hover:bg-surface-line2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
          >
            Cancel
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
