/**
 * Add Chore sheet/modal (Phase 3, Task 11; handoff #06 AddChoreScreen).
 *
 * Renders inside a BottomSheet titled "Add Chore" (parent-only). Collects the
 * hardened-schema-relevant fields: title (autofocus, aria-required), assign-to
 * (a role="radiogroup" populated from the ACTIVE family members — DYNAMIC, never
 * hardcoded; arrow-key operable with roving tabindex), due date (Today /
 * Tomorrow / Pick date radios + a native date input with a visible label), point
 * value (integer points), dollar value (entered in dollars, submitted as integer
 * CENTS — money is cents everywhere, second-opinion #4 / Finding 7), recurring
 * toggle + frequency (none/weekly/biweekly). Submit is aria-disabled (focusable)
 * while the form is invalid; a click while disabled is a no-op.
 *
 * Finding 6: a chore must be assigned to a CURRENT active member. The assignee
 * re-syncs when `members` changes (clear/redefault if the selection is gone),
 * and submit is blocked when there is no valid assignee (or no members).
 *
 * On submit: calls the injected `onAdd` with the collected value (date is an ISO
 * datetime string, derived from the injected reference "today" so the chips are
 * deterministic); on success closes + success toast; on failure a generic
 * PII-free error toast, no close. The form NEVER emits status/createdBy/familyId
 * — the service fixes those (status='pending', createdBy=author, familyId=own).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { RecurrenceFrequency, Role, UserWithId } from '../../lib/types';
import { MONEY_MAX_CENTS } from './choresParentService';

export interface AddChoreValue {
  title: string;
  assignedTo: string;
  date: string;
  pointValue: number;
  dollarValue: number;
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency;
}

export interface AddChoreProps {
  open: boolean;
  onClose: () => void;
  author: { uid: string; name: string; role: Role };
  /** Active members to populate the assign-to control (dynamic, not hardcoded). */
  members: UserWithId[];
  /** Injected create action (wired to choresParentService.addChore + toast). */
  onAdd: (value: AddChoreValue) => Promise<void>;
  /** The reference "today" so the Today/Tomorrow chips are deterministic. */
  today: { year: number; month: number; day: number };
}

type DueChoice = 'today' | 'tomorrow' | 'pick';

const DUE_CHOICES: ReadonlyArray<DueChoice> = ['today', 'tomorrow', 'pick'];
const FREQUENCIES: ReadonlyArray<RecurrenceFrequency> = ['weekly', 'biweekly'];

/**
 * Arrow-key roving for a radiogroup: Left/Up moves to the previous option,
 * Right/Down to the next (wrapping). Mirrors the calendar AddEvent pattern so
 * the control is operable without a pointer (a11y BLOCKER).
 */
function handleRadioKeys<T>(
  e: KeyboardEvent,
  options: ReadonlyArray<T>,
  current: T,
  set: (next: T) => void,
): void {
  const idx = options.indexOf(current);
  if (idx < 0) return;
  let next = idx;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % options.length;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
    next = (idx - 1 + options.length) % options.length;
  else return;
  e.preventDefault();
  set(options[next]!);
}

/** Build the ISO datetime for a reference day offset by N days, at UTC-noon so
 * the calendar day is stable regardless of viewer timezone. */
function isoForOffset(
  today: { year: number; month: number; day: number },
  offsetDays: number,
): string {
  return new Date(
    Date.UTC(today.year, today.month, today.day + offsetDays, 12, 0, 0),
  ).toISOString();
}

/** Parse a plain YYYY-MM-DD (from the native date input) into an ISO datetime
 * at UTC-noon. */
function isoForPicked(picked: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(picked);
  if (!m) return picked;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0)).toISOString();
}

/** Parse an integer points string; non-finite/negative -> 0; clamped to the cap. */
function toPoints(value: string): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MONEY_MAX_CENTS);
}

/** Parse a DOLLARS string into integer CENTS (round to avoid float drift),
 * clamped to [0, MONEY_MAX_CENTS]; non-finite -> 0. "3.50" -> 350. */
function toCents(value: string): number {
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars < 0) return 0;
  const cents = Math.round(dollars * 100);
  return Math.min(cents, MONEY_MAX_CENTS);
}

