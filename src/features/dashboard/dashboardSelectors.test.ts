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
