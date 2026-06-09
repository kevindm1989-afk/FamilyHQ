/**
 * Calendar screen — component contract (Task 13; handoff #03 CalendarScreen;
 * preferences "empty + loading states", "dynamic family", "toast-everything").
 *
 * Level: component. Feed state, the reference "today", and the actions are
 * INJECTED so the screen renders deterministically without Firestore or the
 * real clock. Server authority is covered by test/rules/events.test.ts; the feed
 * query scoping by useFamilyEvents.test.tsx; the grid math by monthGrid.test.ts.
 *
 * FAILS today: CalendarScreen is a contract stub that throws on render.
 *
 * State traceability (designer-defined states):
 *  - loading -> Skeleton (role=status)
 *  - month grid 6x7 + month header (prev/next) + day-of-week strip + today cell
 *  - day-with-events -> up-to-3 category-coloured dots
 *  - selected-day agenda -> time + title + tag rows
 *  - empty (selected day, no events) -> friendly empty message
 *  - parent -> + FAB + edit/delete; member -> none (VIEW only)
 *
 * Isolation: injected props + ToastProvider; no clock/network/RNG; each test
 * builds its own props (order-independent).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { CalendarScreen, type CalendarScreenProps } from './CalendarScreen';
import { EVENT_DELETE_SUCCESS, type EventWithId } from './calendarService';
import type { UserWithId } from '../../lib/types';

const TODAY = { year: 2026, month: 4, day: 27 }; // May 27 2026

const MEMBERS: UserWithId[] = [
  {
    id: 'uid-parent-a',
    name: 'Sarah Kim',
    role: 'parent',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 0,
    theme: 'light',
  },
  {
    id: 'uid-member-a',
    name: 'Maya Rivera',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 0,
    theme: 'light',
  },
];

function mkEvent(over: Partial<EventWithId> & { id: string }): EventWithId {
  return {
    title: 'Soccer practice',
    description: '',
    date: '2026-05-27T17:30:00.000Z',
    tag: 'sports',
    familyId: 'fam-A',
    createdBy: 'uid-parent-a',
    createdAt: 1000,
    ...over,
  };
}

function renderCalendar(overrides: Partial<CalendarScreenProps> = {}) {
  const props: CalendarScreenProps = {
    familyId: 'fam-A',
    viewer: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
    members: MEMBERS,
    today: TODAY,
    feed: {
      events: [],
      loading: false,
      error: null,
      refresh: vi.fn().mockResolvedValue(undefined),
    },
    onDeleteEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(
    <ToastProvider>
      <CalendarScreen {...props} />
    </ToastProvider>,
  );
  return props;
}

describe('CalendarScreen — loading state', () => {
  it('renders a loading affordance (role=status) while the feed is loading', () => {
    renderCalendar({ feed: { events: [], loading: true, error: null, refresh: vi.fn() } });
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('CalendarScreen — month header + day-of-week strip', () => {
  it('shows the displayed month and year in the header', () => {
    renderCalendar();
    expect(screen.getByText(/May\s*2026/i)).toBeInTheDocument();
  });

  it('renders previous- and next-month controls', () => {
    renderCalendar();
    expect(screen.getByRole('button', { name: /previous month|prev/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next month/i })).toBeInTheDocument();
  });

  it('renders a 7-column day-of-week strip', () => {
    renderCalendar();
    const strip = screen.getByTestId('day-of-week-strip');
    // 7 single-letter columns S M T W T F S.
    expect(within(strip).getAllByText(/^[SMTWF]$/)).toHaveLength(7);
  });
});

describe('CalendarScreen — month grid (6x7) with today highlighted', () => {
  it('renders 42 day cells (6 weeks x 7 days)', () => {
    renderCalendar();
    expect(screen.getAllByTestId('calendar-day')).toHaveLength(42);
  });

  it('marks exactly one cell as today (aria-current="date")', () => {
    renderCalendar();
    const current = screen
      .getAllByTestId('calendar-day')
      .filter((el) => el.getAttribute('aria-current') === 'date');
    expect(current).toHaveLength(1);
    expect(current[0]!).toHaveTextContent('27');
  });
});

describe('CalendarScreen — event dots on days with events (up to 3, category-coloured)', () => {
  it('renders a category-coloured dot on a day that has an event', () => {
    renderCalendar({
      feed: {
        events: [mkEvent({ id: 'e1', date: '2026-05-27T10:00:00.000Z', tag: 'sports' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const dots = screen.getAllByTestId('event-dot');
    expect(dots.length).toBeGreaterThanOrEqual(1);
    // Token class, not raw hex (style-guide: tokens only).
    expect(dots[0]!.className).toMatch(/bg-category-sports-dot/);
  });

  it('renders AT MOST 3 dots even when a day has more than 3 events', () => {
    renderCalendar({
      feed: {
        events: [
          mkEvent({ id: 'e1', date: '2026-05-27T08:00:00.000Z', tag: 'school' }),
          mkEvent({ id: 'e2', date: '2026-05-27T09:00:00.000Z', tag: 'sports' }),
          mkEvent({ id: 'e3', date: '2026-05-27T10:00:00.000Z', tag: 'family' }),
          mkEvent({ id: 'e4', date: '2026-05-27T11:00:00.000Z', tag: 'work' }),
          mkEvent({ id: 'e5', date: '2026-05-27T12:00:00.000Z', tag: 'school' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // Find the today cell and count its dots.
    const todayCell = screen
      .getAllByTestId('calendar-day')
      .find((el) => el.getAttribute('aria-current') === 'date')!;
    expect(within(todayCell).getAllByTestId('event-dot').length).toBeLessThanOrEqual(3);
  });
});

describe('CalendarScreen — selected-day agenda', () => {
  it('shows the selected day’s events (time + title + tag) below the grid', () => {
    renderCalendar({
      feed: {
        events: [
          mkEvent({ id: 'e1', title: 'Recital', date: '2026-05-27T17:30:00.000Z', tag: 'family' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // Today is the default-selected day.
    const agenda = screen.getByTestId('agenda');
    expect(within(agenda).getByText('Recital')).toBeInTheDocument();
    expect(within(agenda).getByText(/family/i)).toBeInTheDocument();
  });

  it('selecting a DIFFERENT day shows THAT day’s agenda', () => {
    renderCalendar({
      feed: {
        events: [
          mkEvent({ id: 'today-e', title: 'Today event', date: '2026-05-27T10:00:00.000Z' }),
          mkEvent({ id: 'other-e', title: 'May 15 event', date: '2026-05-15T10:00:00.000Z' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // Pick May 15.
    const cell15 = screen
      .getAllByTestId('calendar-day')
      .find((el) => within(el).queryByText('15') && el.getAttribute('data-in-month') === 'true')!;
    fireEvent.click(cell15);
    const agenda = screen.getByTestId('agenda');
    expect(within(agenda).getByText('May 15 event')).toBeInTheDocument();
    expect(within(agenda).queryByText('Today event')).not.toBeInTheDocument();
  });

  it('shows a friendly EMPTY state for a selected day with no events', () => {
    renderCalendar({
      feed: {
        events: [mkEvent({ id: 'e1', date: '2026-05-15T10:00:00.000Z' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    // Today (May 27) has no events -> the agenda shows an empty message.
    const agenda = screen.getByTestId('agenda');
    expect(within(agenda).getByText(/nothing scheduled|no events|enjoy/i)).toBeInTheDocument();
  });
});

describe('CalendarScreen — parent-only management affordances (security gating)', () => {
  it('a PARENT sees the + FAB to add an event', () => {
    renderCalendar({ viewer: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' } });
    expect(screen.getByRole('button', { name: /add event|new event/i })).toBeInTheDocument();
  });

  it('a MEMBER does NOT see the + FAB (view-only calendar)', () => {
    renderCalendar({ viewer: { uid: 'uid-member-a', name: 'Maya Rivera', role: 'member' } });
    expect(screen.queryByRole('button', { name: /add event|new event/i })).not.toBeInTheDocument();
  });

  it('a PARENT sees an edit + a delete control on an agenda event', () => {
    renderCalendar({
      viewer: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
      feed: {
        events: [mkEvent({ id: 'e1', title: 'Recital', date: '2026-05-27T17:30:00.000Z' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });

  it('a MEMBER does NOT see edit/delete controls on an agenda event (view-only)', () => {
    renderCalendar({
      viewer: { uid: 'uid-member-a', name: 'Maya Rivera', role: 'member' },
      feed: {
        events: [mkEvent({ id: 'e1', title: 'Recital', date: '2026-05-27T17:30:00.000Z' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('a PARENT clicking delete calls onDeleteEvent with the id and toasts (toast-everything)', async () => {
    const onDeleteEvent = vi.fn().mockResolvedValue(undefined);
    renderCalendar({
      viewer: { uid: 'uid-parent-a', name: 'Sarah Kim', role: 'parent' },
      onDeleteEvent,
      feed: {
        events: [mkEvent({ id: 'e1', title: 'Recital', date: '2026-05-27T17:30:00.000Z' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    await waitFor(() => expect(onDeleteEvent).toHaveBeenCalledWith('e1'));
    // Query by the toast TEXT (not getByRole('status')) — Finding E adds a
    // dedicated month-announcement status region, so there can legitimately be
    // more than one status node on screen.
    await waitFor(() => expect(screen.getByText(EVENT_DELETE_SUCCESS)).toBeInTheDocument());
  });
});

describe('CalendarScreen — formatTime/bucketing TZ consistency (Finding B)', () => {
  // To make the bug OBSERVABLE in jsdom (where we cannot change the runner's real
  // zone after import) the fixtures carry an explicit non-UTC OFFSET on the
  // `date` string. The two readings then diverge:
  //   - LITERAL wall-clock (the fix + what eventsForDay buckets on): 17:30 -> 5:30
  //   - buggy `new Date(iso)` reinterpreted under timeZone:'UTC':   21:30 -> 9:30
  // So the agenda time and the bucketed day must BOTH reflect the literal H:M/day,
  // never the instant. eventsForDay already reads the literal Y-M-D; formatTime
  // must match it.
  it('shows the LITERAL time-of-day from an offset-bearing date string, consistent with its bucketed day', () => {
    renderCalendar({
      today: { year: 2026, month: 5, day: 1 }, // June 1 2026 (default-selected)
      feed: {
        events: [
          mkEvent({
            id: 'tz-e',
            title: 'Recital',
            date: '2026-06-01T17:30:00.000-04:00',
            tag: 'family',
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });

    const agenda = screen.getByTestId('agenda');
    // (b) bucketing: filed on the LITERAL day, June 1.
    expect(
      within(agenda).getByText('Recital'),
      'event must bucket on the LITERAL calendar day (2026-06-01)',
    ).toBeInTheDocument();
    // (a) displayed time reflects the LITERAL 17:30 (5:30), not the instant (9:30).
    expect(
      within(agenda).getByText(/\b5:30\b/),
      'displayed time must reflect the literal 17:30 wall-clock, not the UTC-reinterpreted instant',
    ).toBeInTheDocument();
    expect(
      within(agenda).queryByText(/\b9:30\b/),
      'must NOT show the timeZone:UTC instant reading (9:30)',
    ).not.toBeInTheDocument();
  });

  it('a near-midnight literal time displays on its bucketed day (no instant push across midnight)', () => {
    // 23:30 -04:00 on June 1. The literal stays June 1 / 11:30. The buggy UTC
    // reinterpretation is 2026-06-02T03:30Z -> shows 3:30 while the row is bucketed
    // under June 1 — an internally INCONSISTENT display, which is the bug.
    renderCalendar({
      today: { year: 2026, month: 5, day: 1 }, // June 1 2026
      feed: {
        events: [
          mkEvent({ id: 'tz-late', title: 'Late thing', date: '2026-06-01T23:30:00.000-04:00' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const agenda = screen.getByTestId('agenda');
    expect(
      within(agenda).getByText('Late thing'),
      '23:30 must bucket on its literal day (June 1)',
    ).toBeInTheDocument();
    expect(
      within(agenda).getByText(/\b11:30\b/),
      'displayed time must be the literal 11:30 PM, consistent with the June-1 bucket',
    ).toBeInTheDocument();
    expect(within(agenda).queryByText(/\b3:30\b/)).not.toBeInTheDocument();
  });
});

describe('CalendarScreen — a category dot pairs with a text/AT label (WCAG 1.4.1, no colour alone)', () => {
  it('each agenda event states its category as TEXT (not colour alone)', () => {
    renderCalendar({
      feed: {
        events: [mkEvent({ id: 'e1', title: 'Recital', date: '2026-05-27T17:30:00.000Z', tag: 'school' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    const agenda = screen.getByTestId('agenda');
    expect(
      within(agenda).getByText(/school/i),
      'category must be conveyed in text, never colour alone',
    ).toBeInTheDocument();
  });
});

describe('CalendarScreen — grid semantics (Finding E: labelled LIST, not a bare role=grid)', () => {
  // DESIGN DECISION (pin ONE): the month days are a labelled LIST — a `role="list"`
  // (or <ul>) whose day cells are listitems-as-buttons. A bare `role="grid"`
  // without `row`/`gridcell` children is an INCOMPLETE grid that misleads AT, so
  // it must be removed. (This REPLACES the prior half-implemented role=grid
  // expectation — see header comment: the old structure asserted role=grid.)
  it('exposes the month days as a labelled list (role=list / <ul> with listitems), NOT a bare grid', () => {
    renderCalendar();
    const list = screen.getByRole('list', { name: /month|may 2026|calendar/i });
    expect(list, 'the month days must be a labelled list region').toBeInTheDocument();
    // Each in-month/out cell is a listitem.
    const items = within(list).getAllByRole('listitem');
    expect(items.length, 'all 42 day cells are listitems').toBe(42);
  });

  it('does NOT expose a bare role="grid" without row/gridcell children (incomplete grid removed)', () => {
    renderCalendar();
    const grids = screen.queryAllByRole('grid');
    for (const grid of grids) {
      // If a grid IS present it must be a COMPLETE grid (have rows). A bare grid
      // with zero rows is the half-implemented structure we are removing.
      const rows = within(grid).queryAllByRole('row');
      expect(
        rows.length,
        'a role=grid must contain rows (complete grid) — a bare grid is not allowed',
      ).toBeGreaterThan(0);
    }
  });
});

describe('CalendarScreen — month change is announced via a dedicated polite status region (Finding E)', () => {
  it('a dedicated visually-hidden status region announces the displayed "Month YYYY"', () => {
    renderCalendar();
    const status = screen.getByTestId('month-status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent(/May\s*2026/);
  });

  it('the month HEADING is NOT itself an aria-live region (announce via the status region, not the heading)', () => {
    renderCalendar();
    const heading = screen.getByRole('heading', { name: /May\s*2026/i });
    expect(
      heading.getAttribute('aria-live'),
      'the heading must not carry aria-live; a dedicated status region does the announcing',
    ).toBeNull();
  });

  it('clicking Next updates the status region text to the new month (announced)', () => {
    renderCalendar();
    fireEvent.click(screen.getByRole('button', { name: /next month/i }));
    const status = screen.getByTestId('month-status');
    expect(status, 'the status region must announce the new month after Next').toHaveTextContent(
      /June\s*2026/,
    );
  });
});

describe('CalendarScreen — day-cell accessibility (Finding E: full-date name, selected exposed, tap size)', () => {
  it("a day cell's accessible name includes the full date (month + year), not just the day number", () => {
    renderCalendar();
    const today = screen
      .getAllByTestId('calendar-day')
      .find((el) => el.getAttribute('aria-current') === 'date')!;
    const name = today.getAttribute('aria-label') ?? '';
    expect(name, 'day name must include the month').toMatch(/May/i);
    expect(name, 'day name must include the year').toMatch(/2026/);
    expect(name, 'day name must include the day number').toMatch(/\b27\b/);
  });

  it('the SELECTED day (whose agenda is shown) is exposed to AT via aria-pressed', () => {
    renderCalendar();
    // Today is selected by default.
    const pressed = screen
      .getAllByTestId('calendar-day')
      .filter((el) => el.getAttribute('aria-pressed') === 'true');
    expect(pressed, 'exactly one day cell is aria-pressed (the selected day)').toHaveLength(1);
    expect(pressed[0]!).toHaveTextContent('27');
  });

  it('selecting a different day moves aria-pressed to that day', () => {
    renderCalendar();
    const cell15 = screen
      .getAllByTestId('calendar-day')
      .find((el) => within(el).queryByText('15') && el.getAttribute('data-in-month') === 'true')!;
    fireEvent.click(cell15);
    expect(cell15.getAttribute('aria-pressed'), 'the clicked day becomes the selected day').toBe(
      'true',
    );
  });

  it('today keeps aria-current="date"', () => {
    renderCalendar();
    const current = screen
      .getAllByTestId('calendar-day')
      .filter((el) => el.getAttribute('aria-current') === 'date');
    expect(current).toHaveLength(1);
  });

  it('each day-cell button carries the min-w-tap (44px target) class for the 320px target-size', () => {
    renderCalendar();
    const cells = screen.getAllByTestId('calendar-day');
    for (const cell of cells) {
      expect(
        cell.className,
        'day cells must meet the 44px tap target (min-w-tap) at 320px width',
      ).toMatch(/min-w-tap/);
    }
  });
});

describe('CalendarScreen — recurring events: delete-scope and series-edit flows (ADR-0012 follow-up)', () => {
  // A recurring occurrence carries a `recurrenceGroupId`; the screen detects
  // that and surfaces a 3-option scope dialog on delete + a dedicated
  // "Edit series" affordance.
  const groupId = 'g-1';
  function mkRecurring(over: Partial<EventWithId> & { id: string }): EventWithId {
    return mkEvent({
      title: 'Tuesday practice',
      recurrenceFrequency: 'weekly',
      recurrenceCount: 8,
      recurrenceGroupId: groupId,
      ...over,
    });
  }

  it('clicking delete on a ONE-OFF event deletes directly (no scope dialog)', async () => {
    const onDeleteEvent = vi.fn().mockResolvedValue(undefined);
    const onDeleteEventSeries = vi.fn().mockResolvedValue(undefined);
    renderCalendar({
      feed: {
        events: [mkEvent({ id: 'e-one' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
      onDeleteEvent,
      onDeleteEventSeries,
    });
    fireEvent.click(screen.getByRole('button', { name: /delete soccer practice/i }));
    await waitFor(() => expect(onDeleteEvent).toHaveBeenCalledWith('e-one'));
    expect(onDeleteEventSeries).not.toHaveBeenCalled();
    // No scope dialog is opened.
    expect(screen.queryByText(/how much of/i)).not.toBeInTheDocument();
  });

  it('clicking delete on a RECURRING event opens the 3-option scope dialog (no delete yet)', () => {
    const onDeleteEvent = vi.fn().mockResolvedValue(undefined);
    const onDeleteEventSeries = vi.fn().mockResolvedValue(undefined);
    renderCalendar({
      feed: {
        events: [mkRecurring({ id: 'r1' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
      onDeleteEvent,
      onDeleteEventSeries,
    });
    fireEvent.click(screen.getByRole('button', { name: /delete tuesday practice/i }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/delete recurring event/i);
    expect(screen.getByRole('button', { name: /only this occurrence/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /this and all future occurrences/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete the whole series/i })).toBeInTheDocument();
    expect(onDeleteEvent).not.toHaveBeenCalled();
    expect(onDeleteEventSeries).not.toHaveBeenCalled();
  });

  it('"Only this occurrence" calls onDeleteEvent(id) and toasts', async () => {
    const onDeleteEvent = vi.fn().mockResolvedValue(undefined);
    const onDeleteEventSeries = vi.fn().mockResolvedValue(undefined);
    renderCalendar({
      feed: {
        events: [mkRecurring({ id: 'r1' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
      onDeleteEvent,
      onDeleteEventSeries,
    });
    fireEvent.click(screen.getByRole('button', { name: /delete tuesday practice/i }));
    fireEvent.click(screen.getByRole('button', { name: /only this occurrence/i }));
    await waitFor(() => expect(onDeleteEvent).toHaveBeenCalledWith('r1'));
    expect(onDeleteEventSeries).not.toHaveBeenCalled();
    expect(await screen.findByText(EVENT_DELETE_SUCCESS)).toBeInTheDocument();
  });

  it('"This and all future" calls onDeleteEventSeries(familyId, groupId, fromDate=event.date)', async () => {
    const onDeleteEventSeries = vi.fn().mockResolvedValue(undefined);
    renderCalendar({
      feed: {
        events: [mkRecurring({ id: 'r1', date: '2026-05-27T17:30:00.000Z' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
      onDeleteEventSeries,
    });
    fireEvent.click(screen.getByRole('button', { name: /delete tuesday practice/i }));
    fireEvent.click(screen.getByRole('button', { name: /this and all future occurrences/i }));
    await waitFor(() =>
      expect(onDeleteEventSeries).toHaveBeenCalledWith(
        'fam-A',
        groupId,
        '2026-05-27T17:30:00.000Z',
      ),
    );
  });

  it('"Whole series" calls onDeleteEventSeries(familyId, groupId) with NO fromDate', async () => {
    const onDeleteEventSeries = vi.fn().mockResolvedValue(undefined);
    renderCalendar({
      feed: {
        events: [mkRecurring({ id: 'r1' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
      onDeleteEventSeries,
    });
    fireEvent.click(screen.getByRole('button', { name: /delete tuesday practice/i }));
    fireEvent.click(screen.getByRole('button', { name: /delete the whole series/i }));
    await waitFor(() =>
      expect(onDeleteEventSeries).toHaveBeenCalledWith('fam-A', groupId, undefined),
    );
  });

  it('"Cancel" closes the dialog without calling either delete handler', () => {
    const onDeleteEvent = vi.fn().mockResolvedValue(undefined);
    const onDeleteEventSeries = vi.fn().mockResolvedValue(undefined);
    renderCalendar({
      feed: {
        events: [mkRecurring({ id: 'r1' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
      onDeleteEvent,
      onDeleteEventSeries,
    });
    fireEvent.click(screen.getByRole('button', { name: /delete tuesday practice/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Cancel$/i })[0]!);
    expect(screen.queryByText(/how much of/i)).not.toBeInTheDocument();
    expect(onDeleteEvent).not.toHaveBeenCalled();
    expect(onDeleteEventSeries).not.toHaveBeenCalled();
  });

  it('recurring rows expose an "Edit series" affordance; one-off rows do NOT', () => {
    renderCalendar({
      feed: {
        events: [
          mkRecurring({ id: 'r1', title: 'Recurring one' }),
          mkEvent({ id: 'one-off', title: 'One-off thing' }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    expect(
      screen.getByRole('button', { name: /edit the whole series for recurring one/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /edit the whole series for one-off thing/i }),
    ).not.toBeInTheDocument();
  });

  it('"Edit series" opens a sheet seeded with the event title / description / tag', () => {
    renderCalendar({
      feed: {
        events: [
          mkRecurring({
            id: 'r1',
            title: 'Tuesday practice',
            description: 'Bring shin guards',
            tag: 'sports',
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /edit the whole series for tuesday/i }));
    const sheet = screen.getByRole('dialog', { name: /edit the series/i });
    expect(within(sheet).getByDisplayValue('Tuesday practice')).toBeInTheDocument();
    expect(within(sheet).getByDisplayValue('Bring shin guards')).toBeInTheDocument();
  });

  it('submitting Edit series with "This and all future" calls onUpdateEventSeries with fromDate', async () => {
    const onUpdateEventSeries = vi.fn().mockResolvedValue(undefined);
    renderCalendar({
      feed: {
        events: [
          mkRecurring({
            id: 'r1',
            title: 'Tuesday practice',
            description: 'old desc',
            date: '2026-05-27T17:30:00.000Z',
            tag: 'sports',
          }),
        ],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
      onUpdateEventSeries,
    });
    fireEvent.click(screen.getByRole('button', { name: /edit the whole series/i }));
    const sheet = screen.getByRole('dialog', { name: /edit the series/i });
    fireEvent.change(within(sheet).getByDisplayValue('Tuesday practice'), {
      target: { value: 'Thursday practice' },
    });
    // Default scope is "This and all future"; keep it and submit.
    fireEvent.click(within(sheet).getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(onUpdateEventSeries).toHaveBeenCalledWith(
        'fam-A',
        groupId,
        { title: 'Thursday practice', description: 'old desc', tag: 'sports' },
        '2026-05-27T17:30:00.000Z',
      ),
    );
  });

  it('switching to "Whole series" submits with NO fromDate', async () => {
    const onUpdateEventSeries = vi.fn().mockResolvedValue(undefined);
    renderCalendar({
      feed: {
        events: [mkRecurring({ id: 'r1' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
      onUpdateEventSeries,
    });
    fireEvent.click(screen.getByRole('button', { name: /edit the whole series/i }));
    const sheet = screen.getByRole('dialog', { name: /edit the series/i });
    fireEvent.click(within(sheet).getByRole('radio', { name: /the whole series/i }));
    fireEvent.click(within(sheet).getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(onUpdateEventSeries).toHaveBeenCalledWith(
        'fam-A',
        groupId,
        expect.any(Object),
        undefined,
      ),
    );
  });

  it('REJECTS an empty title in Edit series (inline error; no dispatch)', async () => {
    const onUpdateEventSeries = vi.fn().mockResolvedValue(undefined);
    renderCalendar({
      feed: {
        events: [mkRecurring({ id: 'r1', title: 'Tuesday practice' })],
        loading: false,
        error: null,
        refresh: vi.fn(),
      },
      onUpdateEventSeries,
    });
    fireEvent.click(screen.getByRole('button', { name: /edit the whole series/i }));
    const sheet = screen.getByRole('dialog', { name: /edit the series/i });
    fireEvent.change(within(sheet).getByDisplayValue('Tuesday practice'), {
      target: { value: '   ' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: /save changes/i }));
    expect(await within(sheet).findByText(/please give the event a name/i)).toBeInTheDocument();
    expect(onUpdateEventSeries).not.toHaveBeenCalled();
  });
});
