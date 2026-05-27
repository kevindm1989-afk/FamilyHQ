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
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(EVENT_DELETE_SUCCESS),
    );
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
