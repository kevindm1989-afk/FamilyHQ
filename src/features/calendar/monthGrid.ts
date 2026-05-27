/**
 * Pure month-grid + agenda helpers (Phase 3, Task 13; handoff #03 CalendarScreen).
 *
 * Clock-free: callers pass the "today" reference and the month explicitly so the
 * grid is deterministic at any wall-clock time (23:59, Feb 29, a DST boundary).
 *
 * DATE MATH — TIMEZONE FOOTGUN AVOIDANCE: the grid is built from DATE-ONLY
 * fields (year, month, day) using a fixed calendar, NOT from `Date` arithmetic
 * across instants — so a DST transition (which shifts the number of hours in a
 * day) can never drop or duplicate a calendar day. Likewise the agenda filter
 * compares an event's LOCAL calendar day (its `date` string's Y-M-D) to the
 * selected day's Y-M-D, never an epoch-millis subtraction that a timezone
 * offset could push across midnight.
 */
import type { EventWithId } from './calendarService';

/** A single cell in the 6x7 month grid. */
export interface GridDay {
  /** Calendar year of this cell (may belong to the prev/next month). */
  year: number;
  /** 0-based month (0 = January) of this cell. */
  month: number;
  /** Day-of-month number shown in the cell (1..31). */
  day: number;
  /** True when this cell belongs to the displayed month (not a leading/trailing fill day). */
  inMonth: boolean;
  /** True when this cell is "today" relative to the passed reference. */
  isToday: boolean;
}

/** A Y/M/D reference, 0-based month — passed explicitly so nothing reads the clock. */
export interface YearMonthDay {
  year: number;
  month: number; // 0-based
  day: number;
}

const WEEKS = 6;
const DAYS_PER_WEEK = 7;

/** Days in a 0-based month, leap-aware. Pure arithmetic — no Date instants. */
function daysInMonth(year: number, month: number): number {
  // February: 29 in a leap year, else 28. Leap year = divisible by 4, not by
  // 100 unless also by 400.
  if (month === 1) {
    const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return isLeap ? 29 : 28;
  }
  // 0:31 1:- 2:31 3:30 4:31 5:30 6:31 7:31 8:30 9:31 10:30 11:31
  return [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month]!;
}

/** Day-of-week (0=Sunday) of the 1st of a 0-based month. Uses UTC so the result
 * is purely a function of the calendar date, never the local timezone. */
function firstWeekday(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 1)).getUTCDay();
}

/** Step a (year, 0-based month) pair by one month, wrapping the year. */
function prevMonth(year: number, month: number): { year: number; month: number } {
  return month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
}
function nextMonth(year: number, month: number): { year: number; month: number } {
  return month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 };
}

/**
 * Build the 6x7 (42-cell) month grid for the given 0-based month, with leading
 * days from the previous month and trailing days from the next so weeks are
 * whole. Weeks start on SUNDAY (handoff S M T W T F S strip). `today` flags the
 * matching cell. Returns exactly 6 weeks of 7 days (42 cells).
 */
export function buildMonthGrid(year: number, month: number, today: YearMonthDay): GridDay[][] {
  const leading = firstWeekday(year, month); // count of prev-month fill cells
  const inMonthCount = daysInMonth(year, month);

  const prev = prevMonth(year, month);
  const prevDays = daysInMonth(prev.year, prev.month);
  const next = nextMonth(year, month);

  const cells: GridDay[] = [];
  const total = WEEKS * DAYS_PER_WEEK;

  for (let i = 0; i < total; i += 1) {
    // dayOffset: 0-based position within the displayed month (negative for the
    // leading fill, >= inMonthCount for the trailing fill).
    const dayOffset = i - leading;
    let cellYear: number;
    let cellMonth: number;
    let cellDay: number;
    let inMonth: boolean;

    if (dayOffset < 0) {
      cellYear = prev.year;
      cellMonth = prev.month;
      cellDay = prevDays + dayOffset + 1; // dayOffset is negative
      inMonth = false;
    } else if (dayOffset < inMonthCount) {
      cellYear = year;
      cellMonth = month;
      cellDay = dayOffset + 1;
      inMonth = true;
    } else {
      cellYear = next.year;
      cellMonth = next.month;
      cellDay = dayOffset - inMonthCount + 1;
      inMonth = false;
    }

    // Today highlights ONLY the in-month cell that matches the reference — never
    // a leading/trailing fill cell that merely shares the day number.
    const isToday =
      inMonth && cellYear === today.year && cellMonth === today.month && cellDay === today.day;

    cells.push({ year: cellYear, month: cellMonth, day: cellDay, inMonth, isToday });
  }

  const grid: GridDay[][] = [];
  for (let w = 0; w < WEEKS; w += 1) {
    grid.push(cells.slice(w * DAYS_PER_WEEK, w * DAYS_PER_WEEK + DAYS_PER_WEEK));
  }
  return grid;
}

/** Parse the calendar Y-M-D and the minutes-of-day from an ISO datetime string
 * WITHOUT crossing instants: the leading `YYYY-MM-DDTHH:MM` is read literally so
 * a timezone offset can never shift the calendar day. */
function calendarParts(iso: string): {
  year: number;
  month: number; // 0-based
  day: number;
  minutes: number; // minutes since midnight, for ordering
} {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return { year: NaN, month: NaN, day: NaN, minutes: 0 };
  const hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  return {
    year: Number(m[1]),
    month: Number(m[2]) - 1,
    day: Number(m[3]),
    minutes: hour * 60 + minute,
  };
}

/**
 * Filter events to those occurring on the given calendar day, using the event
 * `date` string's local Y-M-D (never an epoch subtraction). Returns them sorted
 * by time-of-day ascending (earliest first) for the agenda list. Pure — never
 * mutates the input array.
 */
export function eventsForDay(events: ReadonlyArray<EventWithId>, day: YearMonthDay): EventWithId[] {
  return events
    .map((event) => ({ event, parts: calendarParts(event.date) }))
    .filter(
      ({ parts }) => parts.year === day.year && parts.month === day.month && parts.day === day.day,
    )
    .sort((a, b) => a.parts.minutes - b.parts.minutes)
    .map(({ event }) => event);
}
