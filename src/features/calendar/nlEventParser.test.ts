import { describe, it, expect } from 'vitest';
import { parseNaturalEvent } from './nlEventParser';

// Fixed reference "now": local Wednesday, 2026-07-08 (noon). Constructed with
// LOCAL parts and read back with local getters in the parser, so this is stable
// under any TZ the test runner uses.
const NOW = new Date(2026, 6, 8, 12, 0, 0);

/** Weekday index (0=Sun) of a resolved ymd, computed independently of the parser. */
function weekdayOf(ymd: { year: number; month: number; day: number }): number {
  return new Date(Date.UTC(ymd.year, ymd.month, ymd.day, 12)).getUTCDay();
}
/** Whole-day delta from NOW (which is a Wed) to a resolved ymd. */
function dayDelta(ymd: { year: number; month: number; day: number }): number {
  const a = Date.UTC(2026, 6, 8);
  const b = Date.UTC(ymd.year, ymd.month, ymd.day);
  return Math.round((b - a) / 86400000);
}

describe('parseNaturalEvent — relative dates', () => {
  it('"today" keeps the current day and flags hadDate', () => {
    const r = parseNaturalEvent('Lunch with mom today', NOW);
    expect(r).not.toBeNull();
    expect(r!.ymd).toEqual({ year: 2026, month: 6, day: 8 });
    expect(r!.hadDate).toBe(true);
    expect(r!.title).toBe('Lunch with mom');
  });

  it('"tomorrow" advances one day', () => {
    const r = parseNaturalEvent('Dentist tomorrow', NOW);
    expect(r!.ymd).toEqual({ year: 2026, month: 6, day: 9 });
    expect(r!.title).toBe('Dentist');
  });

  it('"in 3 days" advances three days', () => {
    const r = parseNaturalEvent('Package arrives in 3 days', NOW);
    expect(r!.ymd).toEqual({ year: 2026, month: 6, day: 11 });
  });

  it('no date phrase → defaults to today with hadDate:false', () => {
    const r = parseNaturalEvent('Buy groceries', NOW);
    expect(r!.hadDate).toBe(false);
    expect(r!.ymd).toEqual({ year: 2026, month: 6, day: 8 });
    expect(r!.title).toBe('Buy groceries');
  });
});

describe('parseNaturalEvent — weekdays', () => {
  it('a bare weekday resolves to the next occurrence within 6 days', () => {
    const r = parseNaturalEvent('Soccer practice friday', NOW);
    expect(weekdayOf(r!.ymd)).toBe(5); // Friday
    const d = dayDelta(r!.ymd);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(6);
  });

  it('"next <weekday>" jumps a further week (8–13 days out)', () => {
    const bare = parseNaturalEvent('x friday', NOW)!;
    const next = parseNaturalEvent('x next friday', NOW)!;
    expect(weekdayOf(next.ymd)).toBe(5);
    expect(dayDelta(next.ymd) - dayDelta(bare.ymd)).toBe(7);
  });

  it('handles short weekday forms (mon, tues, weds, thurs)', () => {
    expect(weekdayOf(parseNaturalEvent('gym mon', NOW)!.ymd)).toBe(1);
    expect(weekdayOf(parseNaturalEvent('gym tues', NOW)!.ymd)).toBe(2);
    expect(weekdayOf(parseNaturalEvent('gym weds', NOW)!.ymd)).toBe(3);
    expect(weekdayOf(parseNaturalEvent('gym thurs', NOW)!.ymd)).toBe(4);
  });
});

describe('parseNaturalEvent — explicit dates', () => {
  it('month name + day in the future stays this year', () => {
    const r = parseNaturalEvent('Recital December 5', NOW);
    expect(r!.ymd).toEqual({ year: 2026, month: 11, day: 5 });
  });

  it('month name + day already passed rolls to next year', () => {
    const r = parseNaturalEvent('Trip January 5th', NOW);
    expect(r!.ymd).toEqual({ year: 2027, month: 0, day: 5 });
  });

  it('day-of-month + month name ("5 jan")', () => {
    const r = parseNaturalEvent('Trip 5 jan', NOW);
    expect(r!.ymd).toEqual({ year: 2027, month: 0, day: 5 });
  });

  it('numeric M/D (assumes month/day) rolls past dates to next year', () => {
    expect(parseNaturalEvent('Party 12/25', NOW)!.ymd).toEqual({ year: 2026, month: 11, day: 25 });
    // 1/1 has passed → next year
    expect(parseNaturalEvent('Reset 1/1', NOW)!.ymd).toEqual({ year: 2027, month: 0, day: 1 });
  });

  it('numeric M/D/Y honours an explicit year', () => {
    expect(parseNaturalEvent('Wedding 12/25/2028', NOW)!.ymd).toEqual({
      year: 2028,
      month: 11,
      day: 25,
    });
  });

  it('an impossible date is NOT treated as a date (falls back to today)', () => {
    const r = parseNaturalEvent('Code 13/40', NOW); // month 13 / day 40 — invalid
    expect(r!.hadDate).toBe(false);
    expect(r!.ymd).toEqual({ year: 2026, month: 6, day: 8 });
  });

  it('Feb 30 is rejected as invalid', () => {
    expect(parseNaturalEvent('x february 30', NOW)!.hadDate).toBe(false);
  });
});

