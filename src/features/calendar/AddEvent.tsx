/**
 * Add Event sheet/modal (Phase 3, Task 13; handoff #07 AddEventScreen;
 * preferences "toast-everything", "errors are user-safe").
 *
 * Renders inside a BottomSheet titled "Add Event". Collects ONLY the locked-
 * schema-relevant fields: title (autofocus, aria-required; on an empty-title
 * submit attempt becomes aria-invalid with an aria-describedby error region),
 * optional description, date (a role="radiogroup" of Today / Tomorrow radios
 * plus a SEPARATE aria-disabled "Pick date" placeholder that must NOT change the
 * selected day), and category/tag (a role="radiogroup" of School / Sports /
 * Family / Work radios with aria-checked, each with its token colour dot). The
 * submit is aria-disabled (focusable) while the trimmed title is empty, and a
 * click while disabled is a no-op (does not call onCreate). (Finding E a11y.)
 *
 * On submit: calls the injected `onCreate` with the collected value, then on
 * success closes the sheet and fires a success toast; on failure fires a
 * generic PII-free error toast and does NOT close.
 *
 * HANDOFF-vs-SCHEMA GAP (deferred): the handoff also shows start/end time, a
 * "who's it for" multi-select, and a location field — NONE are in the locked
 * 7-field schema, so this form does NOT collect or submit them.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { BottomSheet } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { EventTag, Role } from '../../lib/types';
import {
  EVENT_CREATE_SUCCESS,
  EVENT_GENERIC_ERROR,
  EVENT_TAG_LABEL,
  EVENT_UPDATE_SUCCESS,
  eventTagDotClass,
} from './calendarService';

export interface AddEventValue {
  title: string;
  description: string;
  /** ISO datetime string carrying the chosen day (and any time-of-day). */
  date: string;
  tag: EventTag;
}

export interface AddEventProps {
  open: boolean;
  onClose: () => void;
  author: { uid: string; name: string; role: Role };
  /**
   * Injected create action (the screen wires this to calendarService.createEvent
   * + useToast). Receives the collected value. Resolves on success, rejects on
   * failure.
   */
  onCreate: (value: AddEventValue) => Promise<void>;
  /** The reference "today" so the Today/Tomorrow chips are deterministic. */
  today: { year: number; month: number; day: number };
  /**
   * When set, the sheet enters EDIT mode: title/description/tag prefill from
   * this value, the sheet title becomes "Edit Event", the submit button
   * becomes "Save", and submitting calls `onUpdate` instead of `onCreate`.
   * The day picker is hidden in edit mode — the event's existing date is
   * preserved (date editing is a follow-up).
   */
  initialValue?: AddEventValue;
  /**
   * Required when `initialValue` is set. Receives the edited value (with the
   * original date preserved from `initialValue`).
   */
  onUpdate?: (value: AddEventValue) => Promise<void>;
}

type DayChoice = 'today' | 'tomorrow';

// Labels come from calendarService (single source of truth, shared with the
// agenda badges and the Dashboard upcoming-events badge); order is fixed here.
const CATEGORIES: ReadonlyArray<{ tag: EventTag; label: string }> = (
  ['school', 'sports', 'family', 'work'] as const
).map((tag) => ({ tag, label: EVENT_TAG_LABEL[tag] }));

const CATEGORY_TAGS: ReadonlyArray<EventTag> = CATEGORIES.map((c) => c.tag);
const DAY_CHOICES: ReadonlyArray<DayChoice> = ['today', 'tomorrow'];

/**
 * Arrow-key roving for a radiogroup: Left/Up moves to the previous option,
 * Right/Down to the next (wrapping). Mirrors the ARIA radiogroup keyboard
 * pattern so the control is operable without a pointer (Finding E).
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

/** Build an ISO datetime string from a Y/M/D (0-based month) at a fixed default
 * time-of-day. Date-only math via Date.UTC — never crosses a DST boundary in a
 * way that shifts the calendar day. */
function isoForDay(year: number, month: number, day: number): string {
  // Default to 12:00 local-noon-equivalent UTC so the stored day is unambiguous
  // and the `date` string always carries a time-of-day.
  return new Date(Date.UTC(year, month, day, 12, 0, 0)).toISOString();
}

function resolveDay(
  choice: DayChoice,
  today: { year: number; month: number; day: number },
): string {
  if (choice === 'today') {
    return isoForDay(today.year, today.month, today.day);
  }
  // Tomorrow: advance one calendar day via UTC date math (handles month/year
  // rollover and month lengths correctly).
  const next = new Date(Date.UTC(today.year, today.month, today.day + 1, 12, 0, 0));
  return next.toISOString();
}

