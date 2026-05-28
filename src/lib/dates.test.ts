/**
 * Local-day helpers contract (`src/lib/dates.ts`).
 *
 * Pinned under a NON-UTC timezone (lesson 2026-05-28): a viewer's LOCAL calendar
 * day must survive even after UTC has rolled over. Both helpers are PURE — no
 * clock read, no Firebase — so they're tested in isolation by passing instants
 * and strings directly.
 *
 * FAILS today: `src/lib/dates.ts` does not exist yet.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventLocalDay, localDayKey } from './dates';

describe('localDayKey under America/Los_Angeles (UTC-8 / UTC-7 DST)', () => {
  const ORIGINAL_TZ = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
  });

  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('returns the LOCAL YYYY-MM-DD for an instant that is still today locally even after UTC has rolled over', () => {
    // 2026-05-28 23:30 PDT  ===  2026-05-29 06:30 UTC. Local day is the 28th.
    const ms = Date.UTC(2026, 4, 29, 6, 30);
    expect(localDayKey(ms)).toBe('2026-05-28');
  });

  it('returns the prior local day for an early-AM-UTC instant that is still last evening locally', () => {
    // 2026-05-28 02:30 UTC  ===  2026-05-27 19:30 PDT. Local day is the 27th.
    const ms = Date.UTC(2026, 4, 28, 2, 30);
    expect(localDayKey(ms)).toBe('2026-05-27');
  });

  it('zero-pads month and day', () => {
    // Local noon on 2026-01-09.
    const ms = new Date(2026, 0, 9, 12, 0, 0).getTime();
    expect(localDayKey(ms)).toBe('2026-01-09');
  });

  it('crosses the DST spring-forward day correctly (2026-03-08 in US)', () => {
    // 2026-03-08 10:00 PDT (post-spring-forward) -> local day 2026-03-08.
    const ms = new Date(2026, 2, 8, 10, 0, 0).getTime();
    expect(localDayKey(ms)).toBe('2026-03-08');
  });
});

describe('eventLocalDay under America/Los_Angeles', () => {
  const ORIGINAL_TZ = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/Los_Angeles';
  });

  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('treats a bare YYYY-MM-DD as the LOCAL calendar day (no UTC-midnight shift back)', () => {
    // `new Date('2026-05-28')` is UTC-midnight, which is 2026-05-27 17:00 PDT —
    // a UTC-behind zone would shift the day back. The helper must NOT do that.
    const result = eventLocalDay('2026-05-28');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('2026-05-28');
    expect(result!.instant).toBe(new Date(2026, 4, 28).getTime());
  });

  it('reduces an ISO datetime to its LOCAL day on the same basis as localDayKey', () => {
    // 2026-05-28 07:00 UTC  ===  2026-05-28 00:00 PDT  (still the 28th locally).
    const iso = '2026-05-28T07:00:00Z';
    const result = eventLocalDay(iso);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('2026-05-28');
    expect(result!.instant).toBe(new Date(iso).getTime());
  });

  it('reduces an early-UTC-AM ISO datetime to the PRIOR local day in a UTC-behind zone', () => {
    // 2026-05-28 03:00 UTC  ===  2026-05-27 20:00 PDT  (the 27th locally).
    const iso = '2026-05-28T03:00:00Z';
    const result = eventLocalDay(iso);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('2026-05-27');
  });

  it('returns null for an empty string', () => {
    expect(eventLocalDay('')).toBeNull();
  });

  it('returns null for an unparseable string', () => {
    expect(eventLocalDay('not-a-date')).toBeNull();
  });

  it('returns null for a non-string input (defensive — TS would forbid it but runtime callers might lie)', () => {
    expect(eventLocalDay(null as unknown as string)).toBeNull();
    expect(eventLocalDay(undefined as unknown as string)).toBeNull();
    expect(eventLocalDay(42 as unknown as string)).toBeNull();
  });
});
