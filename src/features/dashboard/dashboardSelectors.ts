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
 * The leading `YYYY-MM-DD` of an ISO date string, for lexicographic comparison
 * against the local-day key (ISO dates sort correctly as strings).
 */
function eventDayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * Keep only events whose `date` (an ISO string) falls on the LOCAL calendar day
 * of `nowMs` OR later (a future event), sorted soonest-first, capped at `limit`.
 * Stable: ties preserve input order. Does not mutate the input.
 */
export function selectUpcomingEvents(
  events: EventWithId[],
  nowMs: number,
  limit: number,
): EventWithId[] {
  const todayKey = localDayKey(nowMs);
  return events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => eventDayKey(event.date) >= todayKey)
    .sort((a, b) => {
      const byDate = eventDayKey(a.event.date).localeCompare(eventDayKey(b.event.date));
      return byDate !== 0 ? byDate : a.index - b.index;
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
  return chores
    .map((chore, index) => ({ chore, index }))
    .sort((a, b) => {
      const byDue = a.chore.dueDate.localeCompare(b.chore.dueDate);
      return byDue !== 0 ? byDue : a.index - b.index;
    })
    .slice(0, limit)
    .map(({ chore }) => chore);
}
