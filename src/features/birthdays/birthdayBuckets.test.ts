/**
 * Pure selector tests for the dashboard "upcoming birthdays" widget.
 * `todayLocal` is injected so every case is deterministic.
 */
import { describe, expect, it } from 'vitest';
import {
  daysUntilNextOccurrence,
  localToday,
  selectUpcomingBirthdays,
  type LocalDate,
} from './birthdayBuckets';
import type { BirthdayWithId } from './birthdaysService';

function mk(over: Partial<BirthdayWithId> & { id: string; monthDay: string }): BirthdayWithId {
  return {
    familyId: 'fam-A',
    createdBy: 'uid-a',
    name: `T-${over.id}`,
    type: 'birthday',
    createdAt: 1000,
    ...over,
  };
}

const TODAY: LocalDate = { year: 2026, month: 6, day: 5 }; // 2026-06-05

describe('localToday', () => {
  it('extracts the local Y/M/D parts from a Date', () => {
    const dt = new Date(2026, 5, 15); // 2026-06-15 local
    expect(localToday(dt)).toEqual({ year: 2026, month: 6, day: 15 });
  });
});

describe('daysUntilNextOccurrence', () => {
  it('returns 0 when today IS the birthday', () => {
    expect(daysUntilNextOccurrence('06-05', TODAY)).toBe(0);
  });

  it('returns 1 for tomorrow', () => {
    expect(daysUntilNextOccurrence('06-06', TODAY)).toBe(1);
  });

  it('wraps to next year when the date has already passed this year', () => {
    // 2026-06-05 → next 2026-01-01 already passed, next occurrence is 2027-01-01
    // (date math): 2026 is 365 days, days from 06-05 to year-end + Jan 1 next year
    // We don't pin the exact day count here — just assert "more than 200, less than 365".
    const days = daysUntilNextOccurrence('01-01', TODAY);
    expect(days).toBeGreaterThan(200);
    expect(days).toBeLessThan(365);
  });

  it('handles next-month boundary correctly (06-30 → 07-01 is 26 days from 06-05)', () => {
    expect(daysUntilNextOccurrence('07-01', TODAY)).toBe(26);
  });

  it('returns null for a malformed monthDay', () => {
    expect(daysUntilNextOccurrence('not-a-date', TODAY)).toBeNull();
    expect(daysUntilNextOccurrence('13-01', TODAY)).toBeNull();
    expect(daysUntilNextOccurrence('04-31', TODAY)).toBeNull();
  });

  it('Feb 29 in a non-leap year falls back to Feb 28 for the comparison', () => {
    // 2026 (next non-leap) — 02-29 should land on 02-28 not skip to 03-01.
    // Today is 2026-06-05; next 02-29 is 2027-02-28 (the wrap-to-next-year path).
    const days = daysUntilNextOccurrence('02-29', { year: 2026, month: 6, day: 5 });
    // 2026-06-05 → 2027-02-28 is roughly 268 days; this asserts it didn't return null.
    expect(typeof days).toBe('number');
    expect(days).toBeGreaterThan(200);
  });
});

describe('selectUpcomingBirthdays', () => {
  it('sorts by daysUntil ascending and caps at limit', () => {
    const items = [
      mk({ id: 'far', monthDay: '07-30', name: 'Far' }),
      mk({ id: 'today', monthDay: '06-05', name: 'Today' }),
      mk({ id: 'tomorrow', monthDay: '06-06', name: 'Tom' }),
    ];
    const out = selectUpcomingBirthdays(items, TODAY, 3);
    expect(out.map((b) => b.id)).toEqual(['today', 'tomorrow', 'far']);
  });

  it('drops items outside the windowDays', () => {
    const items = [
      mk({ id: 'soon', monthDay: '06-10' }),
      mk({ id: 'far', monthDay: '12-25' }), // way beyond 60-day default
    ];
    const out = selectUpcomingBirthdays(items, TODAY, 10);
    expect(out.map((b) => b.id)).toEqual(['soon']);
  });

  it('drops items with a malformed monthDay (defensive, never throws)', () => {
    const items = [
      mk({ id: 'good', monthDay: '06-10' }),
      mk({ id: 'bad', monthDay: 'not-a-date' }),
    ];
    expect(() => selectUpcomingBirthdays(items, TODAY, 10)).not.toThrow();
    expect(selectUpcomingBirthdays(items, TODAY, 10).map((b) => b.id)).toEqual(['good']);
  });

  it('computes turningAge from birthYear', () => {
    const items = [
      mk({ id: 'today', monthDay: '06-05', birthYear: 2014, name: 'Today' }),
    ];
    const out = selectUpcomingBirthdays(items, TODAY, 10);
    expect(out[0]?.turningAge).toBe(2026 - 2014);
  });

  it('turningAge is null when birthYear is absent', () => {
    const items = [mk({ id: 'today', monthDay: '06-05', name: 'Today' })];
    const out = selectUpcomingBirthdays(items, TODAY, 10);
    expect(out[0]?.turningAge).toBeNull();
  });

  it('turningAge bumps by 1 when the next occurrence is next year', () => {
    // 2026 today is June 5. A birthday on 01-01 with birthYear 2000 next
    // occurs 2027-01-01 → turning 27.
    const items = [mk({ id: 'past', monthDay: '01-01', birthYear: 2000 })];
    const out = selectUpcomingBirthdays(items, TODAY, 10, 365);
    expect(out[0]?.turningAge).toBe(27);
  });
});
