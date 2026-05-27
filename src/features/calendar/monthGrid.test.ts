/**
 * Month-grid + agenda helpers — pure unit tests (Task 13; handoff #03
 * CalendarScreen).
 *
 * Level: pure unit. NO clock, NO network, NO RNG — every function takes its
 * inputs explicitly (the "today" reference and the month). That is what makes
 * the grid deterministic at any wall-clock time. Edge cases: a month that
 * starts on Sunday (no leading fill), a leap-year February, a non-leap
 * February, a DST-transition month (must not drop/duplicate a calendar day),
 * and the agenda day filter (calendar-day match, never an epoch subtraction).
 *
 * FAILS today: monthGrid.ts is a declare-only contract stub.
 */
import { describe, expect, it } from 'vitest';
import { buildMonthGrid, eventsForDay, type GridDay } from './monthGrid';
import type { EventWithId } from './calendarService';

function flat(grid: GridDay[][]): GridDay[] {
  return grid.flat();
}

const NO_TODAY = { year: 1900, month: 0, day: 1 }; // a reference that matches no test month

describe('buildMonthGrid — structure (always 6 weeks of 7 days)', () => {
  it('returns exactly 6 weeks', () => {
    const grid = buildMonthGrid(2026, 4, NO_TODAY); // May 2026
    expect(grid).toHaveLength(6);
  });

  it('every week has exactly 7 days (42 cells total)', () => {
    const grid = buildMonthGrid(2026, 4, NO_TODAY);
    for (const week of grid) expect(week).toHaveLength(7);
    expect(flat(grid)).toHaveLength(42);
  });

  it('the first cell of every week is a SUNDAY-anchored column (weeks start Sunday)', () => {
    // May 1 2026 is a Friday; the first row must begin on the preceding Sunday
    // (Apr 26 2026). We assert the first cell is the expected leading day.
    const grid = buildMonthGrid(2026, 4, NO_TODAY);
    const first = grid[0]![0]!;
    expect({ year: first.year, month: first.month, day: first.day }).toEqual({
      year: 2026,
      month: 3, // April (0-based)
      day: 26,
    });
    expect(first.inMonth).toBe(false);
  });
});

describe('buildMonthGrid — leading + trailing fill days', () => {
  it('flags days from the previous month as NOT in the displayed month', () => {
    // May 2026 starts Friday -> 5 leading April cells (Sun..Thu).
    const grid = buildMonthGrid(2026, 4, NO_TODAY);
    const leading = flat(grid).filter((d) => d.month === 3); // April
    expect(leading).toHaveLength(5);
    for (const d of leading) expect(d.inMonth).toBe(false);
  });

  it('flags the displayed month’s own days as in-month with the right count (May has 31)', () => {
    const grid = buildMonthGrid(2026, 4, NO_TODAY);
    const inMonth = flat(grid).filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth.every((d) => d.month === 4 && d.year === 2026)).toBe(true);
    expect(inMonth[0]!.day).toBe(1);
    expect(inMonth[inMonth.length - 1]!.day).toBe(31);
  });

  it('flags trailing days from the next month as NOT in the displayed month', () => {
    const grid = buildMonthGrid(2026, 4, NO_TODAY);
    const trailing = flat(grid).filter((d) => d.month === 5); // June
    // 42 cells - 5 leading - 31 in-month = 6 trailing.
    expect(trailing).toHaveLength(6);
    for (const d of trailing) expect(d.inMonth).toBe(false);
    expect(trailing[0]!.day).toBe(1);
  });
});

describe('buildMonthGrid — month that starts on Sunday (no leading fill)', () => {
  it('has zero leading days when day 1 falls on Sunday', () => {
    // February 2026: Feb 1 2026 is a Sunday.
    const grid = buildMonthGrid(2026, 1, NO_TODAY);
    expect(grid[0]![0]!.inMonth, 'first cell should be Feb 1 (in-month) — no leading fill').toBe(
      true,
    );
    expect(grid[0]![0]!.day).toBe(1);
    expect(grid[0]![0]!.month).toBe(1);
  });
});

