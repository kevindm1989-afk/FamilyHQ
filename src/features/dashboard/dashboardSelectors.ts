/**
 * Dashboard pure selectors (Phase 4, Dashboard feature).
 *
 * These selectors isolate the two pieces of logic worth unit-testing apart from
 * the screen: the TIMEZONE-sensitive "upcoming events" filter (an event dated
 * the LOCAL today must not be dropped as past — lesson F4), and the generic
 * cap-at-N / stable-order helpers shared by every section.
 *
 * All selectors are PURE: no clock read, no side effects. The reference "now"
 * is always passed in (`nowMs`), never read from `Date.now()` inside.
 */
import type { ChoreWithId } from '../chores/choresMemberService';
import type { EventWithId } from '../calendar/calendarService';

/**
 * Map a `nowMs` instant to the LOCAL calendar day as a comparable `YYYY-MM-DD`
 * string. Using local date PARTS (not `toISOString`, which is UTC) is what makes
 * an event dated the local today survive even after UTC has rolled to tomorrow
 * (lesson F4).
 */
function localDayKey(ms: number): string {
  const d = new Date(ms);
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Resolve an event `date` to the SAME local-day basis as `nowMs` (F1/F2).
 *
 * Returns `{ key, instant }` where `key` is the event's LOCAL `YYYY-MM-DD` and
 * `instant` is the parsed epoch ms (used for soonest-first ordering). Returns
 * `null` for an empty or unparseable date so the event is DROPPED (F2).
 *
 * A bare `YYYY-MM-DD` (date-only) is treated as a LOCAL calendar day — parsed
 * via the date PARTS, not `new Date('2026-06-15')` (which is UTC-midnight and
 * shifts a day back in a UTC-behind zone). A time-bearing / offset-bearing ISO
 * datetime is parsed to an instant, then reduced to its LOCAL day via
 * `getFullYear/getMonth/getDate` — the same parts `localDayKey` uses for `now`.
 */
function eventLocalDay(iso: string): { key: string; instant: number } | null {
  if (typeof iso !== 'string' || iso === '') return null;

  // Date-only `YYYY-MM-DD`: interpret as a LOCAL calendar day directly.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    const local = new Date(year, month - 1, day);
    if (Number.isNaN(local.getTime())) return null;
    return { key: localDayKey(local.getTime()), instant: local.getTime() };
  }

  // Time-bearing / offset-bearing ISO datetime: parse to an instant, then take
  // the LOCAL day parts (same basis as `now`).
  const instant = new Date(iso).getTime();
  if (Number.isNaN(instant)) return null;
  return { key: localDayKey(instant), instant };
}

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
