/**
 * Dashboard pure-selector contract (Phase 4, Dashboard feature).
 *
 * Level: unit. These selectors are pure (no clock, no Firebase) so they are
 * tested in isolation — the "now" reference is always injected. The TZ-sensitive
 * upcoming-events filter is pinned under a NON-UTC timezone (lesson F4) so a
 * "local today" event is never wrongly dropped as past and the UTC/local
 * boundary buckets by the LOCAL day.
 *
 * Isolation: each test owns its fixtures; `process.env.TZ` is set in beforeEach
 * and RESTORED in afterEach (order-independent, no leak to sibling suites).
 *
 * FAILS today: every selector throws `not implemented` (signature-only stub).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EventWithId } from '../calendar/calendarService';
import type { PostWithId } from '../board/boardService';
import type { ChoreWithId } from '../chores/choresMemberService';
import {
  bucketUpcomingEvents,
  dashboardChoreStreaks,
  dashboardWeeklyDigest,
  selectRecent,
  selectSoonestChores,
  selectUpcomingEvents,
  topStreakHolder,
} from './dashboardSelectors';

function mkEvent(over: Partial<EventWithId> & { id: string; date: string }): EventWithId {
  return {
    title: `Event ${over.id}`,
    description: '',
    tag: 'family',
    familyId: 'fam-A',
    createdBy: 'uid-parent-a',
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

function mkPost(over: Partial<PostWithId> & { id: string; createdAt: number }): PostWithId {
  return {
    content: `Post ${over.id}`,
    authorId: 'uid-parent-a',
    authorName: 'Sarah Kim',
    familyId: 'fam-A',
    ...over,
  };
}

function mkChore(over: Partial<ChoreWithId> & { id: string; dueDate: string }): ChoreWithId {
  return {
    title: `Chore ${over.id}`,
    assignedTo: 'uid-member-a',
    pointValue: 0,
    dollarValue: 0,
    status: 'pending',
    familyId: 'fam-A',
    createdBy: 'uid-parent-a',
    createdAt: 1_700_000_000_000,
    isRecurring: false,
    recurrenceFrequency: 'none',
    ...over,
  };
}

describe('selectRecent — newest first, capped, stable (happy + edge)', () => {
  it('sorts by createdAt descending and caps at the limit', () => {
    const items = [
      mkPost({ id: 'p1', createdAt: 100 }),
      mkPost({ id: 'p2', createdAt: 300 }),
      mkPost({ id: 'p3', createdAt: 200 }),
      mkPost({ id: 'p4', createdAt: 400 }),
    ];
    const result = selectRecent(items, 3);
    expect(result.map((p) => p.id)).toEqual(['p4', 'p2', 'p3']);
  });

  it('returns all items (newest first) when fewer than the limit', () => {
    const items = [mkPost({ id: 'p1', createdAt: 100 }), mkPost({ id: 'p2', createdAt: 200 })];
    expect(selectRecent(items, 3).map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('returns an empty array for an empty input (no throw)', () => {
    expect(selectRecent<PostWithId>([], 3)).toEqual([]);
  });

  it('preserves input order for equal createdAt ties (stable)', () => {
    const items = [
      mkPost({ id: 'a', createdAt: 500 }),
      mkPost({ id: 'b', createdAt: 500 }),
      mkPost({ id: 'c', createdAt: 500 }),
    ];
    expect(selectRecent(items, 3).map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const items = [mkPost({ id: 'p1', createdAt: 100 }), mkPost({ id: 'p2', createdAt: 300 })];
    const before = items.map((p) => p.id);
    selectRecent(items, 1);
    expect(items.map((p) => p.id)).toEqual(before);
  });
});

describe('selectSoonestChores — dueDate ascending, capped, stable (happy + edge)', () => {
  it('sorts by dueDate ascending (soonest first) and caps at the limit', () => {
    const chores = [
      mkChore({ id: 'c1', dueDate: '2026-06-03' }),
      mkChore({ id: 'c2', dueDate: '2026-06-01' }),
      mkChore({ id: 'c3', dueDate: '2026-06-02' }),
      mkChore({ id: 'c4', dueDate: '2026-06-04' }),
    ];
    expect(selectSoonestChores(chores, 3).map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
  });

  it('returns an empty array for an empty input (no throw)', () => {
    expect(selectSoonestChores([], 3)).toEqual([]);
  });

  it('preserves input order for equal dueDate ties (stable)', () => {
    const chores = [
      mkChore({ id: 'x', dueDate: '2026-06-01' }),
      mkChore({ id: 'y', dueDate: '2026-06-01' }),
    ];
    expect(selectSoonestChores(chores, 3).map((c) => c.id)).toEqual(['x', 'y']);
  });
});

describe('selectSoonestChores — F5: tolerates missing / non-ISO dueDate without throwing', () => {
  // F5 (LOW): `a.chore.dueDate.localeCompare(...)` throws if dueDate is
  // undefined/null, crashing the member home. A malformed dueDate must NOT
  // throw; the well-formed chores still sort soonest-first and malformed ones
  // sort deterministically LAST (after all parseable ISO dates).

  it('does NOT throw when a chore has an undefined dueDate', () => {
    const chores = [
      mkChore({ id: 'good', dueDate: '2026-06-01' }),
      // Production data / stale cache can carry a missing dueDate; cast to feed it.
      mkChore({ id: 'no-due', dueDate: undefined as unknown as string }),
    ];
    expect(() => selectSoonestChores(chores, 3)).not.toThrow();
  });

  it('does NOT throw when a chore has an empty-string dueDate', () => {
    const chores = [
      mkChore({ id: 'good', dueDate: '2026-06-01' }),
      mkChore({ id: 'empty-due', dueDate: '' }),
    ];
    expect(() => selectSoonestChores(chores, 3)).not.toThrow();
  });

  it('returns the cap and sorts well-formed chores soonest-first, malformed LAST', () => {
    const chores = [
      mkChore({ id: 'undef', dueDate: undefined as unknown as string }),
      mkChore({ id: 'late', dueDate: '2026-06-20' }),
      mkChore({ id: 'empty', dueDate: '' }),
      mkChore({ id: 'soon', dueDate: '2026-06-05' }),
    ];
    // Cap honored (4 in, 3 out); the two parseable ISO dates come first in
    // ascending order, and exactly one malformed entry survives the cap at the end.
    const result = selectSoonestChores(chores, 3).map((c) => c.id);
    expect(result).toEqual(['soon', 'late', 'undef']);
  });

  it('places empty-string dueDate after parseable ISO dates (deterministic last)', () => {
    const chores = [
      mkChore({ id: 'empty', dueDate: '' }),
      mkChore({ id: 'soon', dueDate: '2026-06-05' }),
    ];
    expect(selectSoonestChores(chores, 3).map((c) => c.id)).toEqual(['soon', 'empty']);
  });
});

describe('selectUpcomingEvents — TZ-sensitive future filter (lesson F4: local today is NOT past)', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    // America/Los_Angeles: UTC-7 in late May/June (PDT). Restored in afterEach
    // so the non-UTC timezone never leaks into a sibling suite.
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('KEEPS an event dated the LOCAL today — it is not dropped as past', () => {
    // 2026-06-15 12:00 PDT == 2026-06-15 19:00 UTC. An event dated 2026-06-15 is
    // the local today and MUST be kept.
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    const events = [mkEvent({ id: 'today', date: '2026-06-15' })];
    expect(selectUpcomingEvents(events, nowMs, 3).map((e) => e.id)).toEqual(['today']);
  });

  it('buckets the UTC-vs-local boundary by the LOCAL day, not UTC', () => {
    // Local now is 2026-06-15 23:30 PDT == 2026-06-16 06:30 UTC. An event dated
    // 2026-06-15 is still the LOCAL today (kept). If "today" were judged in UTC
    // it would be 2026-06-16 and the 06-15 event would be wrongly dropped.
    const nowMs = new Date('2026-06-16T06:30:00.000Z').getTime();
    const events = [mkEvent({ id: 'local-today', date: '2026-06-15' })];
    expect(
      selectUpcomingEvents(events, nowMs, 3).map((e) => e.id),
      'a local-today event must survive even when UTC has rolled to tomorrow',
    ).toEqual(['local-today']);
  });

  it('drops events strictly before the local today', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    const events = [
      mkEvent({ id: 'past', date: '2026-06-10' }),
      mkEvent({ id: 'future', date: '2026-06-20' }),
    ];
    expect(selectUpcomingEvents(events, nowMs, 3).map((e) => e.id)).toEqual(['future']);
  });

  it('orders kept events soonest-first and caps at the limit', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    const events = [
      mkEvent({ id: 'e3', date: '2026-06-20' }),
      mkEvent({ id: 'e1', date: '2026-06-15' }),
      mkEvent({ id: 'e4', date: '2026-06-25' }),
      mkEvent({ id: 'e2', date: '2026-06-18' }),
    ];
    expect(selectUpcomingEvents(events, nowMs, 3).map((e) => e.id)).toEqual(['e1', 'e2', 'e3']);
  });

  it('returns an empty array when no event is today-or-later (no throw)', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    const events = [mkEvent({ id: 'past', date: '2026-01-01' })];
    expect(selectUpcomingEvents(events, nowMs, 3)).toEqual([]);
  });
});

describe('selectUpcomingEvents — F1: buckets TIME-BEARING ISO datetimes by the VIEWER LOCAL day (LA)', () => {
  // F1 (HIGH/BLOCKER): the selector slices the raw UTC date substring
  // (`iso.slice(0,10)`) and compares it to a LOCAL today key — two different
  // time bases. For a non-UTC viewer an event with a TIME component lands in
  // the wrong day. These fixtures all carry a time component (the existing
  // date-only suite hides the bug). TZ is set per-test and restored in afterEach
  // so a non-UTC zone never leaks into a sibling suite.
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    // America/Los_Angeles is PDT (UTC-7) in June.
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('DROPS a time-bearing event that is yesterday in LOCAL time though its UTC substring reads today', () => {
    // Local now = 2026-06-15 12:00 PDT (== 2026-06-15 19:00 UTC).
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    // 2026-06-15T02:00Z == 2026-06-14 19:00 PDT — that is YESTERDAY locally and
    // must be dropped. Its UTC substring "2026-06-15" would wrongly KEEP it.
    const events = [mkEvent({ id: 'utc-today-but-local-yesterday', date: '2026-06-15T02:00:00.000Z' })];
    expect(
      selectUpcomingEvents(events, nowMs, 3).map((e) => e.id),
      'an event at 2026-06-14 19:00 LOCAL is past and must be dropped',
    ).toEqual([]);
  });

  it('KEEPS a time-bearing event that is today in LOCAL time though its UTC substring reads tomorrow', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    // 2026-06-16T05:00Z == 2026-06-15 22:00 PDT — still TODAY locally, must be
    // kept. Its UTC substring "2026-06-16" is correct here but the next test
    // proves the bucket is the LOCAL instant, not the substring.
    const events = [mkEvent({ id: 'local-today-evening', date: '2026-06-16T05:00:00.000Z' })];
    expect(selectUpcomingEvents(events, nowMs, 3).map((e) => e.id)).toEqual(['local-today-evening']);
  });

  it('orders the kept time-bearing event as today/soonest ahead of a later future event', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    const events = [
      mkEvent({ id: 'future', date: '2026-06-20T18:00:00.000Z' }),
      mkEvent({ id: 'local-today-evening', date: '2026-06-16T05:00:00.000Z' }), // 06-15 22:00 PDT
    ];
    expect(selectUpcomingEvents(events, nowMs, 3).map((e) => e.id)).toEqual([
      'local-today-evening',
      'future',
    ]);
  });

  it('buckets an OFFSET-form date by its LOCAL instant in the viewer zone (kept)', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    // '2026-06-15T23:30:00.000-04:00' == 2026-06-16 03:30 UTC == 2026-06-15
    // 20:30 PDT — TODAY locally, must be kept (the -04:00 substring "2026-06-15"
    // happens to agree, but the assertion pins the LOCAL instant).
    const events = [mkEvent({ id: 'offset-local-today', date: '2026-06-15T23:30:00.000-04:00' })];
    expect(selectUpcomingEvents(events, nowMs, 3).map((e) => e.id)).toEqual(['offset-local-today']);
  });

  it('DROPS an OFFSET-form date whose LOCAL instant is yesterday (substring would keep it)', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    // '2026-06-15T01:00:00.000-04:00' == 2026-06-15 05:00 UTC == 2026-06-14
    // 22:00 PDT — YESTERDAY locally, must be dropped. Its substring "2026-06-15"
    // would wrongly keep it.
    const events = [mkEvent({ id: 'offset-local-yesterday', date: '2026-06-15T01:00:00.000-04:00' })];
    expect(
      selectUpcomingEvents(events, nowMs, 3).map((e) => e.id),
      'offset date resolving to 2026-06-14 22:00 LOCAL is past',
    ).toEqual([]);
  });

  it('keeps a DATE-ONLY today event green as a positive control (no regression)', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    const events = [mkEvent({ id: 'date-only-today', date: '2026-06-15' })];
    expect(selectUpcomingEvents(events, nowMs, 3).map((e) => e.id)).toEqual(['date-only-today']);
  });
});

describe('selectUpcomingEvents — F1: LOCAL-day bucketing under a UTC-AHEAD zone (Asia/Tokyo, not LA-specific)', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    // Asia/Tokyo is JST (UTC+9), no DST.
    process.env.TZ = 'Asia/Tokyo';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('KEEPS a time-bearing event whose UTC substring reads yesterday but is today in LOCAL (Tokyo)', () => {
    // Local now = 2026-06-15 12:00 JST (== 2026-06-15 03:00 UTC).
    const nowMs = new Date('2026-06-15T03:00:00.000Z').getTime();
    // 2026-06-14T20:00Z == 2026-06-15 05:00 JST — TODAY locally, must be kept.
    // Its UTC substring "2026-06-14" would wrongly DROP it.
    const events = [mkEvent({ id: 'utc-yesterday-but-local-today', date: '2026-06-14T20:00:00.000Z' })];
    expect(
      selectUpcomingEvents(events, nowMs, 3).map((e) => e.id),
      'an event at 2026-06-15 05:00 LOCAL (Tokyo) is today and must be kept',
    ).toEqual(['utc-yesterday-but-local-today']);
  });

  it('KEEPS an OFFSET-form date whose UTC day is yesterday but resolves to today in LOCAL (Tokyo)', () => {
    // In a UTC-AHEAD zone the local day is always >= the UTC day, so the only
    // bug-exposing mismatch is "substring reads yesterday, local is today" — the
    // buggy substring drops it, the correct LOCAL bucketing keeps it.
    const nowMs = new Date('2026-06-15T03:00:00.000Z').getTime(); // 2026-06-15 12:00 JST
    // '2026-06-14T22:00:00.000-04:00' == 2026-06-15 02:00 UTC == 2026-06-15
    // 11:00 JST — TODAY locally, must be kept. Its UTC/offset substring
    // "2026-06-14" would wrongly DROP it.
    const events = [mkEvent({ id: 'offset-local-today-tokyo', date: '2026-06-14T22:00:00.000-04:00' })];
    expect(
      selectUpcomingEvents(events, nowMs, 3).map((e) => e.id),
      'offset date resolving to 2026-06-15 11:00 LOCAL (Tokyo) is today',
    ).toEqual(['offset-local-today-tokyo']);
  });
});

describe('selectUpcomingEvents — F2: malformed / empty event.date is DROPPED (never surfaced)', () => {
  // F2 (MED): eventDayKey('garbage') currently passes the `>= todayKey` compare
  // by lexicographic luck and renders <time dateTime="garbage">. An unparseable
  // or empty date must be dropped from the result.
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('drops an event whose date is an empty string', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    const events = [
      mkEvent({ id: 'empty', date: '' }),
      mkEvent({ id: 'good', date: '2026-06-20T18:00:00.000Z' }),
    ];
    expect(selectUpcomingEvents(events, nowMs, 3).map((e) => e.id)).toEqual(['good']);
  });

  it('drops an event whose date is a non-ISO / unparseable string', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    const events = [
      mkEvent({ id: 'garbage', date: 'garbage' }),
      mkEvent({ id: 'good', date: '2026-06-20T18:00:00.000Z' }),
    ];
    const result = selectUpcomingEvents(events, nowMs, 3).map((e) => e.id);
    expect(result).not.toContain('garbage');
    expect(result).toEqual(['good']);
  });

  it('does not throw and returns [] when every event date is malformed', () => {
    const nowMs = new Date('2026-06-15T19:00:00.000Z').getTime();
    const events = [
      mkEvent({ id: 'empty', date: '' }),
      mkEvent({ id: 'garbage', date: 'not-a-date' }),
    ];
    expect(() => selectUpcomingEvents(events, nowMs, 3)).not.toThrow();
    expect(selectUpcomingEvents(events, nowMs, 3)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// bucketUpcomingEvents — Reminders widget (Feature 4 Phase 1)
//
// Groups events by urgency relative to the LOCAL day of `nowMs`. Same TZ
// invariants as selectUpcomingEvents — both go through eventLocalDay /
// localDayKey so the day comparison survives a UTC roll-over.
// ---------------------------------------------------------------------------

describe('bucketUpcomingEvents — Today / Tomorrow / This Week / Later buckets', () => {
  // Anchor: 2026-06-15 19:00:00 UTC = 12:00 PM in America/Los_Angeles. Local
  // today = 2026-06-15, local tomorrow = 2026-06-16.
  const NOW_MS = new Date('2026-06-15T19:00:00.000Z').getTime();

  it('groups a date-only event on the local today into the `today` bucket', () => {
    const events = [mkEvent({ id: 't', date: '2026-06-15' })];
    const { today, tomorrow, thisWeek, later } = bucketUpcomingEvents(events, NOW_MS);
    expect(today.map((e) => e.id)).toEqual(['t']);
    expect(tomorrow).toEqual([]);
    expect(thisWeek).toEqual([]);
    expect(later).toEqual([]);
  });

  it('groups an event dated local-tomorrow into the `tomorrow` bucket', () => {
    const events = [mkEvent({ id: 'tom', date: '2026-06-16' })];
    expect(bucketUpcomingEvents(events, NOW_MS).tomorrow.map((e) => e.id)).toEqual(['tom']);
  });

  it('groups an event 2–7 days out into the `thisWeek` bucket', () => {
    const events = [
      mkEvent({ id: 'd2', date: '2026-06-17' }),
      mkEvent({ id: 'd5', date: '2026-06-20' }),
      mkEvent({ id: 'd7', date: '2026-06-22' }),
    ];
    expect(bucketUpcomingEvents(events, NOW_MS).thisWeek.map((e) => e.id)).toEqual([
      'd2',
      'd5',
      'd7',
    ]);
  });

  it('groups events more than 7 days out into the `later` bucket (sorted soonest-first)', () => {
    const events = [
      mkEvent({ id: 'd30', date: '2026-07-15' }),
      mkEvent({ id: 'd9', date: '2026-06-24' }),
      mkEvent({ id: 'd15', date: '2026-06-30' }),
    ];
    expect(bucketUpcomingEvents(events, NOW_MS).later.map((e) => e.id)).toEqual([
      'd9',
      'd15',
      'd30',
    ]);
  });

  it('drops PAST events from every bucket (TZ-sensitive — yesterday local is past)', () => {
    const events = [
      mkEvent({ id: 'past', date: '2026-06-14' }),
      mkEvent({ id: 'today', date: '2026-06-15' }),
    ];
    const result = bucketUpcomingEvents(events, NOW_MS);
    expect(result.today.map((e) => e.id)).toEqual(['today']);
    expect(result.tomorrow).toEqual([]);
    expect(result.thisWeek).toEqual([]);
    expect(result.later).toEqual([]);
  });

  it('drops malformed-date events from every bucket (never surfaces them)', () => {
    const events = [
      mkEvent({ id: 'garbage', date: 'not-a-date' }),
      mkEvent({ id: 'empty', date: '' }),
      mkEvent({ id: 'good', date: '2026-06-15' }),
    ];
    const result = bucketUpcomingEvents(events, NOW_MS);
    expect(result.today.map((e) => e.id)).toEqual(['good']);
    expect([...result.tomorrow, ...result.thisWeek, ...result.later]).toEqual([]);
  });

  it('sorts each bucket soonest-first (time-bearing events within Today preserve start-time order)', () => {
    // Two events on local today, different times — earlier first.
    const events = [
      mkEvent({ id: 'pm', date: '2026-06-15T22:00:00.000Z' }), // 3pm PT
      mkEvent({ id: 'am', date: '2026-06-15T15:00:00.000Z' }), // 8am PT
    ];
    expect(bucketUpcomingEvents(events, NOW_MS).today.map((e) => e.id)).toEqual(['am', 'pm']);
  });

  it('returns four empty buckets for an empty event list', () => {
    const result = bucketUpcomingEvents([], NOW_MS);
    expect(result.today).toEqual([]);
    expect(result.tomorrow).toEqual([]);
    expect(result.thisWeek).toEqual([]);
    expect(result.later).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const events = [
      mkEvent({ id: 'b', date: '2026-06-20' }),
      mkEvent({ id: 'a', date: '2026-06-17' }),
    ];
    const before = events.map((e) => e.id);
    bucketUpcomingEvents(events, NOW_MS);
    expect(events.map((e) => e.id)).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// dashboardWeeklyDigest — Feature 3 (Weekly Family Digest)
//
// Aggregates the parent dashboard widget from the chore + event feeds the
// screen already has in hand. Pure: no clock read, no side effects. Sums
// are in INTEGER CENTS; the screen formats for display via gatedMoney().
// "This week" is the 7-day window ending at nowMs; approximated against
// chore.createdAt (no approvedAt field on chores yet).
// ---------------------------------------------------------------------------

describe('dashboardWeeklyDigest — Feature 3 parent dashboard digest', () => {
  const NOW_MS = new Date('2026-06-15T19:00:00.000Z').getTime();
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const SARAH = mkActiveMember('uid-parent-a', 'parent');
  const MAYA = mkActiveMember('uid-member-a', 'member');
  const BEN = mkActiveMember('uid-member-b', 'member');

  function mkActiveMember(
    id: string,
    role: 'parent' | 'member' = 'member',
  ): import('../../lib/types').UserWithId {
    return {
      id,
      name: id === 'uid-member-a' ? 'Maya' : id === 'uid-member-b' ? 'Ben' : 'Sarah',
      role,
      familyId: 'fam-A',
      isActive: true,
      allowanceBalance: 0,
      theme: 'light',
    };
  }

  it('counts approved chores created this week and sums their dollarValue in cents', () => {
    const chores = [
      mkChore({
        id: 'c1',
        dueDate: '2026-06-14',
        createdAt: NOW_MS - 1000,
        status: 'approved',
        dollarValue: 300,
      }),
      mkChore({
        id: 'c2',
        dueDate: '2026-06-15',
        createdAt: NOW_MS - 2 * 24 * 60 * 60 * 1000,
        status: 'approved',
        dollarValue: 150,
      }),
    ];
    const result = dashboardWeeklyDigest(chores, [], [SARAH, MAYA, BEN], NOW_MS);
    expect(result.choresApprovedThisWeek).toBe(2);
    expect(result.allowanceEarnedCentsThisWeek).toBe(450);
  });

  it('EXCLUDES approved chores created before the 7-day window (long-tail)', () => {
    const chores = [
      mkChore({
        id: 'old',
        dueDate: '2026-05-01',
        createdAt: NOW_MS - WEEK_MS - 24 * 60 * 60 * 1000,
        status: 'approved',
        dollarValue: 500,
      }),
    ];
    const result = dashboardWeeklyDigest(chores, [], [SARAH, MAYA, BEN], NOW_MS);
    expect(result.choresApprovedThisWeek).toBe(0);
    expect(result.allowanceEarnedCentsThisWeek).toBe(0);
  });

  it('counts pending approvals (status `complete`) regardless of week — they are the queue', () => {
    const chores = [
      mkChore({
        id: 'p1',
        dueDate: '2026-06-14',
        createdAt: NOW_MS - 30 * 24 * 60 * 60 * 1000,
        status: 'complete',
      }),
      mkChore({
        id: 'p2',
        dueDate: '2026-06-15',
        createdAt: NOW_MS - 1000,
        status: 'complete',
      }),
      mkChore({
        id: 'p3',
        dueDate: '2026-06-15',
        createdAt: NOW_MS - 1000,
        status: 'pending',
      }),
    ];
    const result = dashboardWeeklyDigest(chores, [], [SARAH, MAYA, BEN], NOW_MS);
    expect(result.pendingApprovals).toBe(2);
  });

  it('counts upcoming events within the next 7 LOCAL days only', () => {
    const events = [
      mkEvent({ id: 'today', date: '2026-06-15' }),
      mkEvent({ id: 'd3', date: '2026-06-18' }),
      mkEvent({ id: 'd7', date: '2026-06-22' }),
      mkEvent({ id: 'd14', date: '2026-06-29' }),
      mkEvent({ id: 'past', date: '2026-06-10' }),
    ];
    const result = dashboardWeeklyDigest([], events, [SARAH, MAYA, BEN], NOW_MS);
    expect(result.upcomingEvents7Days).toBe(3);
  });

  it('picks the top performer by APPROVED-THIS-WEEK chore count and resolves the name from members[]', () => {
    const chores = [
      mkChore({
        id: 'm1',
        dueDate: '2026-06-14',
        createdAt: NOW_MS - 1000,
        status: 'approved',
        assignedTo: 'uid-member-a',
      }),
      mkChore({
        id: 'm2',
        dueDate: '2026-06-14',
        createdAt: NOW_MS - 1000,
        status: 'approved',
        assignedTo: 'uid-member-a',
      }),
      mkChore({
        id: 'b1',
        dueDate: '2026-06-14',
        createdAt: NOW_MS - 1000,
        status: 'approved',
        assignedTo: 'uid-member-b',
      }),
    ];
    const result = dashboardWeeklyDigest(chores, [], [SARAH, MAYA, BEN], NOW_MS);
    expect(result.topChorePerformerName).toBe('Maya');
  });

  it('returns null `topChorePerformerName` when no chores were approved this week', () => {
    expect(dashboardWeeklyDigest([], [], [SARAH, MAYA, BEN], NOW_MS).topChorePerformerName).toBeNull();
  });

  it('falls back to null when the top assignee is no longer in the active member list (mid-week deactivation)', () => {
    const chores = [
      mkChore({
        id: 'orphan',
        dueDate: '2026-06-14',
        createdAt: NOW_MS - 1000,
        status: 'approved',
        assignedTo: 'uid-deactivated',
      }),
    ];
    expect(dashboardWeeklyDigest(chores, [], [SARAH, MAYA, BEN], NOW_MS).topChorePerformerName).toBeNull();
  });

  it('clamps a non-finite dollarValue out of the cents sum (defensive against corrupt cache)', () => {
    const chores = [
      mkChore({
        id: 'good',
        dueDate: '2026-06-14',
        createdAt: NOW_MS - 1000,
        status: 'approved',
        dollarValue: 250,
      }),
      mkChore({
        id: 'corrupt',
        dueDate: '2026-06-14',
        createdAt: NOW_MS - 1000,
        status: 'approved',
        dollarValue: Number.NaN,
      }),
    ];
    const result = dashboardWeeklyDigest(chores, [], [SARAH, MAYA, BEN], NOW_MS);
    // The corrupt entry still counts toward the chore count (it WAS
    // approved — the only thing we can't trust is the money). 1 + 1 = 2.
    expect(result.choresApprovedThisWeek).toBe(2);
    expect(result.allowanceEarnedCentsThisWeek).toBe(250);
  });

  it('returns all-zero digest with null top performer for empty inputs', () => {
    expect(dashboardWeeklyDigest([], [], [], NOW_MS)).toEqual({
      choresApprovedThisWeek: 0,
      pendingApprovals: 0,
      allowanceEarnedCentsThisWeek: 0,
      upcomingEvents7Days: 0,
      topChorePerformerName: null,
    });
  });
});

// ---------------------------------------------------------------------------
// dashboardChoreStreaks + topStreakHolder — Feature 5 (Chore Streaks)
//
// Streaks derive day-of-credit from chore.dueDate (the day the chore was
// for) — not createdAt (when the parent created it) and not an
// approvedAt field (we don't have one). Caveat documented on the
// selector docstring.
// ---------------------------------------------------------------------------

describe('dashboardChoreStreaks — current / longest streak', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  const NOW_MS = new Date('2026-06-15T19:00:00.000Z').getTime(); // 12:00 PDT → local today = 2026-06-15
  const UID = 'uid-member-a';

  it('returns 0/0 for an empty chore list', () => {
    const result = dashboardChoreStreaks([], NOW_MS);
    expect(result.currentStreak).toBe(0);
    expect(result.longestStreak).toBe(0);
  });

  it('counts a current streak of consecutive days ending TODAY', () => {
    const chores = [
      mkChore({ id: 'c1', dueDate: '2026-06-13', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'c2', dueDate: '2026-06-14', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'c3', dueDate: '2026-06-15', status: 'approved', assignedTo: UID }),
    ];
    expect(dashboardChoreStreaks(chores, NOW_MS).currentStreak).toBe(3);
  });

  it('grace day: a streak through YESTERDAY counts even if no chore is approved TODAY yet', () => {
    const chores = [
      mkChore({ id: 'c1', dueDate: '2026-06-13', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'c2', dueDate: '2026-06-14', status: 'approved', assignedTo: UID }),
    ];
    expect(dashboardChoreStreaks(chores, NOW_MS).currentStreak).toBe(2);
  });

  it('current streak is 0 when neither today nor yesterday has an approved chore', () => {
    const chores = [
      mkChore({ id: 'old', dueDate: '2026-06-10', status: 'approved', assignedTo: UID }),
    ];
    expect(dashboardChoreStreaks(chores, NOW_MS).currentStreak).toBe(0);
  });

  it('non-approved chores do NOT contribute to a streak', () => {
    const chores = [
      mkChore({ id: 'c1', dueDate: '2026-06-13', status: 'complete', assignedTo: UID }),
      mkChore({ id: 'c2', dueDate: '2026-06-14', status: 'pending', assignedTo: UID }),
      mkChore({ id: 'c3', dueDate: '2026-06-15', status: 'rejected', assignedTo: UID }),
    ];
    expect(dashboardChoreStreaks(chores, NOW_MS).currentStreak).toBe(0);
  });

  it('longestStreak picks the max historical run, not just the current one', () => {
    const chores = [
      // 5-day run in May:
      mkChore({ id: 'm1', dueDate: '2026-05-01', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'm2', dueDate: '2026-05-02', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'm3', dueDate: '2026-05-03', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'm4', dueDate: '2026-05-04', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'm5', dueDate: '2026-05-05', status: 'approved', assignedTo: UID }),
      // Current 2-day run:
      mkChore({ id: 'c1', dueDate: '2026-06-14', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'c2', dueDate: '2026-06-15', status: 'approved', assignedTo: UID }),
    ];
    const result = dashboardChoreStreaks(chores, NOW_MS);
    expect(result.currentStreak).toBe(2);
    expect(result.longestStreak).toBe(5);
  });

  it('drops chores with malformed dueDate from the streak math (no throw)', () => {
    const chores = [
      mkChore({ id: 'good', dueDate: '2026-06-15', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'bad', dueDate: 'not-a-date', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'empty', dueDate: '', status: 'approved', assignedTo: UID }),
    ];
    expect(() => dashboardChoreStreaks(chores, NOW_MS)).not.toThrow();
    expect(dashboardChoreStreaks(chores, NOW_MS).currentStreak).toBe(1);
  });
});

describe('dashboardChoreStreaks — approvedThisMonth', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  const NOW_MS = new Date('2026-06-15T19:00:00.000Z').getTime();
  const UID = 'uid-member-a';

  it('counts only approved chores whose dueDate is in the LOCAL calendar month of nowMs', () => {
    const chores = [
      mkChore({ id: 'this1', dueDate: '2026-06-01', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'this2', dueDate: '2026-06-15', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'last', dueDate: '2026-05-31', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'next', dueDate: '2026-07-01', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'pendingThisMonth', dueDate: '2026-06-10', status: 'pending', assignedTo: UID }),
    ];
    expect(dashboardChoreStreaks(chores, NOW_MS).approvedThisMonth).toBe(2);
  });
});

describe('dashboardChoreStreaks — perfectWeeks', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  const NOW_MS = new Date('2026-06-15T19:00:00.000Z').getTime(); // Mon 2026-06-15 PDT
  const UID = 'uid-member-a';

  it('counts a week where every assigned chore was approved as 1 perfect week', () => {
    // Week of 2026-06-01 (Mon) → 06-07 (Sun): two chores, both approved.
    const chores = [
      mkChore({ id: 'a', dueDate: '2026-06-02', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'b', dueDate: '2026-06-05', status: 'approved', assignedTo: UID }),
    ];
    expect(dashboardChoreStreaks(chores, NOW_MS).perfectWeeks).toBe(1);
  });

  it('does NOT count a week where at least one chore was not approved', () => {
    const chores = [
      mkChore({ id: 'a', dueDate: '2026-06-02', status: 'approved', assignedTo: UID }),
      mkChore({ id: 'b', dueDate: '2026-06-05', status: 'pending', assignedTo: UID }),
    ];
    expect(dashboardChoreStreaks(chores, NOW_MS).perfectWeeks).toBe(0);
  });

  it('excludes the IN-PROGRESS current week (only completed weeks count)', () => {
    const chores = [
      // Current week (containing 2026-06-15 Mon): perfect would normally count.
      mkChore({ id: 'c1', dueDate: '2026-06-15', status: 'approved', assignedTo: UID }),
    ];
    expect(dashboardChoreStreaks(chores, NOW_MS).perfectWeeks).toBe(0);
  });

  it('a week with zero assigned chores does NOT count as perfect', () => {
    expect(dashboardChoreStreaks([], NOW_MS).perfectWeeks).toBe(0);
  });
});

describe('topStreakHolder', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
  });
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  const NOW_MS = new Date('2026-06-15T19:00:00.000Z').getTime();
  const MAYA: import('../../lib/types').UserWithId = {
    id: 'uid-maya',
    name: 'Maya',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 0,
    theme: 'light',
  };
  const BEN: import('../../lib/types').UserWithId = {
    id: 'uid-ben',
    name: 'Ben',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 0,
    theme: 'light',
  };

  it('picks the member with the longest CURRENT streak', () => {
    const chores = [
      // Maya: 1-day current
      mkChore({ id: 'm1', dueDate: '2026-06-15', status: 'approved', assignedTo: 'uid-maya' }),
      // Ben: 3-day current
      mkChore({ id: 'b1', dueDate: '2026-06-13', status: 'approved', assignedTo: 'uid-ben' }),
      mkChore({ id: 'b2', dueDate: '2026-06-14', status: 'approved', assignedTo: 'uid-ben' }),
      mkChore({ id: 'b3', dueDate: '2026-06-15', status: 'approved', assignedTo: 'uid-ben' }),
    ];
    expect(topStreakHolder(chores, [MAYA, BEN], NOW_MS)).toEqual({
      uid: 'uid-ben',
      name: 'Ben',
      currentStreak: 3,
    });
  });

  it('returns a null holder when no member has any approved chore', () => {
    expect(topStreakHolder([], [MAYA, BEN], NOW_MS)).toEqual({
      uid: null,
      name: null,
      currentStreak: 0,
    });
  });

  it('SKIPS parents and deactivated members (only active members are eligible)', () => {
    const parent: import('../../lib/types').UserWithId = {
      id: 'uid-parent',
      name: 'Sarah',
      role: 'parent',
      familyId: 'fam-A',
      isActive: true,
      allowanceBalance: 0,
      theme: 'light',
    };
    const deactivated: import('../../lib/types').UserWithId = {
      ...MAYA,
      id: 'uid-old',
      name: 'Old',
      isActive: false,
    };
    const chores = [
      mkChore({ id: 'p', dueDate: '2026-06-15', status: 'approved', assignedTo: 'uid-parent' }),
      mkChore({ id: 'd', dueDate: '2026-06-15', status: 'approved', assignedTo: 'uid-old' }),
    ];
    expect(
      topStreakHolder(chores, [parent, deactivated], NOW_MS).uid,
    ).toBeNull();
  });
});