describe('buildMonthGrid — leap / non-leap February (DST-safe date math)', () => {
  it('a LEAP February has 29 in-month days (Feb 2028)', () => {
    const grid = buildMonthGrid(2028, 1, NO_TODAY);
    const inMonth = flat(grid).filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth[inMonth.length - 1]!.day).toBe(29);
  });

  it('a NON-leap February has 28 in-month days (Feb 2026)', () => {
    const grid = buildMonthGrid(2026, 1, NO_TODAY);
    const inMonth = flat(grid).filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(inMonth[inMonth.length - 1]!.day).toBe(28);
  });

  it('a month spanning a DST spring-forward boundary keeps every calendar day exactly once (no drop/dupe)', () => {
    // March 2026 (US DST begins Mar 8). Pure date-only math must yield 31
    // distinct in-month days regardless of the 23-hour DST day. An epoch-based
    // +24h loop would drop or duplicate Mar 8.
    const grid = buildMonthGrid(2026, 2, NO_TODAY);
    const inMonthDays = flat(grid)
      .filter((d) => d.inMonth)
      .map((d) => d.day);
    expect(inMonthDays).toHaveLength(31);
    expect(new Set(inMonthDays).size, 'every day appears exactly once').toBe(31);
    expect(inMonthDays).toContain(8); // the DST-transition day is present
  });
});

describe('buildMonthGrid — today flag', () => {
  it('flags exactly the matching in-month cell as today', () => {
    const grid = buildMonthGrid(2026, 4, { year: 2026, month: 4, day: 27 });
    const todays = flat(grid).filter((d) => d.isToday);
    expect(todays).toHaveLength(1);
    expect({ y: todays[0]!.year, m: todays[0]!.month, d: todays[0]!.day }).toEqual({
      y: 2026,
      m: 4,
      d: 27,
    });
  });

  it('flags NO cell as today when the reference month is not displayed', () => {
    const grid = buildMonthGrid(2026, 4, { year: 2025, month: 0, day: 1 });
    expect(flat(grid).some((d) => d.isToday)).toBe(false);
  });

  it('does NOT flag a trailing/leading fill cell that shares the day number with today', () => {
    // Today = Apr 26 2026 (a leading fill cell in the May grid). It must NOT be
    // flagged today in the May grid, because that cell belongs to April fill.
    const grid = buildMonthGrid(2026, 4, { year: 2026, month: 3, day: 26 });
    const leadingApr26 = flat(grid).find((d) => d.month === 3 && d.day === 26 && !d.inMonth);
    expect(leadingApr26, 'the Apr 26 leading cell exists').toBeDefined();
    // The grid is May; today (Apr 26) is not an in-month cell, so no in-month
    // cell is today — and we do not light up the fill cell either.
    expect(flat(grid).filter((d) => d.isToday)).toHaveLength(0);
  });
});

describe('eventsForDay — filters to a calendar day and sorts by time-of-day', () => {
  function mkEvent(over: Partial<EventWithId> & { id: string; date: string }): EventWithId {
    return {
      title: 'E',
      description: '',
      tag: 'family',
      familyId: 'fam-A',
      createdBy: 'uid-parent-a',
      createdAt: 1000,
      ...over,
    };
  }

  const events: EventWithId[] = [
    mkEvent({ id: 'morning', date: '2026-06-01T09:00:00.000Z' }),
    mkEvent({ id: 'evening', date: '2026-06-01T18:30:00.000Z' }),
    mkEvent({ id: 'noon', date: '2026-06-01T12:00:00.000Z' }),
    mkEvent({ id: 'next-day', date: '2026-06-02T08:00:00.000Z' }),
    mkEvent({ id: 'prev-day', date: '2026-05-31T23:00:00.000Z' }),
  ];

  it('returns only events on the selected calendar day', () => {
    const day = { year: 2026, month: 5, day: 1 }; // June 1
    const ids = eventsForDay(events, day).map((e) => e.id);
    expect(ids.sort()).toEqual(['evening', 'morning', 'noon'].sort());
    expect(ids).not.toContain('next-day');
    expect(ids).not.toContain('prev-day');
  });

  it('sorts the day’s events by time-of-day ascending (earliest first)', () => {
    const day = { year: 2026, month: 5, day: 1 };
    const ids = eventsForDay(events, day).map((e) => e.id);
    expect(ids).toEqual(['morning', 'noon', 'evening']);
  });

  it('returns an EMPTY array for a day with no events (empty-state input)', () => {
    const day = { year: 2026, month: 5, day: 15 };
    expect(eventsForDay(events, day)).toEqual([]);
  });

  it('does not mutate the input array (pure)', () => {
    const day = { year: 2026, month: 5, day: 1 };
    const snapshot = events.map((e) => e.id);
    eventsForDay(events, day);
    expect(events.map((e) => e.id)).toEqual(snapshot);
  });
});