export function AddChore(props: AddChoreProps): ReactElement {
  const { t } = useTranslation();
  const { open, onClose, members, onAdd, today } = props;
  const { showToast } = useToast();

  const [title, setTitle] = useState('');
  const [assignedTo, setAssignedTo] = useState<string>(members[0]?.id ?? '');
  const [due, setDue] = useState<DueChoice>('today');
  const [pickedDate, setPickedDate] = useState('');
  const [pointValue, setPointValue] = useState('0');
  const [dollarValue, setDollarValue] = useState('0');
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>('weekly');
  const [submitting, setSubmitting] = useState(false);

  const titleId = useId();
  const assignLabelId = useId();
  const dueLabelId = useId();
  const dateInputId = useId();
  const pointsId = useId();
  const dollarsId = useId();
  const freqLabelId = useId();
  const titleRef = useRef<HTMLInputElement>(null);

  // Autofocus the title field when the sheet opens.
  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  // Finding 6: re-sync the selected assignee when `members` changes. If the
  // current selection is no longer a present member (or there is no selection),
  // default to the first member; with no members the selection is cleared.
  useEffect(() => {
    setAssignedTo((current) => {
      if (members.some((m) => m.id === current)) return current;
      return members[0]?.id ?? '';
    });
  }, [members]);

  const titleValid = title.trim().length > 0;
  // A valid assignee must be a CURRENT member (Finding 6) — never a stale id.
  const assigneeValid = members.some((m) => m.id === assignedTo);
  const canSubmit = titleValid && assigneeValid && !submitting;

  const resolveDate = (): string => {
    if (due === 'tomorrow') return isoForOffset(today, 1);
    if (due === 'pick' && pickedDate) return isoForPicked(pickedDate);
    return isoForOffset(today, 0);
  };

  const handleSubmit = (): void => {
    if (!canSubmit) return;
    setSubmitting(true);
    const value: AddChoreValue = {
      title: title.trim(),
      assignedTo,
      date: resolveDate(),
      pointValue: toPoints(pointValue),
      dollarValue: toCents(dollarValue),
      isRecurring,
      recurrenceFrequency: isRecurring ? recurrenceFrequency : 'none',
    };
    void onAdd(value)
      .then(() => {
        showToast(t('chores.toast.added'));
        onClose();
      })
      .catch(() => showToast(t('chores.toast.generic')))
      .finally(() => setSubmitting(false));
  };

  if (!open) return <ToastViewport />;

  return (
    <>
      <BottomSheet open={open} title={t('chores.addChore.sheetTitle')} onClose={onClose}>
        <div className="flex flex-col gap-16">
          {/* Title — autofocus-eligible (first focusable), aria-required. The
              visible <label> is the accessible name (no aria-label override). */}
          <div className="flex flex-col gap-6">
            <label htmlFor={titleId} className="text-label font-semibold text-ink-2">
              {t('chores.addChore.whatLabel')}
            </label>
            <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
              <input
                id={titleId}
                ref={titleRef}
                type="text"
                value={title}
                aria-required="true"
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-transparent text-body text-ink placeholder:text-ink-mute2 focus:outline-none"
              />
            </div>
          </div>

          {/* Assign-to — DYNAMIC radiogroup, one radio per active member.
              Roving tabindex: only the selected radio is tabbable; arrow keys
              move the selection (a11y BLOCKER). */}
          <fieldset className="flex flex-col gap-8">
            <legend id={assignLabelId} className="text-label font-semibold text-ink-2">
              {t('chores.addChore.assignTo')}
            </legend>
            <div role="radiogroup" aria-labelledby={assignLabelId} className="flex flex-wrap gap-8">
              {members.map((m) => {
                const selected = assignedTo === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setAssignedTo(m.id)}
                    onKeyDown={(e) =>
                      handleRadioKeys(
                        e,
                        members.map((mm) => mm.id),
                        assignedTo,
                        setAssignedTo,
                      )
                    }
                    className={`inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border px-14 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
                      selected
                        ? 'border-brand bg-brand-light text-brand'
                        : 'border-surface-line bg-surface-card text-ink'
                    }`}
                  >
                    {m.name}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Due date — Today / Tomorrow / Pick date radios (roving tabindex). */}
          <fieldset className="flex flex-col gap-8">
            <legend id={dueLabelId} className="text-label font-semibold text-ink-2">
              {t('chores.addChore.dueLegend')}
            </legend>
            <div role="radiogroup" aria-labelledby={dueLabelId} className="flex flex-wrap gap-8">
              {(
                [
                  { id: 'today', label: t('chores.addChore.due.today') },
                  { id: 'tomorrow', label: t('chores.addChore.due.tomorrow') },
                  { id: 'pick', label: t('chores.addChore.due.pickDate') },
                ] as { id: DueChoice; label: string }[]
              ).map((opt) => {
                const selected = due === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setDue(opt.id)}
                    onKeyDown={(e) => handleRadioKeys(e, DUE_CHOICES, due, setDue)}
                    className={`inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border px-14 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
                      selected
                        ? 'border-brand bg-brand-light text-brand'
                        : 'border-surface-line bg-surface-card text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {due === 'pick' && (
              <div className="flex flex-col gap-6">
                <label htmlFor={dateInputId} className="text-label font-semibold text-ink-2">
                  {t('chores.addChore.pickDateLabel')}
                </label>
                <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
                  <input
                    id={dateInputId}
                    type="date"
                    value={pickedDate}
                    onChange={(e) => setPickedDate(e.target.value)}
                    className="w-full bg-transparent text-body text-ink focus:outline-none"
                  />
                </div>
              </div>
            )}
          </fieldset>

          {/* Reward — point value (integer points) + dollar value (entered in
              dollars, submitted as integer cents). Visible labels are the
              accessible names (no aria-label override). */}
          <div className="flex gap-12">
            <div className="flex flex-1 flex-col gap-6">
              <label htmlFor={pointsId} className="text-label font-semibold text-ink-2">
                {t('chores.addChore.pointValue')}
              </label>
              <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
                <input
                  id={pointsId}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={pointValue}
                  onChange={(e) => setPointValue(e.target.value)}
                  className="w-full bg-transparent text-body text-ink focus:outline-none"
                />
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-6">
              <label htmlFor={dollarsId} className="text-label font-semibold text-ink-2">
                {t('chores.addChore.dollarReward')}
              </label>
              <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
                <input
                  id={dollarsId}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={dollarValue}
                  onChange={(e) => setDollarValue(e.target.value)}
                  className="w-full bg-transparent text-body text-ink focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Recurring toggle + frequency. The frequency group is ALWAYS
              operable (never contradictorily aria-disabled): selecting an option
              turns recurrence on (a11y contract). */}
          <div className="flex flex-col gap-8">
            <label className="flex min-h-tap items-center gap-12">
              <input
                type="checkbox"
                role="switch"
                checked={isRecurring}
                aria-label={t('chores.addChore.recurringAriaLabel')}
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="h-20 w-20 rounded-control border-surface-line text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
              />
              <span className="text-body font-semibold text-ink">
                {t('chores.addChore.repeats')}
              </span>
            </label>
            <fieldset className="flex flex-col gap-8">
              <legend id={freqLabelId} className="text-label font-semibold text-ink-2">
                {t('chores.addChore.howOften')}
              </legend>
              <div role="radiogroup" aria-labelledby={freqLabelId} className="flex flex-wrap gap-8">
                {(
                  [
                    { id: 'weekly', label: t('chores.addChore.recurrence.weekly') },
                    { id: 'biweekly', label: t('chores.addChore.recurrence.biweekly') },
                  ] as { id: RecurrenceFrequency; label: string }[]
                ).map((opt) => {
                  const selected = recurrenceFrequency === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => {
                        setRecurrenceFrequency(opt.id);
                        setIsRecurring(true);
                      }}
                      onKeyDown={(e) => {
                        handleRadioKeys(e, FREQUENCIES, recurrenceFrequency, (next) => {
                          setRecurrenceFrequency(next);
                          setIsRecurring(true);
                        });
                      }}
                      className={`inline-flex min-h-tap min-w-tap items-center justify-center rounded-control border px-14 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
                        selected
                          ? 'border-brand bg-brand-light text-brand'
                          : 'border-surface-line bg-surface-card text-ink'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </div>

          {/* Submit — aria-disabled (focusable, NOT native disabled) while the
              form is invalid; a click while disabled is a no-op. aria-busy while
              the add action is in flight. */}
          <button
            type="button"
            aria-disabled={canSubmit ? undefined : 'true'}
            aria-busy={submitting ? 'true' : undefined}
            onClick={handleSubmit}
            className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control bg-brand px-20 text-body font-semibold text-brand-on transition-colors duration-cardPress ease-out hover:bg-brand-dark active:bg-brand-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus aria-disabled:opacity-60 motion-reduce:transition-none"
          >
            {t('chores.addChore.submit')}
          </button>
        </div>
      </BottomSheet>
      <ToastViewport />
    </>
  );
}