export function AddEvent(props: AddEventProps): ReactElement {
  const { open, onClose, onCreate, today, initialValue, onUpdate } = props;
  const editMode = initialValue !== undefined;
  const { showToast } = useToast();
  const [title, setTitle] = useState(initialValue?.title ?? '');
  const [description, setDescription] = useState(initialValue?.description ?? '');
  const [tag, setTag] = useState<EventTag>(initialValue?.tag ?? 'family');
  const [dayChoice, setDayChoice] = useState<DayChoice>('today');
  const [submitting, setSubmitting] = useState(false);
  // Becomes true after a submit attempt with an empty title (or a create error),
  // surfacing the field as aria-invalid with associated error text (Finding E).
  const [titleInvalid, setTitleInvalid] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const titleErrorId = useId();
  const dateLegendId = useId();
  const categoryLegendId = useId();
  const titleRef = useRef<HTMLInputElement>(null);

  // Suppress success side effects (toast + onClose) if the sheet was dismissed/
  // unmounted while a create was in flight (mirrors ComposePost Finding E1).
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  const mountedRef = useRef(true);
  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Autofocus the title field when the sheet opens.
  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  // When the sheet re-opens with a different initialValue (the user clicked
  // Edit on a different event), re-seed the form state from the new value.
  // No-op for the create flow because initialValue stays undefined.
  useEffect(() => {
    if (open && initialValue) {
      setTitle(initialValue.title);
      setDescription(initialValue.description);
      setTag(initialValue.tag);
      setTitleInvalid(false);
    }
  }, [open, initialValue]);

  const trimmed = title.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleSubmit = (): void => {
    // aria-disabled keeps the button focusable; guard the action here so an
    // unavailable click is a no-op (does not call onCreate). An empty-title
    // attempt is surfaced as an accessible validation error (Finding E).
    if (!canSubmit) {
      if (trimmed.length === 0) setTitleInvalid(true);
      return;
    }
    setSubmitting(true);
    // In edit mode the date is preserved from the original event (date editing
    // is a follow-up). In create mode the date comes from the today/tomorrow
    // chip selection.
    const value: AddEventValue = {
      title: trimmed,
      description,
      date: editMode ? initialValue.date : resolveDay(dayChoice, today),
      tag,
    };
    const action = editMode && onUpdate ? onUpdate(value) : onCreate(value);
    void action
      .then(() => {
        if (!mountedRef.current || !openRef.current) return;
        showToast(editMode ? EVENT_UPDATE_SUCCESS : EVENT_CREATE_SUCCESS);
        // Only reset the form on create — for edit, the sheet is closing anyway
        // and a future open might re-seed from a different initialValue.
        if (!editMode) {
          setTitle('');
          setDescription('');
        }
        setTitleInvalid(false);
        setSubmitting(false);
        onClose();
      })
      .catch(() => {
        if (!mountedRef.current || !openRef.current) return;
        // Never surface a raw Firebase code / PII — generic copy only. Also flag
        // the field so AT users see the action did not succeed.
        showToast(EVENT_GENERIC_ERROR);
        setTitleInvalid(true);
        setSubmitting(false);
      });
  };

  return (
    <BottomSheet open={open} title={editMode ? 'Edit Event' : 'Add Event'} onClose={onClose}>
      <div className="flex flex-col gap-16">
        <div className="flex flex-col gap-6">
          <label htmlFor={titleId} className="text-label font-semibold text-ink-2">
            Event title <span className="text-ink-mute">(Required)</span>
          </label>
          <div className="flex h-field items-center rounded-control border border-surface-line bg-surface-card px-14 focus-within:border-brand focus-within:ring-focus focus-within:ring-brand focus-within:ring-offset-focus">
            <input
              id={titleId}
              ref={titleRef}
              type="text"
              value={title}
              aria-required="true"
              aria-invalid={titleInvalid || undefined}
              aria-describedby={titleInvalid ? titleErrorId : undefined}
              onChange={(e) => {
                setTitle(e.target.value);
                if (e.target.value.trim().length > 0) setTitleInvalid(false);
              }}
              placeholder="What's happening?"
              className="w-full bg-transparent text-body text-ink placeholder:text-ink-mute2 focus:outline-none"
            />
          </div>
          {titleInvalid && (
            <p
              id={titleErrorId}
              role="alert"
              className="text-meta font-semibold text-status-danger-text"
            >
              Please enter an event title before adding it.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <label htmlFor={descriptionId} className="text-label font-semibold text-ink-2">
            Description
          </label>
          <textarea
            id={descriptionId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add a note (optional)"
            rows={2}
            className="w-full resize-none rounded-control border border-surface-line bg-surface-card px-14 py-12 text-body text-ink placeholder:text-ink-mute2 focus-visible:border-brand focus-visible:outline-none focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          />
        </div>

        <fieldset className="flex flex-col gap-6">
          <legend id={dateLegendId} className="text-label font-semibold text-ink-2">
            Date
          </legend>
          {editMode ? (
            // In edit mode the original date is preserved. Show it as static
            // text so the user knows what day they're editing. Date editing
            // (a real picker) is a follow-up — kept out of scope here so the
            // edit-event flow ships behind the existing edit button on day 1.
            <p className="text-body text-ink-mute">
              {new Intl.DateTimeFormat(undefined, {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              }).format(new Date(initialValue.date))}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-8">
              {/* Today/Tomorrow are mutually-exclusive radios in a radiogroup named
                by the Date legend; arrow keys move the selection (roving
                tabindex), Tab reaches the group (Finding E). Pick date is OUTSIDE
                the group. */}
              <div
                role="radiogroup"
                aria-labelledby={dateLegendId}
                className="flex flex-wrap gap-8"
              >
                {(
                  [
                    { choice: 'today', label: 'Today' },
                    { choice: 'tomorrow', label: 'Tomorrow' },
                  ] as ReadonlyArray<{ choice: DayChoice; label: string }>
                ).map(({ choice, label }) => {
                  const selected = dayChoice === choice;
                  return (
                    <button
                      key={choice}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setDayChoice(choice)}
                      onKeyDown={(e) => handleRadioKeys(e, DAY_CHOICES, dayChoice, setDayChoice)}
                      className={`inline-flex min-h-tap items-center justify-center rounded-control border px-16 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
                        selected
                          ? 'border-brand bg-brand-light text-brand'
                          : 'border-surface-line bg-surface-card text-ink-2 hover:bg-surface-line2'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {/* Pick date is a placeholder affordance for a future native date
                picker — OUTSIDE the radiogroup, aria-disabled, and a no-op so it
                does NOT silently change the selected day (Finding E). */}
              <button
                type="button"
                aria-disabled="true"
                onClick={() => {
                  /* no-op: no real picker yet; must not mutate the selected day */
                }}
                className="inline-flex min-h-tap cursor-not-allowed items-center justify-center rounded-control border border-surface-line bg-surface-card px-16 text-body font-semibold text-ink-mute opacity-50 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
              >
                Pick date
              </button>
            </div>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-6">
          <legend id={categoryLegendId} className="text-label font-semibold text-ink-2">
            Category
          </legend>
          {/* Mutually-exclusive radios in a radiogroup named by the Category
              legend; arrow keys move the selection (roving tabindex). Each
              option pairs a token colour dot with its text label (WCAG 1.4.1 —
              never colour alone). */}
          <div
            role="radiogroup"
            aria-labelledby={categoryLegendId}
            className="flex flex-wrap gap-8"
          >
            {CATEGORIES.map(({ tag: catTag, label }) => {
              const selected = tag === catTag;
              return (
                <button
                  key={catTag}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setTag(catTag)}
                  onKeyDown={(e) => handleRadioKeys(e, CATEGORY_TAGS, tag, setTag)}
                  className={`inline-flex min-h-tap items-center gap-8 rounded-control border px-16 text-body font-semibold transition-colors duration-cardPress ease-out focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none ${
                    selected
                      ? 'border-brand bg-brand-light text-brand'
                      : 'border-surface-line bg-surface-card text-ink-2 hover:bg-surface-line2'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-12 w-12 rounded-full ${eventTagDotClass(catTag)}`}
                  />
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>

        <button
          type="button"
          aria-disabled={!canSubmit}
          aria-busy={submitting || undefined}
          onClick={handleSubmit}
          className={`inline-flex min-h-tap items-center justify-center rounded-control bg-brand px-20 text-body font-semibold text-brand-on transition-colors duration-cardPress ease-out hover:bg-brand-dark focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus active:bg-brand-dark motion-reduce:transition-none ${!canSubmit ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {editMode ? 'Save changes' : 'Add Event'}
        </button>

        {/* Announce the in-flight state to assistive tech; the button label
            stays stable in each mode so its accessible name doesn't shift. */}
        <p aria-live="polite" className="sr-only">
          {submitting ? (editMode ? 'Saving changes…' : 'Adding event…') : ''}
        </p>
      </div>

      {/* The single toast live region is a global singleton (ToastViewport
          Finding F) — if a shell/screen viewport is already mounted, this
          instance is inert, so the success message is never announced twice. */}
      <ToastViewport />
    </BottomSheet>
  );
}
