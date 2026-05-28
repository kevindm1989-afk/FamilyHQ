/**
 * Dashboard pure selectors (Phase 4, Dashboard feature).
 *
 * SIGNATURES ONLY. The test-writer authors this file to PIN the shapes the
 * implementer must fulfill (the unit tests import these). The implementer
 * replaces each `throw new Error('not implemented')` body with the real logic;
 * the implementer MUST NOT change these signatures without updating the tests.
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
 * Keep only events whose `date` (an ISO string) falls on the LOCAL calendar day
 * of `nowMs` OR later (a future event), sorted soonest-first, capped at `limit`.
 *
 * TZ contract (lesson F4): "today or later" is judged in the machine's LOCAL
 * timezone, not UTC — an event dated the local today is KEPT (not dropped as
 * past), and the UTC-vs-local boundary buckets by the local day. Stable: ties
 * preserve input order.
 *
 * SIGNATURE ONLY — implementer fills the body.
 */
export function selectUpcomingEvents(
  _events: EventWithId[],
  _nowMs: number,
  _limit: number,
): EventWithId[] {
  throw new Error('not implemented');
}

/**
 * Newest-first, capped at `limit`. Sorts by `createdAt` (ms) descending; ties
 * preserve input order. Generic over any item carrying a numeric `createdAt`
 * (posts, transactions).
 *
 * SIGNATURE ONLY — implementer fills the body.
 */
export function selectRecent<T extends { createdAt: number }>(_items: T[], _limit: number): T[] {
  throw new Error('not implemented');
}

/**
 * Soonest-`dueDate`-first (ISO ascending), capped at `limit`; ties preserve
 * input order. Does NOT filter by status — the caller decides what to feed in.
 *
 * SIGNATURE ONLY — implementer fills the body.
 */
export function selectSoonestChores(_chores: ChoreWithId[], _limit: number): ChoreWithId[] {
  throw new Error('not implemented');
}
