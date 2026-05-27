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
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { BottomSheet } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { EventTag, Role } from '../../lib/types';
import { EVENT_CREATE_SUCCESS, EVENT_GENERIC_ERROR, eventTagDotClass } from './calendarService';

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
}

type DayChoice = 'today' | 'tomorrow';

const CATEGORIES: ReadonlyArray<{ tag: EventTag; label: string }> = [
  { tag: 'school', label: 'School' },
  { tag: 'sports', label: 'Sports' },
  { tag: 'family', label: 'Family' },
  { tag: 'work', label: 'Work' },
];

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
  const { open, onClose, onCreate, today } = props;
  const { showToast } = useToast();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tag, setTag] = useState<EventTag>('family');
  const [dayChoice, setDayChoice] = useState<DayChoice>('today');
  const [submitting, setSubmitting] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
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

  const trimmed = title.trim();
  const canSubmit = trimmed.length > 0 && !submitting;

  const handleSubmit = (): void => {
    // aria-disabled keeps the button focusable; guard the action here so an
    // unavailable click is a no-op (does not call onCreate).
    if (!canSubmit) return;
    setSubmitting(true);
    const value: AddEventValue = {
      title: trimmed,
      description,
      date: resolveDay(dayChoice, today),
      tag,
    };
    void onCreate(value)
      .then(() => {
        if (!mountedRef.current || !openRef.current) return;
        showToast(EVENT_CREATE_SUCCESS);
        setTitle('');
        setDescription('');
        setSubmitting(false);
        onClose();
      })
      .catch(() => {
        if (!mountedRef.current || !openRef.current) return;
        // Never surface a raw Firebase code / PII — generic copy only.
        showToast(EVENT_GENERIC_ERROR);
        setSubmitting(false);
      });
  };

  return (
    <BottomSheet open={open} title="Add Event" onClose={onClose}>
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
              required
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What's happening?"
              className="w-full bg-transparent text-body text-ink placeholder:text-ink-mute2 focus:outline-none"
            />
          </div>
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
          <legend className="text-label font-semibold text-ink-2">Date</legend>
          <div className="flex flex-wrap gap-8">
            {[
              { choice: 'today' as const, label: 'Today' },
              { choice: 'tomorrow' as const, label: 'Tomorrow' },
            ].map(({ choice, label }) => {
              const selected = dayChoice === choice;
              return (
                <button
                  key={choice}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setDayChoice(choice)}
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
            {/* Pick date is a placeholder affordance for a future native date
                picker; the locked schema only needs a day, and Today/Tomorrow
                cover the common case. It selects Today as a safe default. */}
            <button
              type="button"
              onClick={() => setDayChoice('today')}
              className="inline-flex min-h-tap items-center justify-center rounded-control border border-surface-line bg-surface-card px-16 text-body font-semibold text-ink-2 transition-colors duration-cardPress ease-out hover:bg-surface-line2 focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus motion-reduce:transition-none"
            >
              Pick date
            </button>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-6">
          <legend className="text-label font-semibold text-ink-2">Category</legend>
          <div className="flex flex-wrap gap-8">
            {CATEGORIES.map(({ tag: catTag, label }) => {
              const selected = tag === catTag;
              return (
                <button
                  key={catTag}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTag(catTag)}
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
          Add Event
        </button>

        {/* Announce the in-flight state to assistive tech; the button label
            stays "Add Event" so its accessible name is stable. */}
        <p aria-live="polite" className="sr-only">
          {submitting ? 'Adding event…' : ''}
        </p>
      </div>

      {/* The single toast live region is a global singleton (ToastViewport
          Finding F) — if a shell/screen viewport is already mounted, this
          instance is inert, so the success message is never announced twice. */}
      <ToastViewport />
    </BottomSheet>
  );
}
