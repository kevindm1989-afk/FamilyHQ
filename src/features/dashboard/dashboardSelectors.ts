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

// ---------------------------------------------------------------------------
// Chore Streaks — Feature 5 (gamify consistency)
//
// All four streak stats are derived from the chore feed the member /
// parent dashboard already subscribes to (no new Firestore listener,
// satisfies the spec's "Use existing data / Optimize query count"
// directive). Day arithmetic goes through `eventLocalDay` / `localDayKey`
// so the streak comparison survives a UTC roll-over — the same
// invariant that protects `selectUpcomingEvents` and `bucketUpcoming
// Events`. Pure: no clock read, no side effects.
//
// Day attribution: each chore's "streak day" is its `dueDate` — the day
// the chore activity was meant to happen. `createdAt` is the wrong
// proxy (it's when the parent created the chore, not when the kid did
// it); a proper `approvedAt` field would be ideal but doesn't exist
// today (same approximation called out on `dashboardWeeklyDigest`).
// Chores with malformed / missing dueDate are dropped from the
// streak math.
// ---------------------------------------------------------------------------

export interface ChoreStreaks {
  /**
   * Consecutive LOCAL days ending today (or yesterday) on which the
   * member had ≥1 approved chore. A streak running through yesterday
   * counts even before today's chore is approved (gives the member
   * one grace day to keep the streak alive).
   */
  currentStreak: number;
  /** Longest run of consecutive LOCAL days with ≥1 approved chore. */
  longestStreak: number;
  /** Approved chores whose `dueDate` falls in the local CALENDAR month of `nowMs`. */
  approvedThisMonth: number;
  /**
   * Count of completed 7-day windows where EVERY assigned chore was
   * approved (no pending / complete / rejected). A window with zero
   * chores doesn't count — "perfect" implies there were chores to do.
   * Windows are aligned to local calendar weeks ending on Sunday going
   * back from `nowMs`.
   */
  perfectWeeks: number;
}

/**
 * Aggregate streak stats from a PRE-FILTERED chore feed (own-only).
 * `useMyChores` already filters by `assignedTo == uid`; on the parent
 * side, `topStreakHolder` filters per member before calling this.
 *
 * `nowMs` is injected (never `Date.now()` inside) so tests are
 * deterministic and TZ-isolated.
 */
export function dashboardChoreStreaks(myChores: ChoreWithId[], nowMs: number): ChoreStreaks {
  // Bucket approved chores by their local day-key for streak math.
  const approvedDays = new Set<string>();
  let approvedThisMonth = 0;
  const monthKey = localDayKey(nowMs).slice(0, 7);
  for (const chore of myChores) {
    if (chore.status !== 'approved') continue;
    const day = eventLocalDay(chore.dueDate);
    if (day === null) continue;
    approvedDays.add(day.key);
    if (day.key.startsWith(monthKey)) {
      approvedThisMonth += 1;
    }
  }

  const currentStreak = computeCurrentStreak(approvedDays, nowMs);
  const longestStreak = computeLongestStreak(approvedDays);
  const perfectWeeks = computePerfectWeeks(myChores, nowMs);

  return { currentStreak, longestStreak, approvedThisMonth, perfectWeeks };
}

function dayKeyOffset(nowMs: number, daysBack: number): string {
  return localDayKey(nowMs - daysBack * 24 * 60 * 60 * 1000);
}

function computeCurrentStreak(approvedDays: Set<string>, nowMs: number): number {
  // Walk backward from today. The streak window starts at TODAY; if
  // today has no approved chore yet, we still allow YESTERDAY as the
  // starting point (grace day) so a streak doesn't reset just because
  // approval hasn't happened today yet.
  let streak = 0;
  let cursor = 0;
  if (!approvedDays.has(localDayKey(nowMs))) {
    if (!approvedDays.has(dayKeyOffset(nowMs, 1))) return 0;
    cursor = 1;
  }
  while (approvedDays.has(dayKeyOffset(nowMs, cursor))) {
    streak += 1;
    cursor += 1;
  }
  return streak;
}

function computeLongestStreak(approvedDays: Set<string>): number {
  if (approvedDays.size === 0) return 0;
  // Convert keys to instants so we can compute consecutive-day runs by
  // millisecond difference. Sort ascending.
  const instants = Array.from(approvedDays)
    .map((key) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
      if (!m) return null;
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      return new Date(year, month - 1, day).getTime();
    })
    .filter((n): n is number => n !== null)
    .sort((a, b) => a - b);

  const DAY = 24 * 60 * 60 * 1000;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < instants.length; i += 1) {
    const prev = instants[i - 1]!;
    const curr = instants[i]!;
    if (curr - prev === DAY) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 1;
    }
  }
  return longest;
}

function computePerfectWeeks(chores: ChoreWithId[], nowMs: number): number {
  // Group chores by their local week (Monday-anchored) and count weeks
  // where ≥1 chore was assigned AND every assigned chore is approved.
  // A week is defined as the 7-day window starting on the local-Monday
  // that contains the chore's dueDate.
  const buckets = new Map<string, { total: number; approved: number }>();
  for (const chore of chores) {
    const day = eventLocalDay(chore.dueDate);
    if (day === null) continue;
    const weekKey = weekKeyForInstant(day.instant);
    const slot = buckets.get(weekKey) ?? { total: 0, approved: 0 };
    slot.total += 1;
    if (chore.status === 'approved') slot.approved += 1;
    buckets.set(weekKey, slot);
  }
  const currentWeekKey = weekKeyForInstant(nowMs);
  let perfect = 0;
  for (const [weekKey, { total, approved }] of buckets.entries()) {
    // Skip the in-progress current week — only COMPLETED weeks count.
    if (weekKey >= currentWeekKey) continue;
    if (total > 0 && total === approved) perfect += 1;
  }
  return perfect;
}

function weekKeyForInstant(ms: number): string {
  // Roll the date back to its Monday. `getDay()` returns 0 (Sun)..6
  // (Sat); convert to a Monday-anchored offset (Mon=0..Sun=6).
  const d = new Date(ms);
  const dayOfWeek = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dayOfWeek);
  return localDayKey(d.getTime());
}

export interface TopStreakHolder {
  uid: string | null;
  name: string | null;
  currentStreak: number;
}

/**
 * For the parent's "Top streak holder" dashboard widget. Walks each
 * active member's chores in the supplied feed and returns the one with
 * the highest current streak. Ties break by member input order; an
 * empty result is `{ uid: null, name: null, currentStreak: 0 }`.
 */
export function topStreakHolder(
  chores: ChoreWithId[],
  members: UserWithId[],
  nowMs: number,
): TopStreakHolder {
  let best: TopStreakHolder = { uid: null, name: null, currentStreak: 0 };
  for (const member of members) {
    if (member.role !== 'member' || !member.isActive) continue;
    const ownChores = chores.filter((c) => c.assignedTo === member.id);
    const stats = dashboardChoreStreaks(ownChores, nowMs);
    if (stats.currentStreak > best.currentStreak) {
      best = {
        uid: member.id,
        name: member.name,
        currentStreak: stats.currentStreak,
      };
    }
  }
  return best;
}
