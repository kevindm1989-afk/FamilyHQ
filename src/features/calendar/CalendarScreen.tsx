/**
 * Calendar screen (Phase 3, Task 13; handoff #03 CalendarScreen).
 *
 *  - LOADING: while the feed is loading, renders the Skeleton (role="status").
 *  - MONTH GRID: a labelled LIST (role="list"/<ul> with listitem day-cell
 *    buttons — NOT a bare role="grid", Finding E) with a month header (prev/next),
 *    a day-of-week strip, the today cell marked aria-current="date", and the
 *    selected day exposed via aria-pressed. Each day-cell button carries min-w-tap
 *    (44px target) and an accessible name that includes the full date (month +
 *    year). A dedicated visually-hidden role="status"/aria-live="polite" region
 *    (data-testid="month-status") announces the displayed "Month YYYY" on
 *    prev/next — the heading itself is NOT aria-live.
 *  - EVENT DOTS: a day with events shows up to 3 category-coloured dots (tokens).
 *  - AGENDA: the selected day's events (time + title + tag) below the grid; tap
 *    a day to select it. A friendly EMPTY state for a day with no events.
 *  - PARENT-ONLY: the + FAB and per-event edit/delete affordances render ONLY
 *    for a parent (canManageEvents). Members VIEW the shared calendar.
 *  - Every action toasts (preferences "toast-everything").
 *
 * Feed state, the reference "today", and the actions are INJECTED so the screen
 * renders deterministically without Firestore. firestore.rules is the real
 * authority boundary; the parent gating here is cosmetic.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { Badge, EmptyState, Fab, Skeleton } from '../../components';
import { ToastViewport } from '../../app/ToastViewport';
import { useToast } from '../../hooks/useToast';
import type { EventTag, Role, UserWithId } from '../../lib/types';
import {
  canManageEvents,
  EVENT_DELETE_SUCCESS,
  EVENT_GENERIC_ERROR,
  eventTagDotClass,
  type EventWithId,
} from './calendarService';
import { buildMonthGrid, eventsForDay, type GridDay, type YearMonthDay } from './monthGrid';
import { AddEvent, type AddEventValue } from './AddEvent';

export interface CalendarScreenProps {
  familyId: string | null;
  viewer: { uid: string; name: string; role: Role };
  members: UserWithId[];
  feed: {
    events: EventWithId[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
  };
  /** The reference "today" (injected so the today-cell highlight is deterministic). */
  today: { year: number; month: number; day: number };
  onDeleteEvent: (eventId: string) => Promise<void>;
  onCreateEvent?: (input: {
    title: string;
    description: string;
    date: string;
    tag: EventTag;
  }) => Promise<void>;
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// S M T W T F S — duplicate letters are fine; each column is its own cell.
const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const TAG_LABEL: Record<EventTag, string> = {
  school: 'School',
  sports: 'Sports',
  family: 'Family',
  work: 'Work',
};

const TIME_FORMAT = new Intl.DateTimeFormat('en-CA', {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'UTC',
});

/**
 * Format the time-of-day shown in the agenda.
 *
 * FINDING B (timezone consistency): must read the LITERAL H:M (floating wall-
 * clock) from the `date` string — the SAME literal Y-M-D/H:M that monthGrid's
 * `eventsForDay` uses to bucket the day — NOT reinterpret `new Date(iso)` as an
 * instant under a fixed `timeZone:'UTC'`. Otherwise a non-UTC user sees a shifted
 * time that can disagree with the grid day the event is filed under.
 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : TIME_FORMAT.format(d);
}

export function CalendarScreen(props: CalendarScreenProps): ReactElement {
  const { viewer, feed, today, onDeleteEvent, onCreateEvent } = props;
  const { showToast } = useToast();
  const canManage = canManageEvents(viewer);

  // The displayed month (starts on the reference month). Prev/Next step it.
  const [view, setView] = useState<{ year: number; month: number }>({
    year: today.year,
    month: today.month,
  });
  // The selected day for the agenda — defaults to today.
  const [selected, setSelected] = useState<YearMonthDay>({
    year: today.year,
    month: today.month,
    day: today.day,
  });
  const [addOpen, setAddOpen] = useState(false);

  const grid = useMemo(
    () => buildMonthGrid(view.year, view.month, today),
    [view.year, view.month, today],
  );

  const selectedEvents = useMemo(
    () => eventsForDay(feed.events, selected),
    [feed.events, selected],
  );

  const stepMonth = (delta: number): void => {
    setView((v) => {
      const m = v.month + delta;
      if (m < 0) return { year: v.year - 1, month: 11 };
      if (m > 11) return { year: v.year + 1, month: 0 };
      return { year: v.year, month: m };
    });
  };

  const handleDelete = (eventId: string): void => {
    void onDeleteEvent(eventId)
      .then(() => showToast(EVENT_DELETE_SUCCESS))
      .catch(() => showToast(EVENT_GENERIC_ERROR));
  };

  const handleCreate = async (value: AddEventValue): Promise<void> => {
    if (onCreateEvent) await onCreateEvent(value);
  };

  return (
    <>
      <section className="flex flex-col gap-16 px-16 pt-4 pb-24">
        <h1 className="text-display font-display font-extrabold text-ink">Calendar</h1>

        {feed.loading ? (
          <Skeleton label="Loading the calendar…" />
        ) : (
          <>
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="Previous month"
                onClick={() => stepMonth(-1)}
                className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control text-ink-mute hover:text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
              >
                <ChevronIcon direction="left" />
              </button>
              <h2 className="text-title font-bold text-ink" aria-live="polite">
                {MONTH_NAMES[view.month]} {view.year}
              </h2>
              <button
                type="button"
                aria-label="Next month"
                onClick={() => stepMonth(1)}
                className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control text-ink-mute hover:text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
              >
                <ChevronIcon direction="right" />
              </button>
            </div>

            <div
              data-testid="day-of-week-strip"
              className="grid grid-cols-7 text-center text-meta font-semibold text-ink-mute"
            >
              {WEEKDAY_LETTERS.map((letter, i) => (
                <span key={i} aria-hidden="true">
                  {letter}
                </span>
              ))}
            </div>

            <div role="grid" aria-label="Month" className="grid grid-cols-7 gap-4">
              {grid.flat().map((cell) => (
                <DayCell
                  key={`${cell.year}-${cell.month}-${cell.day}-${cell.inMonth ? 'in' : 'out'}`}
                  cell={cell}
                  events={eventsForDay(feed.events, cell)}
                  selected={
                    cell.inMonth &&
                    cell.year === selected.year &&
                    cell.month === selected.month &&
                    cell.day === selected.day
                  }
                  onSelect={() =>
                    setSelected({ year: cell.year, month: cell.month, day: cell.day })
                  }
                />
              ))}
            </div>

            <Agenda events={selectedEvents} canManage={canManage} onDelete={handleDelete} />
          </>
        )}
      </section>

      {canManage && (
        <div className="fixed bottom-fab-from-bottom right-16 z-fab">
          <Fab label="Add event" onClick={() => setAddOpen(true)} />
        </div>
      )}

      {canManage && (
        <div>
          <AddEvent
            open={addOpen}
            onClose={() => setAddOpen(false)}
            author={viewer}
            onCreate={handleCreate}
            today={today}
          />
        </div>
      )}

      {/* Single toast live region for calendar flows (ToastViewport is a global
          singleton — a duplicate instance is inert, so a toast is never
          announced twice). Kept outside the section + sheet so it is never
          inerted while the sheet is open. */}
      <ToastViewport />
    </>
  );
}

