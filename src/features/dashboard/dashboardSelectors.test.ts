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
  selectRecent,
  selectSoonestChores,
  selectUpcomingEvents,
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