describe('parseNaturalEvent — category inference', () => {
  it('sports keywords → sports', () => {
    expect(parseNaturalEvent('Soccer game saturday', NOW)!.tag).toBe('sports');
    expect(parseNaturalEvent('Swim practice', NOW)!.tag).toBe('sports');
  });
  it('school keywords → school', () => {
    expect(parseNaturalEvent('Math test monday', NOW)!.tag).toBe('school');
    expect(parseNaturalEvent('Homework due tomorrow', NOW)!.tag).toBe('school');
  });
  it('work keywords → work', () => {
    expect(parseNaturalEvent('Team meeting at office', NOW)!.tag).toBe('work');
  });
  it('no keyword → family (safe default)', () => {
    expect(parseNaturalEvent("Grandma's visit sunday", NOW)!.tag).toBe('family');
  });
});

describe('parseNaturalEvent — title cleanup', () => {
  it('strips the date phrase and trailing/leading connectors', () => {
    expect(parseNaturalEvent('Dentist on tuesday', NOW)!.title).toBe('Dentist');
    expect(parseNaturalEvent('Soccer practice next Friday', NOW)!.title).toBe('Soccer practice');
  });
  it('preserves original casing of the title', () => {
    expect(parseNaturalEvent('Call Grandma tomorrow', NOW)!.title).toBe('Call Grandma');
  });
  it('produces a valid UTC-noon ISO whose date prefix is the resolved day', () => {
    const r = parseNaturalEvent('Party 12/25', NOW)!;
    expect(r.date.startsWith('2026-12-25T12:00:00')).toBe(true);
  });
});

describe('parseNaturalEvent — French (official-languages parity)', () => {
  it('French weekday "vendredi" resolves like "friday"', () => {
    const r = parseNaturalEvent('Soccer vendredi', NOW);
    expect(weekdayOf(r!.ymd)).toBe(5);
    expect(r!.tag).toBe('sports');
    expect(r!.title).toBe('Soccer');
  });

  it('post-positioned "prochain" pushes a further week ("vendredi prochain")', () => {
    const bare = parseNaturalEvent('x vendredi', NOW)!;
    const next = parseNaturalEvent('Fête vendredi prochain', NOW)!;
    expect(weekdayOf(next.ymd)).toBe(5);
    expect(dayDelta(next.ymd) - dayDelta(bare.ymd)).toBe(7);
    expect(next.title).toBe('Fête'); // "vendredi prochain" fully stripped
  });

  it('"demain" / "aujourd\'hui" / "après-demain"', () => {
    expect(parseNaturalEvent('Dentiste demain', NOW)!.ymd).toEqual({
      year: 2026,
      month: 6,
      day: 9,
    });
    expect(parseNaturalEvent("Dîner aujourd'hui", NOW)!.ymd).toEqual({
      year: 2026,
      month: 6,
      day: 8,
    });
    expect(parseNaturalEvent('Voyage après-demain', NOW)!.ymd).toEqual({
      year: 2026,
      month: 6,
      day: 10,
    });
  });

  it('"dans 3 jours" advances three days', () => {
    expect(parseNaturalEvent('Colis dans 3 jours', NOW)!.ymd).toEqual({
      year: 2026,
      month: 6,
      day: 11,
    });
  });

  it('French month names (accented) resolve, rolling past dates to next year', () => {
    expect(parseNaturalEvent('Récital 5 décembre', NOW)!.ymd).toEqual({
      year: 2026,
      month: 11,
      day: 5,
    });
    expect(parseNaturalEvent('Voyage 5 janvier', NOW)!.ymd).toEqual({
      year: 2027,
      month: 0,
      day: 5,
    });
  });

  it('French category keywords infer the tag', () => {
    expect(parseNaturalEvent('Réunion demain', NOW)!.tag).toBe('work');
    expect(parseNaturalEvent('Examen lundi', NOW)!.tag).toBe('school');
    expect(parseNaturalEvent('Natation samedi', NOW)!.tag).toBe('sports');
  });
});

describe('parseNaturalEvent — null cases', () => {
  it('empty / whitespace input → null', () => {
    expect(parseNaturalEvent('', NOW)).toBeNull();
    expect(parseNaturalEvent('   ', NOW)).toBeNull();
  });
  it('a date with no remaining title → null', () => {
    expect(parseNaturalEvent('tomorrow', NOW)).toBeNull();
    expect(parseNaturalEvent('next friday', NOW)).toBeNull();
  });
});
