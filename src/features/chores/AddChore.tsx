/**
 * Add Chore sheet/modal (Phase 3, Task 11; handoff #06 AddChoreScreen).
 *
 * Renders inside a BottomSheet titled "Add Chore" (parent-only). Collects the
 * hardened-schema-relevant fields: title (autofocus, aria-required), assign-to
 * (a radiogroup populated from the ACTIVE family members — DYNAMIC, never
 * hardcoded), due date (Today / Tomorrow / Pick date chips), point value, dollar
 * value, recurring toggle + frequency (none/weekly/biweekly). Submit is
 * aria-disabled (focusable) while the trimmed title is empty; a click while
 * disabled is a no-op.
 *
 * On submit: calls the injected `onAdd` with the collected value (date is an ISO
 * datetime string, derived from the injected reference "today" so the chips are
 * deterministic); on success closes + success toast; on failure a generic
 * PII-free error toast, no close. The form NEVER emits status/createdBy/familyId
 * — the service fixes those (status='pending', createdBy=author, familyId=own).
 */
import { useId, useState, type ReactElement } from 'react';
import { BottomSheet } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { RecurrenceFrequency, Role, UserWithId } from '../../lib/types';
import { CHORE_ADD_SUCCESS, CHORE_PARENT_GENERIC_ERROR } from './choresParentService';

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

function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function AddChore(props: AddChoreProps): ReactElement {
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

  const assignLabelId = useId();
  const dueLabelId = useId();
  const freqLabelId = useId();

  const titleValid = title.trim().length > 0;
  const canSubmit = titleValid && !submitting;

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
      pointValue: toNumber(pointValue),
      dollarValue: toNumber(dollarValue),
      isRecurring,
      recurrenceFrequency: isRecurring ? recurrenceFrequency : 'none',
    };
    void onAdd(value)
      .then(() => {
        showToast(CHORE_ADD_SUCCESS);
        onClose();
      })
      .catch(() => showToast(CHORE_PARENT_GENERIC_ERROR))
      .finally(() => setSubmitting(false));
  };

  if (!open) return <ToastViewport />;

  return (
    <>
      <BottomSheet open={open} title="Add Chore" onClose={onClose}>
        <div className="flex flex-col gap-16">
          {/* Title — autofocus-eligible (first focusable), aria-required. */}
          <div className="flex flex-col gap-6">
            <label
              htmlFor={`${assignLabelId}-title`}
              className="text-label font-semibold text-ink-2"
            >
              What needs doing?
            </label>
            <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
              <input
                id={`${assignLabelId}-title`}
                type="text"
                value={title}
                aria-required="true"
                aria-label="Chore title"
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-transparent text-body text-ink placeholder:text-ink-mute2 focus:outline-none"
              />
            </div>
          </div>

          {/* Assign-to — DYNAMIC radiogroup, one radio per active member. */}
          <fieldset className="flex flex-col gap-8">
            <legend id={assignLabelId} className="text-label font-semibold text-ink-2">
              Assign to
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
                    aria-label={m.name}
                    onClick={() => setAssignedTo(m.id)}
                    className={`inline-flex min-h-tap items-center rounded-control border px-14 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
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

          {/* Due date — Today / Tomorrow / Pick date radios. */}
          <fieldset className="flex flex-col gap-8">
            <legend id={dueLabelId} className="text-label font-semibold text-ink-2">
              Due
            </legend>
            <div role="radiogroup" aria-labelledby={dueLabelId} className="flex flex-wrap gap-8">
              {(
                [
                  { id: 'today', label: 'Today' },
                  { id: 'tomorrow', label: 'Tomorrow' },
                  { id: 'pick', label: 'Pick date' },
                ] as { id: DueChoice; label: string }[]
              ).map((opt) => {
                const selected = due === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={opt.label}
                    onClick={() => setDue(opt.id)}
                    className={`inline-flex min-h-tap items-center rounded-control border px-14 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
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
              <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
                <input
                  type="date"
                  value={pickedDate}
                  aria-label="Pick a due date"
                  onChange={(e) => setPickedDate(e.target.value)}
                  className="w-full bg-transparent text-body text-ink focus:outline-none"
                />
              </div>
            )}
          </fieldset>

          {/* Reward — point value + dollar value number inputs. */}
          <div className="flex gap-12">
            <div className="flex flex-1 flex-col gap-6">
              <label
                htmlFor={`${freqLabelId}-points`}
                className="text-label font-semibold text-ink-2"
              >
                Point value
              </label>
              <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
                <input
                  id={`${freqLabelId}-points`}
                  type="number"
                  min="0"
                  value={pointValue}
                  aria-label="Point value"
                  onChange={(e) => setPointValue(e.target.value)}
                  className="w-full bg-transparent text-body text-ink focus:outline-none"
                />
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-6">
              <label
                htmlFor={`${freqLabelId}-dollars`}
                className="text-label font-semibold text-ink-2"
              >
                Dollar reward
              </label>
              <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
                <input
                  id={`${freqLabelId}-dollars`}
                  type="number"
                  min="0"
                  value={dollarValue}
                  aria-label="Dollar reward"
                  onChange={(e) => setDollarValue(e.target.value)}
                  className="w-full bg-transparent text-body text-ink focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Recurring toggle + frequency. */}
          <div className="flex flex-col gap-8">
            <label className="flex min-h-tap items-center gap-12">
              <input
                type="checkbox"
                role="switch"
                checked={isRecurring}
                aria-label="Recurring"
                onChange={(e) => setIsRecurring(e.target.checked)}
                className="h-20 w-20 rounded-control border-surface-line text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
              />
              <span className="text-body font-semibold text-ink">Repeats</span>
            </label>
            <fieldset className="flex flex-col gap-8">
              <legend id={freqLabelId} className="text-label font-semibold text-ink-2">
                How often
              </legend>
              <div
                role="radiogroup"
                aria-labelledby={freqLabelId}
                className="flex flex-wrap gap-8"
                aria-disabled={!isRecurring}
              >
                {(
                  [
                    { id: 'weekly', label: 'Weekly' },
                    { id: 'biweekly', label: 'Every other week' },
                  ] as { id: RecurrenceFrequency; label: string }[]
                ).map((opt) => {
                  const selected = recurrenceFrequency === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={opt.label}
                      onClick={() => {
                        setRecurrenceFrequency(opt.id);
                        setIsRecurring(true);
                      }}
                      className={`inline-flex min-h-tap items-center rounded-control border px-14 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
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
              trimmed title is empty; a click while disabled is a no-op. */}
          <button
            type="button"
            aria-disabled={canSubmit ? undefined : 'true'}
            onClick={handleSubmit}
            className="inline-flex min-h-tap items-center justify-center rounded-control bg-brand px-20 text-body font-semibold text-brand-on transition-colors duration-cardPress ease-out hover:bg-brand-dark active:bg-brand-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus aria-disabled:opacity-60 motion-reduce:transition-none"
          >
            Add chore
          </button>
        </div>
      </BottomSheet>
      <ToastViewport />
    </>
  );
}
