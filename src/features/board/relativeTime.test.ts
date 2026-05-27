/**
 * Relative timestamp formatting — unit contract (Task 9; handoff #04 "20m ago").
 *
 * Level: pure unit. Deterministic: "now" is an explicit argument — NO real
 * clock is read, so these pass at 23:59 UTC, on a DST switch, and on Feb 29.
 *
 * FAILS today: relativeTime is a declare-only contract stub.
 */
import { describe, expect, it } from 'vitest';
import { relativeTime } from './relativeTime';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// A fixed, deterministic reference instant (2026-05-27T12:00:00Z).
const NOW = Date.UTC(2026, 4, 27, 12, 0, 0);

describe('relativeTime — happy buckets', () => {
  it('renders "just now" under a minute', () => {
    expect(relativeTime(NOW - 5 * SECOND, NOW)).toBe('just now');
  });

  it('renders minutes within the hour', () => {
    expect(relativeTime(NOW - 20 * MINUTE, NOW)).toBe('20m ago');
  });

  it('renders hours within the day', () => {
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe('3h ago');
  });

  it('renders days within the week', () => {
    expect(relativeTime(NOW - 4 * DAY, NOW)).toBe('4d ago');
  });
});

describe('relativeTime — boundaries (edge)', () => {
  it('exactly 60s rolls over to "1m ago" (not "just now")', () => {
    expect(relativeTime(NOW - 60 * SECOND, NOW)).toBe('1m ago');
  });

  it('exactly 60m rolls over to "1h ago"', () => {
    expect(relativeTime(NOW - 60 * MINUTE, NOW)).toBe('1h ago');
  });

  it('exactly 24h rolls over to "1d ago"', () => {
    expect(relativeTime(NOW - 24 * HOUR, NOW)).toBe('1d ago');
  });

  it('a post older than 7 days is NOT rendered as "Nd ago" (falls back to a date)', () => {
    const result = relativeTime(NOW - 10 * DAY, NOW);
    expect(result).not.toMatch(/\bago\b/);
    expect(result).not.toBe('just now');
  });
});

describe('relativeTime — clock skew (edge / determinism)', () => {
  it('treats a createdAt slightly in the FUTURE as "just now" (never negative)', () => {
    expect(relativeTime(NOW + 2 * SECOND, NOW)).toBe('just now');
  });
});
