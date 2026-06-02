/**
 * Dashboard pure selectors (Phase 4, Dashboard feature).
 *
 * These selectors isolate the two pieces of logic worth unit-testing apart from
 * the screen: the TIMEZONE-sensitive "upcoming events" filter (an event dated
 * the LOCAL today must not be dropped as past — lesson F4) and the generic
 * cap-at-N / stable-order helpers shared by every section.
 *
 * All selectors are PURE: no clock read, no side effects. The reference "now"
 * is always passed in (`nowMs`), never read from `Date.now()` inside. The
 * local-day reductions (`localDayKey` / `eventLocalDay`) come from the shared
 * `src/lib/dates.ts` so the same basis is used on BOTH sides of every day
 * comparison (lesson 2026-05-28).
 */
import { eventLocalDay, localDayKey } from '../../lib/dates';
import type { ChoreWithId } from '../chores/choresMemberService';
import type { EventWithId } from '../calendar/calendarService';

/**
 * Keep only events whose `date` falls on the LOCAL calendar day of `nowMs` OR
 * later (a future event), sorted soonest-first, capped at `limit`. Stable: ties
 * preserve input order. Malformed / empty dates are DROPPED (F2). Does not
 * mutate the input.
 */
export function selectUpcomingEvents(
  events: EventWithId[],
  nowMs: number,
  limit: number,
): EventWithId[] {
  const todayKey = localDayKey(nowMs);
  return events
    .map((event, index) => ({ event, index, day: eventLocalDay(event.date) }))
    .filter((entry): entry is typeof entry & { day: { key: string; instant: number } } => {
      // Drop malformed/empty dates (day === null) and anything before today.
      return entry.day !== null && entry.day.key >= todayKey;
    })
    .sort((a, b) => {
      const byInstant = a.day.instant - b.day.instant;
      return byInstant !== 0 ? byInstant : a.index - b.index;
    })
    .slice(0, limit)
    .map(({ event }) => event);
}

/**
 * Newest-first, capped at `limit`. Sorts by `createdAt` (ms) descending; ties
 * preserve input order. Does not mutate the input.
 */
export function selectRecent<T extends { createdAt: number }>(items: T[], limit: number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const byCreated = b.item.createdAt - a.item.createdAt;
      return byCreated !== 0 ? byCreated : a.index - b.index;
    })
    .slice(0, limit)
    .map(({ item }) => item);
}

/**
 * Soonest-`dueDate`-first (ISO ascending), capped at `limit`; ties preserve
 * input order. Does NOT filter by status — the caller decides what to feed in.
 * Does not mutate the input.
 */
export function selectSoonestChores(chores: ChoreWithId[], limit: number): ChoreWithId[] {
  // A parseable ISO `YYYY-MM-DD`(...) due date is a real sort key; a missing /
  // non-string / unparseable one is `null` and sorts LAST (after all real dates),
  // never throwing on `.localeCompare` (F5).
  const dueKey = (value: unknown): string | null => {
    if (typeof value !== 'string' || value === '') return null;
    return Number.isNaN(new Date(value).getTime()) ? null : value;
  };
  return chores
    .map((chore, index) => ({ chore, index, due: dueKey(chore.dueDate) }))
    .sort((a, b) => {
      if (a.due !== null && b.due !== null) {
        const byDue = a.due.localeCompare(b.due);
        return byDue !== 0 ? byDue : a.index - b.index;
      }
      // Malformed dates sort after parseable ones; ties stay stable.
      if (a.due === null && b.due === null) return a.index - b.index;
      return a.due === null ? 1 : -1;
    })
    .slice(0, limit)
    .map(({ chore }) => chore);
}

/**
 * Group upcoming events by urgency relative to the LOCAL calendar day of
 * `nowMs`:
 *   - today      → event.date matches localDayKey(nowMs)
 *   - tomorrow   → event.date matches localDayKey(nowMs + 24h)
 *   - thisWeek   → event.date in (today+2 .. today+7]
 *
 * Past + malformed-date events are dropped (F2). Each bucket is sorted
 * soonest-first; ties preserve input order. Useful for the dashboard's
 * Today / Tomorrow / This Week reminders widget so the urgency cue is in
 * the grouping itself, not just a date label.
 */
export function bucketUpcomingEvents(
  events: EventWithId[],
  nowMs: number,
): {
  today: EventWithId[];
  tomorrow: EventWithId[];
  thisWeek: EventWithId[];
  later: EventWithId[];
} {
  const todayKey = localDayKey(nowMs);
  const tomorrowKey = localDayKey(nowMs + 24 * 60 * 60 * 1000);
  // Boundary for "this week" — anything up to and INCLUDING today + 7 days
  // (so an event a full week out still surfaces as a reminder).
  const sevenDaysOutKey = localDayKey(nowMs + 7 * 24 * 60 * 60 * 1000);

  const today: EventWithId[] = [];
  const tomorrow: EventWithId[] = [];
  const thisWeek: EventWithId[] = [];
  const later: EventWithId[] = [];

  events
    .map((event, index) => ({ event, index, day: eventLocalDay(event.date) }))
    .filter((entry): entry is typeof entry & { day: { key: string; instant: number } } => {
      return entry.day !== null && entry.day.key >= todayKey;
    })
    .sort((a, b) => {
      const byInstant = a.day.instant - b.day.instant;
      return byInstant !== 0 ? byInstant : a.index - b.index;
    })
    .forEach(({ event, day }) => {
      if (day.key === todayKey) {
        today.push(event);
      } else if (day.key === tomorrowKey) {
        tomorrow.push(event);
      } else if (day.key <= sevenDaysOutKey) {
        thisWeek.push(event);
      } else {
        // Beyond 7 days: still sorted ascending, available to surfaces
        // that want a long list (calendar). The dashboard reminders
        // widget intentionally ignores this bucket — it focuses on the
        // actionable window.
        later.push(event);
      }
    });

  return { today, tomorrow, thisWeek, later };
}