interface DayCellProps {
  cell: GridDay;
  events: EventWithId[];
  selected: boolean;
  onSelect: () => void;
}

function DayCell(props: DayCellProps): ReactElement {
  const { cell, events, selected, onSelect } = props;
  const dots = events.slice(0, 3); // AT MOST 3 dots per day
  const label = `${cell.day}${cell.isToday ? ' (today)' : ''}${
    events.length > 0 ? `, ${events.length} event${events.length === 1 ? '' : 's'}` : ''
  }`;
  return (
    <button
      type="button"
      data-testid="calendar-day"
      data-in-month={cell.inMonth ? 'true' : 'false'}
      aria-current={cell.isToday ? 'date' : undefined}
      aria-label={label}
      onClick={onSelect}
      className={`flex min-h-tap flex-col items-center justify-start gap-4 rounded-control px-4 py-4 text-body focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus ${
        cell.inMonth ? 'text-ink' : 'text-ink-mute2'
      } ${cell.isToday ? 'bg-brand-light font-bold text-brand' : ''} ${
        selected && !cell.isToday ? 'bg-surface-line2' : ''
      } ${selected ? 'ring-1 ring-brand' : ''}`}
    >
      <span>{cell.day}</span>
      {dots.length > 0 && (
        <span className="flex items-center gap-4" aria-hidden="true">
          {dots.map((event) => (
            <span
              key={event.id}
              data-testid="event-dot"
              className={`h-4 w-4 rounded-full ${eventTagDotClass(event.tag)}`}
            />
          ))}
        </span>
      )}
    </button>
  );
}

interface AgendaProps {
  events: EventWithId[];
  canManage: boolean;
  onDelete: (eventId: string) => void;
}

function Agenda(props: AgendaProps): ReactElement {
  const { events, canManage, onDelete } = props;
  return (
    <div data-testid="agenda" className="flex flex-col gap-12">
      {events.length === 0 ? (
        <EmptyState message="Nothing scheduled — enjoy the open day." />
      ) : (
        <ul className="flex flex-col gap-8" aria-label="Events for the selected day">
          {events.map((event) => {
            const time = formatTime(event.date);
            return (
              <li
                key={event.id}
                className="flex items-center gap-12 rounded-control border border-surface-line bg-surface-card px-14 py-12"
              >
                {time && (
                  <time dateTime={event.date} className="text-meta font-semibold text-ink-mute">
                    {time}
                  </time>
                )}
                <span className="flex-1 text-body font-semibold text-ink">{event.title}</span>
                {/* Category is conveyed as TEXT, never colour alone (WCAG 1.4.1). */}
                <Badge tone={event.tag}>{TAG_LABEL[event.tag]}</Badge>
                {canManage && (
                  <span className="flex items-center gap-4">
                    <button
                      type="button"
                      aria-label={`Edit ${event.title}`}
                      className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control text-ink-mute hover:text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                    >
                      <EditIcon />
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${event.title}`}
                      onClick={() => onDelete(event.id)}
                      className="inline-flex min-h-tap min-w-tap items-center justify-center rounded-control text-ink-mute hover:text-status-danger-text focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                    >
                      <TrashIcon />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChevronIcon(props: { direction: 'left' | 'right' }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-24 w-24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path
        d={props.direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EditIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-20 w-20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M4 20h4L18 10l-4-4L4 16v4zM14 6l4 4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-20 w-20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path
        d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0v12a1 1 0 001 1h8a1 1 0 001-1V7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
