/**
 * Pure month-grid + agenda helpers — CONTRACT STUB (Phase 3, Task 13; handoff
 * #03 CalendarScreen).
 *
 * Signatures only — NO logic. These are PURE, clock-free functions: callers
 * pass the "today" reference and the month explicitly so the grid is
 * deterministic at any wall-clock time (23:59, Feb 29, a DST boundary).
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

/**
 * Build the 6x7 (42-cell) month grid for the given 0-based month, with leading
 * days from the previous month and trailing days from the next so weeks are
 * whole. Weeks start on SUNDAY (handoff S M T W T F S strip). `today` flags the
 * matching cell. Returns exactly 6 weeks of 7 days (42 cells).
 */
export declare function buildMonthGrid(
  year: number,
  month: number, // 0-based
  today: YearMonthDay,
): GridDay[][];

/**
 * Filter events to those occurring on the given calendar day, using the event
 * `date` string's local Y-M-D (never an epoch subtraction). Returns them sorted
 * by time-of-day ascending (earliest first) for the agenda list.
 */
export declare function eventsForDay(
  events: ReadonlyArray<EventWithId>,
  day: YearMonthDay,
): EventWithId[];
