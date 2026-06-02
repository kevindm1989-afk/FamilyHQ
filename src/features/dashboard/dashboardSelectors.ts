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
import type { UserWithId } from '../../lib/types';

/** 7 days in ms — the weekly digest's "this week" window. */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * Weekly digest result (parent dashboard widget).
 *
 * All counts and money sums are computed from feeds the parent dashboard
 * already subscribes to (no new Firestore listener, satisfies the spec's
 * "Optimize query count"). "This week" is the 7-day window ending at
 * `nowMs`. The `topChorePerformerName` is derived from `assignedTo` →
 * `members[].name`; ties break by stable input order, and the name falls
 * back to `null` when the assignee is no longer in the active member
 * list (e.g. deactivated mid-week).
 *
 * KNOWN APPROXIMATION (v1, no `approvedAt` field on chores): "this week"
 * is matched against `chore.createdAt`, not the actual approval time. In
 * practice a chore that's created and approved within the same week
 * resolves correctly; long-lived chores created weeks earlier and
 * approved this week are NOT counted. A later iteration can add an
 * `approvedAt` field for exact accounting.
 */
export interface WeeklyDigest {
  choresApprovedThisWeek: number;
  pendingApprovals: number;
  /** Approved-this-week chore dollar values summed, in INTEGER CENTS. */
  allowanceEarnedCentsThisWeek: number;
  upcomingEvents7Days: number;
  /** `null` when no chores were approved this week (or no active member matched). */
  topChorePerformerName: string | null;
}

/**
 * Aggregate the parent dashboard's weekly digest from the chore + event
 * feeds the screen already has in hand. Pure: no clock read, no
 * side effects, no Firestore.
 */
export function dashboardWeeklyDigest(
  chores: ChoreWithId[],
  events: EventWithId[],
  members: UserWithId[],
  nowMs: number,
): WeeklyDigest {
  const weekStartMs = nowMs - SEVEN_DAYS_MS;
  const todayKey = localDayKey(nowMs);
  const sevenDaysOutKey = localDayKey(nowMs + SEVEN_DAYS_MS);

  let approved = 0;
  let pending = 0;
  let cents = 0;
  // Tally approved-this-week chores by assignee uid so we can pick the
  // top performer. Map preserves insertion order → ties go to whoever
  // hit their count first (stable).
  const perAssignee = new Map<string, number>();

  for (const chore of chores) {
    if (chore.status === 'complete') {
      pending += 1;
    }
    if (chore.status === 'approved') {
      // Approximation: `createdAt` proxies for approval time (see comment
      // on the interface). Drops chores whose createdAt isn't a finite
      // number (defensive — production data is finite by rules).
      if (typeof chore.createdAt === 'number' && chore.createdAt >= weekStartMs) {
        approved += 1;
        // dollarValue is INTEGER CENTS by rules; clamp non-finite
        // defensively so a corrupt cache doesn't produce NaN sums.
        if (Number.isFinite(chore.dollarValue) && chore.dollarValue >= 0) {
          cents += chore.dollarValue;
        }
        const current = perAssignee.get(chore.assignedTo) ?? 0;
        perAssignee.set(chore.assignedTo, current + 1);
      }
    }
  }

  let upcomingCount = 0;
  for (const event of events) {
    const day = eventLocalDay(event.date);
    if (day !== null && day.key >= todayKey && day.key <= sevenDaysOutKey) {
      upcomingCount += 1;
    }
  }

  let topName: string | null = null;
  let topCount = 0;
  for (const [uid, count] of perAssignee.entries()) {
    if (count > topCount) {
      const member = members.find((m) => m.id === uid);
      if (member !== undefined) {
        topName = member.name;
        topCount = count;
      }
    }
  }

  return {
    choresApprovedThisWeek: approved,
    pendingApprovals: pending,
    allowanceEarnedCentsThisWeek: cents,
    upcomingEvents7Days: upcomingCount,
    topChorePerformerName: topName,
  };
}
